/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: API 오류를 사용자가 고를 탈출구(재시도, 직접 선택, 처음으로)로 바꾸는 규칙을 한곳에 모은다
 */
import { isApiError } from '../../api/errors'

export type RecoveryAction = 'retry' | 'manual' | 'home'

export type NoticeReason = 'timeout' | 'network' | 'failed'

export type Recovery =
  // 세션을 더 이어 쓸 수 없다. 새 세션을 저절로 만들지 않고 안내 화면에서 '다시 시작'만 준다
  | { type: 'sessionEnded'; expired: boolean }
  // 앞에 있는 동작이 권장 동작이다. 비어 있는 경우는 없다 (제품 원칙 4: 모든 실패에 탈출구)
  | { type: 'notice'; reason: NoticeReason; actions: RecoveryAction[] }

// 오류가 난 곳에서 쓸 수 있는 동작. '처음으로'는 어디서나 쓸 수 있다
export interface AvailableActions {
  retry: boolean
  manual: boolean
}

const PREFERRED: Record<NoticeReason, RecoveryAction[]> = {
  // 응답을 받지 못했을 뿐이라 같은 요청을 다시 보내거나, 기다리지 않고 목록에서 고를 수 있다
  timeout: ['retry', 'manual'],
  network: ['retry', 'manual'],
  // 서버가 retryable: false로 답한 오류는 같은 요청을 다시 보내도 같은 결과라 재시도를 주지 않는다
  failed: ['manual', 'home'],
}

function reasonOf(error: unknown): NoticeReason {
  if (!isApiError(error)) return 'failed'
  if (error.code === 'TIMEOUT') return 'timeout'
  if (error.code === 'NETWORK') return 'network'
  return 'failed'
}

export function recoveryFor(error: unknown, available: AvailableActions): Recovery {
  // 401은 SESSION_EXPIRED(오래 쓰지 않음)와 SESSION_UNAUTHORIZED(토큰 없음·불일치)뿐이다 (backend/app/api/deps.py authorized_session).
  // 410은 사진 결과 만료(LOCALIZATION_EXPIRED)라서 세션 만료로 보지 않는다.
  if (isApiError(error) && error.status === 401) return { type: 'sessionEnded', expired: error.code === 'SESSION_EXPIRED' }
  const reason = reasonOf(error)
  const actions = PREFERRED[reason].filter((a) => a === 'home' || available[a])
  return { type: 'notice', reason, actions: actions.length ? actions : ['home'] }
}
