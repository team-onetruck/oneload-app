/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 공통 오류 형식과 네트워크·타임아웃 오류를 하나의 ApiError로 다룬다
 */

// 서버 ErrorCode 목록 (backend/app/errors.py). OpenAPI 문서에는 오류 형식이 없어서 여기서만 손으로 맞춘다.
export type ServerErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_INPUT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SESSION_UNAUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'SESSION_FORBIDDEN'
  | 'NOT_FOUND'
  | 'MAP_NOT_FOUND'
  | 'POI_NOT_FOUND'
  | 'LOCALIZATION_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'LOCALIZATION_EXPIRED'
  | 'MAP_VERSION_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'INVALID_STATE'
  | 'LOCATION_NOT_CONFIRMED'
  | 'IMAGE_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'INTERNAL'

// 클라이언트가 붙이는 코드: 응답을 받지 못함(NETWORK, TIMEOUT), 공통 형식이 아닌 응답(UNEXPECTED_RESPONSE)
export type ClientErrorCode = 'NETWORK' | 'TIMEOUT' | 'UNEXPECTED_RESPONSE'

export type ApiErrorCode = ServerErrorCode | ClientErrorCode

// 서버의 모든 오류 응답 본문: {"error": {"code", "message", "retryable", "details"}, "request_id"}
export interface ErrorBody {
  error: {
    code: ServerErrorCode
    message: string
    retryable: boolean
    details: Record<string, unknown>
  }
  request_id: string | null
}

export interface ApiErrorExtra {
  retryable?: boolean
  details?: Record<string, unknown>
  idempotencyKey?: string
}

export class ApiError extends Error {
  // 응답을 받지 못한 경우(NETWORK, TIMEOUT)는 0
  readonly status: number
  readonly code: ApiErrorCode
  readonly requestId: string | null
  readonly retryable: boolean
  readonly details: Record<string, unknown>
  // 이 요청에 보낸 Idempotency-Key. 재시도할 때 이 값을 다시 넘겨야 서버가 같은 요청으로 본다. GET처럼 키가 없으면 null
  readonly idempotencyKey: string | null

  constructor(status: number, code: ApiErrorCode, message: string, requestId: string | null = null, extra: ApiErrorExtra = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.retryable = extra.retryable ?? false
    this.details = extra.details ?? {}
    this.idempotencyKey = extra.idempotencyKey ?? null
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError

// 409는 MAP_VERSION_MISMATCH, INVALID_STATE, LOCATION_NOT_CONFIRMED도 쓰므로 status가 아니라 code로 구분한다.
export const isRevisionConflict = (e: unknown): e is ApiError => isApiError(e) && e.code === 'REVISION_CONFLICT'

export const isAiServiceUnavailable = (e: unknown): e is ApiError => isApiError(e) && e.code === 'AI_SERVICE_UNAVAILABLE'

export function isErrorBody(body: unknown): body is ErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false
  const { error } = body
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}
