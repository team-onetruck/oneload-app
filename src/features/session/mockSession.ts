/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: VITE_API_MODE=mock에서 서버 대신 세션 상태와 revision을 돌려주는 가짜 세션 서버
 */
import type { SessionStatus } from '../../api'

// 서버 deps.advance처럼 상태가 바뀔 때마다 revision을 1 올린 SessionStatus를 돌려준다.
// store는 http 모드와 똑같이 이 값을 "서버 응답"으로만 받는다. 작업 6에서 mock 어댑터로 옮긴다.
export function createMockSessionServer() {
  let current: SessionStatus = { state: 'idle', revision: 1 }
  return {
    start(): SessionStatus {
      current = { state: 'idle', revision: 1 }
      return current
    },
    advance(state: string): SessionStatus {
      current = { state, revision: current.revision + 1 }
      return current
    },
  }
}
