/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 길안내 이벤트 대기열이 보내는 중인 이벤트를 다시 넣지 않고, 실패한 것만 다음 묶음에 되돌리는지 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/errors'
import type { NavigationEvent } from '../../api/types'
import { createNavigationEvent } from './events'
import type { DeliveryOutcome } from './flow'
import { createEventOutbox } from './outbox'

let seq = 0
const event = (type: NavigationEvent['type']) => createNavigationEvent(type, { newId: () => `evt_${++seq}` })
const ids = (events: NavigationEvent[]) => events.map((e) => e.event_id)
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// 보낸 묶음을 기록하고, 테스트가 원할 때 묶음마다 응답을 정한다
function fakeDeliver() {
  const sent: { routeId: string; batch: NavigationEvent[]; settle: (outcome: DeliveryOutcome) => void }[] = []
  const deliver = (routeId: string, batch: NavigationEvent[]) =>
    new Promise<DeliveryOutcome>((resolve) => sent.push({ routeId, batch, settle: resolve }))
  const ok = (i: number) => sent[i].settle({ kind: 'sent', session: { state: 'navigating', revision: 1 }, pending: [] })
  const timeout = (i: number) =>
    sent[i].settle({ kind: 'failed', error: new ApiError(0, 'TIMEOUT', '응답 없음', null, { retryable: true }), pending: sent[i].batch })
  return { deliver, sent, ok, timeout }
}

describe('createEventOutbox', () => {
  it('첫 이벤트 응답을 기다리는 동안 들어온 이벤트는 첫 이벤트를 빼고, 첫 응답을 받은 뒤 보낸다', async () => {
    const d = fakeDeliver()
    const outbox = createEventOutbox(d.deliver)
    const started = event('navigation_started')
    const arrived = event('arrived')

    outbox.push('route_1', started)
    outbox.push('route_1', arrived)
    expect(d.sent.map((s) => ids(s.batch))).toEqual([[started.event_id]])
    expect(outbox.snapshot()).toMatchObject({ waiting: [arrived], inFlight: [started] })

    d.ok(0)
    await tick()
    expect(d.sent.map((s) => ids(s.batch))).toEqual([[started.event_id], [arrived.event_id]])
  })

  it('첫 전송이 타임아웃이면 다음 묶음에 같은 event_id로 다시 넣는다', async () => {
    const d = fakeDeliver()
    const outbox = createEventOutbox(d.deliver)
    const started = event('navigation_started')
    outbox.push('route_1', started)
    d.timeout(0)
    await tick()
    // 실패만으로는 다시 보내지 않고 다음 이벤트를 기다린다
    expect(d.sent).toHaveLength(1)
    expect(outbox.snapshot().waiting).toEqual([started])

    const arrived = event('arrived')
    outbox.push('route_1', arrived)
    expect(ids(d.sent[1].batch)).toEqual([started.event_id, arrived.event_id])
  })

  it('보내는 동안 새 이벤트가 쌓였는데 전송이 실패하면, 실패한 것을 앞에 두고 바로 함께 보낸다', async () => {
    const d = fakeDeliver()
    const outbox = createEventOutbox(d.deliver)
    const started = event('navigation_started')
    const arrived = event('arrived')
    outbox.push('route_1', started)
    outbox.push('route_1', arrived)

    d.timeout(0)
    await tick()
    expect(ids(d.sent[1].batch)).toEqual([started.event_id, arrived.event_id])
  })

  it('보낸 묶음은 성공하면 대기열에서 빠지고 다시 보내지 않는다', async () => {
    const d = fakeDeliver()
    const outbox = createEventOutbox(d.deliver)
    outbox.push('route_1', event('navigation_started'))
    d.ok(0)
    await tick()
    expect(outbox.snapshot()).toMatchObject({ waiting: [], inFlight: [] })

    const arrived = event('arrived')
    outbox.push('route_1', arrived)
    expect(ids(d.sent[1].batch)).toEqual([arrived.event_id])
  })

  it('한 요청에 다 못 보내 남은 이벤트는 다음 묶음 앞에 두고 이어서 보낸다', async () => {
    const d = fakeDeliver()
    const outbox = createEventOutbox(d.deliver)
    const [a, b] = [event('navigation_started'), event('arrived')]
    outbox.push('route_1', a)
    outbox.push('route_1', b)
    d.sent[0].settle({ kind: 'sent', session: { state: 'navigating', revision: 1 }, pending: [a] })
    await tick()
    expect(ids(d.sent[1].batch)).toEqual([a.event_id, b.event_id])
  })

  it('now면 보내는 중이어도 바로 보내고, 보내는 중인 이벤트는 넣지 않는다', () => {
    const d = fakeDeliver()
    const outbox = createEventOutbox(d.deliver)
    const started = event('navigation_started')
    const cancelled = event('navigation_cancelled')
    outbox.push('route_1', started)
    outbox.push('route_1', cancelled, { now: true })
    expect(d.sent.map((s) => ids(s.batch))).toEqual([[started.event_id], [cancelled.event_id]])
  })

  it('경로가 바뀌면 옛 경로의 대기열을 버리고, 옛 결과는 반영하지 않는다', async () => {
    const d = fakeDeliver()
    const outbox = createEventOutbox(d.deliver)
    const old = event('navigation_started')
    outbox.push('route_1', old)
    const fresh = event('navigation_started')
    outbox.push('route_2', fresh)
    expect(d.sent.map((s) => [s.routeId, ids(s.batch)])).toEqual([['route_1', [old.event_id]], ['route_2', [fresh.event_id]]])

    d.timeout(0)
    await tick()
    expect(outbox.snapshot()).toEqual({ routeId: 'route_2', waiting: [], inFlight: [fresh] })
  })

  it('reset 뒤에 도착한 결과는 대기열에 넣지 않는다', async () => {
    const d = fakeDeliver()
    const outbox = createEventOutbox(d.deliver)
    outbox.push('route_1', event('navigation_started'))
    outbox.reset()
    d.timeout(0)
    await tick()
    expect(outbox.snapshot()).toEqual({ routeId: null, waiting: [], inFlight: [] })
  })
})
