/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 길안내 이벤트 대기열. 보내는 중인 이벤트를 다음 묶음에 다시 넣지 않고, 실패한 것만 되돌려 다음 묶음과 함께 보낸다
 */
import type { NavigationEvent } from '../../api/types'
import type { DeliveryOutcome } from './flow'

export interface EventOutbox {
  // 이벤트를 넣는다. 보내는 중인 묶음이 없으면 바로 보내고, 있으면 그 응답을 받은 뒤 보낸다.
  // now: 보내는 중이어도 바로 보낸다 (처음으로 가기 전의 취소처럼 세션을 곧 버리는 경우)
  push(routeId: string, event: NavigationEvent, options?: { now?: boolean }): void
  // 경로를 버린다. 보내는 중인 묶음의 결과는 대기열에 반영하지 않는다
  reset(): void
  // 아직 보내지 않은 이벤트와 보내는 중인 이벤트 (테스트용)
  snapshot(): { routeId: string | null; waiting: NavigationEvent[]; inFlight: NavigationEvent[] }
}

// deliver는 묶음 하나를 보내고 결과를 돌려준다 (flow.ts deliverEvents). 세션 반영은 deliver 쪽에서 한다.
//
// 한 번에 한 묶음만 보낸다. 시작 응답을 기다리는 동안 도착을 따로 먼저 보내면, 느린 망에서는 서버가 도착을 시작보다
// 먼저 처리해 409 INVALID_STATE(arrived는 navigating에서만 받는다)가 날 수 있다. 그래서 응답을 받은 뒤 쌓인 이벤트를 보낸다.
// 실패한 묶음은 대기열 앞으로 되돌려 다음 묶음에 같은 event_id로 넣는다. 서버는 이미 받은 event_id를 건너뛴다.
export function createEventOutbox(deliver: (routeId: string, batch: NavigationEvent[]) => Promise<DeliveryOutcome>): EventOutbox {
  let routeId: string | null = null
  let waiting: NavigationEvent[] = []
  const inFlight = new Map<number, NavigationEvent[]>()
  let nextSend = 0
  // reset이나 경로 변경 뒤에 도착한 옛 결과를 대기열에 반영하지 않기 위한 번호
  let generation = 0

  const flush = () => {
    if (routeId === null || waiting.length === 0) return
    const id = routeId
    const gen = generation
    const batch = waiting
    const send = nextSend++
    waiting = []
    inFlight.set(send, batch)
    void deliver(id, batch).then((outcome) => {
      if (gen !== generation) return
      inFlight.delete(send)
      // 보내는 동안 새 이벤트가 쌓였는지. 실패했어도 그 이벤트들은 기다리지 않고 함께 보낸다
      const queuedMeanwhile = waiting.length > 0
      if (outcome.kind === 'failed') waiting = [...batch, ...waiting]
      // 한 요청에 50개를 넘게 못 보내 남은 것
      else if (outcome.kind === 'sent') waiting = [...outcome.pending, ...waiting]
      if (inFlight.size > 0) return
      if (outcome.kind !== 'failed' || queuedMeanwhile) flush()
    })
  }

  return {
    push(id, event, { now = false } = {}) {
      if (id !== routeId) {
        routeId = id
        waiting = []
        inFlight.clear()
        generation++
      }
      waiting.push(event)
      if (now || inFlight.size === 0) flush()
    },
    reset() {
      routeId = null
      waiting = []
      inFlight.clear()
      generation++
    },
    snapshot() {
      return { routeId, waiting: [...waiting], inFlight: [...inFlight.values()].flat() }
    },
  }
}
