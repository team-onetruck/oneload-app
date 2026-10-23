/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 호출용 fetch 래퍼. 세션 토큰 보관, 인증 헤더, Idempotency-Key, 타임아웃, 오류 변환을 맡는다
 */
import { ApiError, isErrorBody } from './errors'
import { boundaryFor, encodeMultipart } from './multipart'

export const DEFAULT_BASE_URL = '/api/v1'
export const DEFAULT_TIMEOUT_MS = 15_000
export const SESSION_STORAGE_KEY = 'oneload.session'

// 토큰은 발급한 세션에만 쓸 수 있어서(다르면 403 SESSION_FORBIDDEN) 세션 id와 함께 보관한다.
export interface SessionCredentials {
  sessionId: string
  token: string
}

export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface ClientOptions {
  baseUrl?: string
  timeoutMs?: number
  fetch?: FetchLike
  // null이면 메모리에만 둔다
  storage?: TokenStorage | null
  newIdempotencyKey?: () => string
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  query?: Record<string, string | undefined>
  json?: unknown
  form?: FormData
  // 같은 요청을 다시 보낼 때 처음 키를 넘기면 서버가 저장된 응답을 돌려준다.
  idempotencyKey?: string
  timeoutMs?: number
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>
  getSession(): SessionCredentials | null
  setSession(credentials: SessionCredentials): void
  clearSession(): void
}

function defaultStorage(): TokenStorage | null {
  // 저장소가 막힌 브라우저에서는 접근만 해도 예외가 난다.
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function readStoredSession(storage: TokenStorage | null): SessionCredentials | null {
  try {
    const raw = storage?.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'sessionId' in parsed &&
      typeof parsed.sessionId === 'string' &&
      'token' in parsed &&
      typeof parsed.token === 'string'
    ) {
      return { sessionId: parsed.sessionId, token: parsed.token }
    }
  } catch {
    // 깨진 값은 없는 것으로 본다.
  }
  return null
}

async function errorFromResponse(res: Response, idempotencyKey: string | undefined): Promise<ApiError> {
  // request_id는 본문과 X-Request-ID 헤더 양쪽에 온다 (backend/app/middleware.py).
  const headerRequestId = res.headers.get('X-Request-ID')
  const body: unknown = await res.json().catch(() => null)
  if (isErrorBody(body)) {
    const { code, message, retryable, details } = body.error
    return new ApiError(res.status, code, message, body.request_id ?? headerRequestId, { retryable, details, idempotencyKey })
  }
  return new ApiError(res.status, 'UNEXPECTED_RESPONSE', `공통 오류 형식이 아닌 HTTP ${res.status} 응답`, headerRequestId, {
    idempotencyKey,
  })
}

export function createApiClient(options: ClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl || import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const newIdempotencyKey = options.newIdempotencyKey ?? (() => crypto.randomUUID())

  // 메모리가 기준이고, sessionStorage는 새로고침 뒤 복구용이다.
  let session = readStoredSession(storage)

  function setSession(credentials: SessionCredentials) {
    session = { ...credentials }
    try {
      storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    } catch {
      // 저장에 실패해도 이번 탭에서는 메모리 값으로 계속 쓴다.
    }
  }

  function clearSession() {
    session = null
    try {
      storage?.removeItem(SESSION_STORAGE_KEY)
    } catch {
      // 지우지 못해도 메모리에서는 이미 지워졌다.
    }
  }

  async function request<T>(path: string, req: RequestOptions = {}): Promise<T> {
    const method = req.method ?? 'GET'
    const timeoutMs = req.timeoutMs ?? defaultTimeoutMs

    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(req.query ?? {})) if (value !== undefined) params.set(key, value)
    const query = params.toString()
    const url = `${baseUrl}${path}${query ? `?${query}` : ''}`

    const headers = new Headers()
    if (session) headers.set('Authorization', `Bearer ${session.token}`)
    // 서버가 키를 요구하는 것은 POST뿐이고(backend/app/middleware.py) PATCH에서는 무시되지만, 변경 요청에는 모두 붙인다.
    // 자동으로 만든 키도 오류에 담아, 호출자가 재시도할 때 같은 키를 넘길 수 있게 한다.
    const idempotencyKey = method === 'GET' ? undefined : (req.idempotencyKey ?? newIdempotencyKey())
    if (idempotencyKey !== undefined) headers.set('Idempotency-Key', idempotencyKey)
    let body: BodyInit | undefined
    if (req.form) {
      // FormData를 fetch에 그대로 넘기면 보낼 때마다 경계값이 달라져, 같은 키로 재시도해도 서버가 다른 요청으로 보고
      // 첫 요청이 이미 성공했다면 422 IDEMPOTENCY_KEY_REUSED를 준다. 경계값을 키로 정해 직접 직렬화한다.
      const multipart = encodeMultipart(req.form, boundaryFor(idempotencyKey ?? newIdempotencyKey()))
      headers.set('Content-Type', multipart.contentType)
      body = multipart.body
    } else if (req.json !== undefined) {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(req.json)
    }

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    let status = 0
    try {
      const res = await doFetch(url, { method, headers, body, signal: controller.signal })
      status = res.status
      if (!res.ok) throw await errorFromResponse(res, idempotencyKey)
      return (await res.json()) as T
    } catch (error) {
      if (error instanceof ApiError) throw error
      // 같은 Idempotency-Key로 다시 보내면 중복 생성 없이 저장된 응답을 받으므로 재시도해도 된다.
      if (timedOut) {
        throw new ApiError(0, 'TIMEOUT', `${timeoutMs}ms 안에 응답이 없습니다.`, null, { retryable: true, idempotencyKey })
      }
      if (error instanceof SyntaxError) {
        throw new ApiError(status, 'UNEXPECTED_RESPONSE', '응답 본문이 JSON이 아닙니다.', null, { idempotencyKey })
      }
      throw new ApiError(0, 'NETWORK', '서버에 연결하지 못했습니다.', null, { retryable: true, idempotencyKey })
    } finally {
      clearTimeout(timer)
    }
  }

  return { request, getSession: () => session, setSession, clearSession }
}
