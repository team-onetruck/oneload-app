/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 단위 테스트용 가짜 fetch. 정해 둔 응답을 순서대로 돌려주고 보낸 요청을 기록한다
 */
import type { FetchLike } from './client'
import type { ServerErrorCode } from './errors'

// 서버가 retryable: true로 보내는 코드 (backend/app/errors.py _RETRYABLE)
const RETRYABLE = new Set<ServerErrorCode>(['AI_SERVICE_UNAVAILABLE', 'REVISION_CONFLICT'])

export interface RecordedCall {
  method: string
  // /api/v1 뒤의 경로
  path: string
  headers: Headers
  json: unknown
}

// timeout: abort 신호가 올 때까지 응답하지 않음 · network: fetch가 TypeError로 실패함
export type FakeReply = Response | 'timeout' | 'network'

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function errorResponse(status: number, code: ServerErrorCode, details: Record<string, unknown> = {}): Response {
  return jsonResponse(status, {
    error: { code, message: code, retryable: RETRYABLE.has(code), details },
    request_id: 'req_test',
  })
}

// 보낸 multipart 본문을 서버처럼 다시 읽는다. 본문은 경계값을 정해 직접 만든 Blob이다 (src/api/multipart.ts)
export function readMultipart(init: RequestInit): Promise<FormData> {
  const contentType = new Headers(init.headers).get('Content-Type') ?? ''
  return new Response(init.body, { headers: { 'Content-Type': contentType } }).formData()
}

export interface SentBody {
  idempotencyKey: string | null
  contentType: string | null
  bytes: Uint8Array
}

// 서버는 요청을 처리해 응답을 저장했지만 클라이언트가 그 응답을 받지 못한 상황을 만든다 (MSW 흐름 테스트용).
// 경로가 suffix로 끝나는 첫 요청은 끝까지 처리시킨 뒤 abort될 때까지 응답을 넘기지 않아 클라이언트에는 TIMEOUT이 된다.
// suffix 요청마다 보낸 키, Content-Type, 본문 바이트를 sent에, 잃어버린 응답 본문을 lost에 남긴다.
export function losingFirstResponse(suffix: string, next: FetchLike = (url, init) => globalThis.fetch(url, init)) {
  const sent: SentBody[] = []
  const lost: unknown[] = []
  const fetch: FetchLike = async (url, init) => {
    if (!url.endsWith(suffix)) return next(url, init)
    const headers = new Headers(init.headers)
    const bytes = new Uint8Array(await new Response(init.body).arrayBuffer())
    sent.push({ idempotencyKey: headers.get('Idempotency-Key'), contentType: headers.get('Content-Type'), bytes })
    if (sent.length > 1) return next(url, init)
    // 클라이언트 타임아웃과 상관없이 서버 처리는 끝까지 가게 abort 신호를 떼고 보낸다.
    const res = await next(url, { ...init, signal: undefined })
    lost.push(await res.json())
    // 서버 처리가 클라이언트 타임아웃보다 늦으면 여기 올 때 이미 끊겨 있다. 그때 리스너만 붙이면 영원히 기다린다
    return noResponse(init.signal)
  }
  return { fetch, sent, lost }
}

export function fakeFetch(replies: FakeReply[]) {
  const queue = [...replies]
  const calls: RecordedCall[] = []
  const fetch: FetchLike = (url, init) => {
    calls.push({
      method: init.method ?? 'GET',
      path: new URL(url, 'http://test').pathname.replace(/^\/api\/v1/, ''),
      headers: new Headers(init.headers),
      json: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const reply = queue.shift()
    if (!reply) return Promise.reject(new Error(`준비하지 않은 요청: ${init.method ?? 'GET'} ${url}`))
    if (reply === 'network') return Promise.reject(new TypeError('Failed to fetch'))
    if (reply === 'timeout') return noResponse(init.signal)
    return Promise.resolve(reply)
  }
  return { fetch, calls }
}

// 서버로 보내지 않고 abort될 때까지 기다린다. 이미 끊긴 신호면 바로 끊는다
export function noResponse(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('aborted', 'AbortError'))
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
  })
}

// 응답 없음(타임아웃)을 클라이언트 쪽에서 만든다 (MSW 흐름 테스트용).
// 경로가 suffix로 끝나는 요청 중 처음 times번은 서버로 보내지 않고 abort될 때까지 기다리고, 나머지는 next로 보낸다.
// mockBackend.hang은 요청을 undici 연결까지 보낸 뒤 끊기게 해서 그 소켓이 닫히고, 다음 요청은 새 연결을 연다.
// @mswjs/interceptors는 새 연결에서 클라이언트가 읽기 시작한 뒤 한 틱 안에 요청 바이트가 없으면 실제 네트워크로 넘기므로
// (http/source.ts onClientRead), 느린 러너에서는 다음 요청이 getaddrinfo ENOTFOUND로 타이머보다 먼저 실패해 NETWORK가 된다.
export function unansweredFirst(suffix: string, times = 1, next: FetchLike = (url, init) => globalThis.fetch(url, init)): FetchLike {
  let left = times
  return (url, init) => {
    if (left > 0 && url.endsWith(suffix)) {
      left -= 1
      return noResponse(init.signal)
    }
    return next(url, init)
  }
}
