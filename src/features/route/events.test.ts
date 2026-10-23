/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 길안내 이벤트 빌더와 전송·재전송(같은 event_id·Idempotency-Key 재사용, 이미 닫힌 경로 판단) 동작을 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/errors'
import type { MutationOptions, NavigationEventsIn, NavigationEventsOut } from '../../api/types'
import {
  MAX_EVENTS_PER_REQUEST,
  buildNavigationEventsBody,
  createNavigationEvent,
  isRouteAlreadyClosed,
  pendingAfter,
  sendNavigationEvents,
} from './events'

const AT = new Date('2026-10-23T01:02:03.000Z')
let seq = 0
const opts = { now: () => AT, newId: () => `evt_${++seq}` }

// 보낸 본문을 기록하고, 정해 둔 응답이나 오류를 순서대로 돌려주는 가짜 어댑터
function fakeApi(...results: Array<NavigationEventsOut | Error | ((body: NavigationEventsIn) => NavigationEventsOut)>) {
  const calls: Array<{ sessionId: string; body: NavigationEventsIn; options?: MutationOptions }> = []
  return {
    calls,
    async postNavigationEvents(sessionId: string, body: NavigationEventsIn, options?: MutationOptions) {
      calls.push({ sessionId, body, options })
      const next = results.shift()
      if (next instanceof Error) throw next
      if (typeof next === 'function') return next(body)
      return next ?? { accepted_event_ids: body.events.map((e) => e.event_id), session: { state: 'navigating', revision: 7 } }
    },
  }
}

describe('createNavigationEvent', () => {
  it('시작·도착·취소 이벤트를 고유 id와 ISO 시각으로 만든다', () => {
    expect(createNavigationEvent('navigation_started', opts)).toEqual({
      event_id: expect.stringMatching(/^evt_\d+$/),
      type: 'navigation_started',
      client_timestamp: '2026-10-23T01:02:03.000Z',
      context: {},
    })
    expect(createNavigationEvent('arrived', opts).type).toBe('arrived')
    expect(createNavigationEvent('navigation_cancelled', { ...opts, context: { step_id: 's2' } }).context).toEqual({ step_id: 's2' })
  })

  it('기본 id는 서버 한도(64자) 안의 UUID이고 만들 때마다 다르다', () => {
    const a = createNavigationEvent('arrived')
    const b = createNavigationEvent('arrived')
    expect(a.event_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.event_id.length).toBeLessThanOrEqual(64)
    expect(a.event_id).not.toBe(b.event_id)
  })
})

describe('buildNavigationEventsBody', () => {
  it('현재 경로 id와 이벤트를 담는다', () => {
    const e = createNavigationEvent('navigation_started', opts)
    expect(buildNavigationEventsBody('route_1', [e])).toEqual({ route_id: 'route_1', events: [e] })
  })

  it('이벤트가 없거나 50개를 넘으면 보내지 않는다', () => {
    const many = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => createNavigationEvent('arrived', opts))
    expect(() => buildNavigationEventsBody('route_1', [])).toThrow(RangeError)
    expect(() => buildNavigationEventsBody('route_1', many)).toThrow(RangeError)
  })
})

describe('pendingAfter', () => {
  it('서버가 받은 id를 대기열에서 빼고 나머지만 남긴다', () => {
    const [a, b] = [createNavigationEvent('navigation_started', opts), createNavigationEvent('arrived', opts)]
    expect(pendingAfter([a, b], { accepted_event_ids: [a.event_id] })).toEqual([b])
  })
})

describe('sendNavigationEvents', () => {
  it('세션과 경로 id로 이벤트를 보내고 서버 session을 그대로 돌려준다', async () => {
    const api = fakeApi()
    const started = createNavigationEvent('navigation_started', opts)
    const { out, pending } = await sendNavigationEvents(api, 'ses_1', 'route_1', [started])
    expect(api.calls).toEqual([{ sessionId: 'ses_1', body: { route_id: 'route_1', events: [started] }, options: {} }])
    expect(out.session).toEqual({ state: 'navigating', revision: 7 })
    expect(pending).toEqual([])
  })

  it('전송이 실패하면 대기열을 그대로 두고, 다시 보낼 때 같은 event_id와 시각을 쓴다', async () => {
    const api = fakeApi(new ApiError(0, 'TIMEOUT', '응답 없음', null, { retryable: true }))
    const arrived = [createNavigationEvent('arrived', opts)]
    await expect(sendNavigationEvents(api, 'ses_1', 'route_1', arrived)).rejects.toMatchObject({ code: 'TIMEOUT' })
    await sendNavigationEvents(api, 'ses_1', 'route_1', arrived)
    expect(api.calls[1].body.events).toEqual(api.calls[0].body.events)
  })

  it('서버가 중복으로 건너뛴 id도 accepted_event_ids에 있으면 대기열에서 뺀다', async () => {
    const started = createNavigationEvent('navigation_started', opts)
    const api = fakeApi({ accepted_event_ids: [started.event_id], session: { state: 'navigating', revision: 7 } })
    expect((await sendNavigationEvents(api, 'ses_1', 'route_1', [started])).pending).toEqual([])
  })

  it('50개가 넘게 쌓였으면 앞의 50개만 보내고 나머지는 대기열로 돌려준다', async () => {
    const api = fakeApi()
    const queued = Array.from({ length: MAX_EVENTS_PER_REQUEST + 2 }, () => createNavigationEvent('arrived', opts))
    const { pending } = await sendNavigationEvents(api, 'ses_1', null, queued)
    expect(api.calls[0].body.events).toHaveLength(MAX_EVENTS_PER_REQUEST)
    expect(api.calls[0].body.route_id).toBeNull()
    expect(pending).toEqual(queued.slice(MAX_EVENTS_PER_REQUEST))
  })

  it('다시 보낼 때 처음 요청의 Idempotency-Key를 넘기면 어댑터에 그대로 전달한다', async () => {
    const api = fakeApi()
    await sendNavigationEvents(api, 'ses_1', 'route_1', [createNavigationEvent('arrived', opts)], { idempotencyKey: 'key-1' })
    expect(api.calls[0].options).toEqual({ idempotencyKey: 'key-1' })
  })
})

describe('isRouteAlreadyClosed', () => {
  const closed = (details: Record<string, unknown>) => new ApiError(422, 'INVALID_INPUT', 'route_id is not the active route.', null, { details })
  const arrived = [createNavigationEvent('arrived', opts)]

  it('도착·취소를 보냈는데 활성 경로가 비어 있다는 422면 이미 반영된 것으로 본다', () => {
    expect(isRouteAlreadyClosed(closed({ active_route_id: null }), arrived)).toBe(true)
    expect(isRouteAlreadyClosed(closed({ active_route_id: null }), [createNavigationEvent('navigation_cancelled', opts)])).toBe(true)
  })

  it('시작 이벤트만 보냈으면 반영된 것으로 보지 않는다', () => {
    expect(isRouteAlreadyClosed(closed({ active_route_id: null }), [createNavigationEvent('navigation_started', opts)])).toBe(false)
  })

  it('다른 경로가 활성이면(목적지가 바뀜) 반영된 것으로 보지 않는다', () => {
    expect(isRouteAlreadyClosed(closed({ active_route_id: 'route_2' }), arrived)).toBe(false)
  })

  it('본문 검증 오류(details.errors)나 다른 코드는 반영된 것으로 보지 않는다', () => {
    expect(isRouteAlreadyClosed(closed({ errors: [{ loc: ['body', 'events'], msg: 'x' }] }), arrived)).toBe(false)
    expect(isRouteAlreadyClosed(new ApiError(409, 'INVALID_STATE', '', null, { details: { active_route_id: null } }), arrived)).toBe(false)
    expect(isRouteAlreadyClosed(new ApiError(0, 'TIMEOUT', ''), arrived)).toBe(false)
    expect(isRouteAlreadyClosed(new TypeError('boom'), arrived)).toBe(false)
  })
})
