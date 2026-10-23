/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 길안내 시작·도착·취소 이벤트를 만들고 navigation-events로 보낸다. 재전송해도 같은 event_id를 쓴다
 */
import type { ApiAdapter, NavigationEvent, NavigationEventsIn, NavigationEventsOut } from '../../api/types'

export type NavigationEventType = NavigationEvent['type']

// 한 요청에 담을 수 있는 이벤트 수 (backend/app/schemas.py NavigationEventsIn, max_length=50)
export const MAX_EVENTS_PER_REQUEST = 50

export interface NewEventOptions {
  context?: Record<string, unknown>
  now?: () => Date
  newId?: () => string
}

// id와 시각은 만들 때 한 번 정한다. 보내다 실패하면 같은 객체를 다시 보내고, 서버는 이미 반영한 event_id를 건너뛴다.
export function createNavigationEvent(
  type: NavigationEventType,
  { context = {}, now = () => new Date(), newId = () => crypto.randomUUID() }: NewEventOptions = {},
): NavigationEvent {
  return { event_id: newId(), type, client_timestamp: now().toISOString(), context }
}

export function buildNavigationEventsBody(routeId: string | null, events: NavigationEvent[]): NavigationEventsIn {
  if (events.length === 0 || events.length > MAX_EVENTS_PER_REQUEST) {
    throw new RangeError(`이벤트는 한 번에 1~${MAX_EVENTS_PER_REQUEST}개만 보낼 수 있습니다.`)
  }
  return { route_id: routeId, events }
}

// 응답의 accepted_event_ids에는 이번에 반영한 id와 이미 받아 건너뛴 id가 모두 들어온다 (backend/app/api/sessions.py).
// 그 밖의 이벤트만 다시 보낼 대기열로 남긴다.
export function pendingAfter(pending: NavigationEvent[], out: Pick<NavigationEventsOut, 'accepted_event_ids'>): NavigationEvent[] {
  const accepted = new Set(out.accepted_event_ids)
  return pending.filter((e) => !accepted.has(e.event_id))
}

export interface SendEventsResult {
  out: NavigationEventsOut
  // 아직 보내지 못한 이벤트. 비어 있지 않으면 같은 함수로 이어서 보낸다
  pending: NavigationEvent[]
}

// 대기열 앞에서부터 최대 50개를 보낸다. 실패하면 예외를 그대로 던지므로, 호출한 쪽은 같은 대기열로 다시 부르면 된다.
export async function sendNavigationEvents(
  api: Pick<ApiAdapter, 'postNavigationEvents'>,
  sessionId: string,
  routeId: string | null,
  pending: NavigationEvent[],
): Promise<SendEventsResult> {
  const batch = pending.slice(0, MAX_EVENTS_PER_REQUEST)
  const out = await api.postNavigationEvents(sessionId, buildNavigationEventsBody(routeId, batch))
  return { out, pending: pendingAfter(pending, out) }
}
