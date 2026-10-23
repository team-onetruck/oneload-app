/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: API 오류를 사용자가 고를 탈출구(재시도, 직접 선택, 처음으로)로 바꾸는 규칙을 한곳에 모은다
 */
import { isApiError } from '../../api/errors'
import type { ApiError, ApiErrorCode } from '../../api/errors'

export type RecoveryAction = 'retry' | 'manual' | 'home'

// 세션 종료 화면에 보여 줄 문구 종류. 만료 문구는 expired일 때만 쓴다
export type SessionEndCause = 'expired' | 'unauthorized' | 'forbidden' | 'map_changed'

export type NoticeReason = 'timeout' | 'network' | 'conflict' | 'ai_unavailable' | 'failed'

export type RelocateReason = 'location_not_confirmed' | 'localization_expired'

export type Recovery =
  // 세션을 더 이어 쓸 수 없다. 새 세션을 저절로 만들지 않고 안내 화면에서 '다시 시작'만 준다
  | { type: 'sessionEnded'; cause: SessionEndCause }
  // 탈출구를 고르는 알림. 앞에 있는 동작이 권장 동작이고, 비어 있는 경우는 없다 (제품 원칙 4)
  | { type: 'notice'; reason: NoticeReason; actions: RecoveryAction[] }
  // 409 INVALID_STATE: 재시도하지 않고 navigation-state를 다시 읽어 next_action에 맞는 화면으로 간다
  | { type: 'resync'; actions: RecoveryAction[] }
  // 위치 확인 화면으로 보낸다. 그 화면에 다시 찍기와 목록에서 고르기가 있고, 세션은 그대로 둔다
  | { type: 'relocate'; reason: RelocateReason }

// 오류가 난 곳에서 쓸 수 있는 동작. '처음으로'는 어디서나 쓸 수 있다
export interface AvailableActions {
  retry: boolean
  // 목록에서 직접 고를 수 있는 단계인지 (예: 위치 확인)
  manual: boolean
}

// 코드와 상태코드는 backend/app/errors.py, 나오는 곳은 backend/app/api/deps.py와 각 엔드포인트에서 확인했다.
const SESSION_END: Partial<Record<ApiErrorCode, SessionEndCause>> = {
  // 401: 토큰은 맞지만 오래 쓰지 않아 만료됨
  SESSION_EXPIRED: 'expired',
  // 401: 토큰이 없거나 맞는 세션이 없음
  SESSION_UNAUTHORIZED: 'unauthorized',
  // 403: 토큰은 유효하지만 경로의 세션 id가 다름. 정상 흐름에서는 나오지 않는 클라이언트 버그다
  SESSION_FORBIDDEN: 'forbidden',
  // 409: withMapVersionRefresh가 최신 버전으로 다시 보낸 뒤에도 오면 세션을 시작한 뒤 서버 지도가 바뀐 경우다
  MAP_VERSION_MISMATCH: 'map_changed',
}

const RELOCATE: Partial<Record<ApiErrorCode, RelocateReason>> = {
  // 409: 위치를 확정하기 전에 경로를 요청함
  LOCATION_NOT_CONFIRMED: 'location_not_confirmed',
  // 410: 사진 결과가 5분 지나 만료됨. 세션 만료가 아니다
  LOCALIZATION_EXPIRED: 'localization_expired',
}

const NOTICE: Partial<Record<ApiErrorCode, { reason: NoticeReason; actions: RecoveryAction[] }>> = {
  // 응답을 받지 못했을 뿐이라 같은 요청을 다시 보낼 수 있다. 직접 선택이 없는 단계면 처음으로를 준다
  TIMEOUT: { reason: 'timeout', actions: ['retry', 'manual'] },
  NETWORK: { reason: 'network', actions: ['retry', 'manual'] },
  // 409: withRevisionResync가 한 번 다시 맞춰 보낸 뒤에도 충돌한 경우만 여기 온다
  REVISION_CONFLICT: { reason: 'conflict', actions: ['retry', 'home'] },
  // 503: 사진을 읽을 수 없으니 위치를 추측하지 않고 목록에서 고르게 한다 (CLAUDE.md)
  AI_SERVICE_UNAVAILABLE: { reason: 'ai_unavailable', actions: ['manual', 'retry'] },
  // 400: Idempotency-Key 누락 같은 클라이언트 버그. 사용자에게는 일반 오류로 보인다
  BAD_REQUEST: { reason: 'failed', actions: ['retry'] },
  // 공통 오류 형식이 아닌 응답 (처리되지 않은 500 등)
  UNEXPECTED_RESPONSE: { reason: 'failed', actions: ['retry', 'home'] },
}

// 정상 흐름에서는 나오지 않아 추적용으로 기록할 오류
export const isClientBug = (error: unknown): error is ApiError =>
  isApiError(error) && (error.code === 'SESSION_FORBIDDEN' || error.code === 'BAD_REQUEST')

// 쓸 수 없는 재시도는 빼고, 쓸 수 없는 직접 선택은 처음으로로 바꾼다. 남는 것이 없으면 처음으로를 준다
function fit(preferred: RecoveryAction[], available: AvailableActions): RecoveryAction[] {
  const actions = preferred.flatMap((a): RecoveryAction[] => {
    if (a === 'retry') return available.retry ? ['retry'] : []
    if (a === 'manual') return available.manual ? ['manual'] : ['home']
    return [a]
  })
  const unique = [...new Set(actions)]
  return unique.length ? unique : ['home']
}

export function recoveryFor(error: unknown, available: AvailableActions): Recovery {
  if (!isApiError(error)) return { type: 'notice', reason: 'failed', actions: fit(['manual', 'home'], available) }

  const cause = SESSION_END[error.code]
  if (cause) return { type: 'sessionEnded', cause }
  if (error.code === 'INVALID_STATE') return { type: 'resync', actions: ['home'] }
  const relocate = RELOCATE[error.code]
  if (relocate) return { type: 'relocate', reason: relocate }

  const notice = NOTICE[error.code]
  if (notice) return { type: 'notice', reason: notice.reason, actions: fit(notice.actions, available) }
  // 나머지는 서버의 retryable을 따른다. retryable: false면 같은 요청을 다시 보내도 같은 결과다
  return { type: 'notice', reason: 'failed', actions: fit(error.retryable ? ['retry', 'manual'] : ['manual', 'home'], available) }
}
