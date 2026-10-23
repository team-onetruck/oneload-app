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
    if (reply === 'timeout')
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    return Promise.resolve(reply)
  }
  return { fetch, calls }
}
