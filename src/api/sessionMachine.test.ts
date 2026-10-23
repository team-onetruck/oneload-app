/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 공유 세션 상태 기계가 백엔드 표(backend/app/domain/session_state.py)대로 전이하고 허용되지 않는 전이를 막는지 검증한다
 */
import { describe, expect, it } from 'vitest'
import { MESSAGE_TRIGGER, NEXT_ACTION, allows, nextState } from './sessionMachine'

describe('nextState', () => {
  it('목적지가 정해지면 위치가 있을 때만 ready_to_navigate, 없으면 needs_location이다', () => {
    expect(nextState('idle', 'destination_set', false)).toBe('needs_location')
    expect(nextState('arrived', 'destination_set', true)).toBe('ready_to_navigate')
  })

  it('대표 흐름: 위치 후보 → 확정 → 경로 → 출발 → 도착', () => {
    expect(nextState('needs_location', 'candidates_found')).toBe('needs_confirmation')
    expect(nextState('needs_confirmation', 'location_confirmed')).toBe('ready_to_navigate')
    expect(nextState('ready_to_navigate', 'route_created')).toBe('ready_to_navigate')
    expect(nextState('ready_to_navigate', 'navigation_started')).toBe('navigating')
    expect(nextState('navigating', 'arrived')).toBe('arrived')
  })

  it('허용되지 않는 전이는 null이다 (부르는 쪽이 409 INVALID_STATE로 바꾼다)', () => {
    expect(nextState('idle', 'candidates_found')).toBeNull()
    expect(nextState('ready_to_navigate', 'arrived')).toBeNull()
    expect(allows('failed', 'answered')).toBe(false)
  })

  it('대화 응답 status와 next_action 표', () => {
    expect(MESSAGE_TRIGGER.cannot_answer).toBe('answered')
    expect(MESSAGE_TRIGGER.relocalize).toBe('relocalize')
    expect(NEXT_ACTION.needs_confirmation).toBe('confirm_location')
  })
})
