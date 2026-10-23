/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 오류 복구 상태(세션 종료, 탈출구 알림)를 앱 어디서나 읽고 보고할 수 있게 하는 컨텍스트
 */
import { createContext, useContext } from 'react'
import type { Recovery, SessionEndCause } from './recovery'

// 오류가 난 곳이 줄 수 있는 동작. 없으면 그 버튼을 보여 주지 않는다
export interface FailHandlers {
  // 같은 요청을 다시 보낸다
  retry?: () => void
  // 목록에서 직접 고르는 화면으로 간다 (위치 직접 선택, 목적지 목록 등)
  manual?: () => void
}

// 세션 종료가 아닌 복구 결과(알림, 재동기화, 위치 확인 화면으로 이동). 화면 연결은 아직 하지 않았다
export type Notice = Exclude<Recovery, { type: 'sessionEnded' }> & FailHandlers

export interface RecoveryValue {
  // 세션을 더 이어 쓸 수 없을 때만 값이 있다
  ended: { cause: SessionEndCause } | null
  notice: Notice | null
  // API 호출이 실패하면 여기로 넘긴다. 세션이 끝났으면 보관한 세션 토큰을 지우고 안내 화면으로 바꾼다
  fail(error: unknown, handlers?: FailHandlers): void
  clear(): void
}

export const RecoveryContext = createContext<RecoveryValue | null>(null)

export function useRecovery() {
  const value = useContext(RecoveryContext)
  if (!value) throw new Error('useRecovery outside RecoveryProvider')
  return value
}
