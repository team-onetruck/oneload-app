/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 세션 상태 기계(backend/app/domain/session_state.py)를 옮긴 표. mock 어댑터와 MSW 핸들러가 같이 쓴다
 */
import type { MessageOut, NavigationStateOut } from './types'

export type SessionStateName =
  | 'idle'
  | 'needs_clarification'
  | 'needs_location'
  | 'needs_confirmation'
  | 'ready_to_navigate'
  | 'navigating'
  | 'arrived'
  | 'failed'

export type Trigger =
  | 'answered'
  | 'clarification_asked'
  | 'destination_set'
  | 'relocalize'
  | 'candidates_found'
  | 'no_match'
  | 'location_confirmed'
  | 'route_created'
  | 'navigation_started'
  | 'arrived'
  | 'navigation_cancelled'

const ACTIVE: SessionStateName[] = ['idle', 'needs_clarification', 'needs_location', 'needs_confirmation', 'ready_to_navigate', 'navigating', 'arrived']
const LOCATING: SessionStateName[] = ['needs_location', 'needs_confirmation']

// trigger -> [허용되는 상태, 다음 상태]. null은 그대로 둔다는 뜻이다.
const TRANSITIONS: Record<Trigger, [SessionStateName[], SessionStateName | null]> = {
  answered: [ACTIVE, null],
  clarification_asked: [ACTIVE, 'needs_clarification'],
  destination_set: [ACTIVE, null],
  relocalize: [ACTIVE, 'needs_location'],
  candidates_found: [LOCATING, 'needs_confirmation'],
  no_match: [LOCATING, 'needs_location'],
  location_confirmed: [LOCATING, 'ready_to_navigate'],
  route_created: [['ready_to_navigate', 'navigating'], null],
  navigation_started: [['ready_to_navigate'], 'navigating'],
  arrived: [['navigating'], 'arrived'],
  navigation_cancelled: [ACTIVE, 'idle'],
}

export const allows = (state: SessionStateName, trigger: Trigger) => TRANSITIONS[trigger][0].includes(state)

// 다음 상태. 지금 상태에서 허용되지 않으면 null이고, 부르는 쪽이 409 INVALID_STATE로 바꾼다.
export function nextState(state: SessionStateName, trigger: Trigger, hasLocation = false): SessionStateName | null {
  if (!allows(state, trigger)) return null
  if (trigger === 'destination_set') return hasLocation ? 'ready_to_navigate' : 'needs_location'
  return TRANSITIONS[trigger][1] ?? state
}

// GET /navigation-state의 next_action (backend/app/api/sessions.py)
export const NEXT_ACTION: Record<SessionStateName, NavigationStateOut['next_action']> = {
  idle: 'reply',
  needs_clarification: 'reply',
  needs_location: 'locate',
  needs_confirmation: 'confirm_location',
  ready_to_navigate: 'navigate',
  navigating: 'continue_navigation',
  arrived: 'none',
  failed: 'none',
}

// /messages 응답 status가 일으키는 전이 (backend/app/api/conversation.py)
export const MESSAGE_TRIGGER: Record<MessageOut['status'], Trigger> = {
  answered: 'answered',
  cannot_answer: 'answered',
  out_of_scope: 'answered',
  needs_clarification: 'clarification_asked',
  destination_set: 'destination_set',
  relocalize: 'relocalize',
}
