/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: fetch 래퍼의 헤더 부여, Idempotency-Key, 오류 변환(409/503/타임아웃/네트워크), 토큰 복구를 검증하는 단위 테스트
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient, SESSION_STORAGE_KEY } from './client'
import type { FetchLike, TokenStorage } from './client'
import { ApiError, isAiServiceUnavailable, isRevisionConflict } from './errors'
import { readMultipart } from './fakeFetch'

interface Call {
  url: string
  init: RequestInit
  headers: Headers
}

// 넘긴 응답을 차례로 돌려주는 가짜 fetch. Error를 넣으면 그 자리에서 연결 실패로 던진다.
function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init, headers: new Headers(init.headers) })
    const next = responses.shift()
    if (!next) throw new Error('준비한 응답보다 요청이 많다')
    if (next instanceof Error) throw next
    return next
  }
  return { fetch, calls }
}

// 응답 없이 기다리다가 abort되면 끊기는 fetch
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const serverError = (status: number, code: string, details: Record<string, unknown> = {}) =>
  json(status, { error: { code, message: `${code} 메시지`, retryable: status === 409 || status === 503, details }, request_id: 'req_abc123' })

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage: TokenStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
  return { storage, data }
}

const BASE = 'http://api.test/api/v1'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('요청 헤더', () => {
  it('주소를 지정하지 않으면 같은 origin의 /api/v1로 보낸다', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const { fetch, calls } = fakeFetch(json(200, { maps: [] }))
    await createApiClient({ fetch, storage: null }).request('/maps')
    expect(calls[0].url).toBe('/api/v1/maps')
  })

  it('세션이 없으면 Authorization을 붙이지 않고, 값이 있는 query만 붙인다', async () => {
    const { fetch, calls } = fakeFetch(json(200, {}))
    await createApiClient({ baseUrl: BASE, fetch, storage: null }).request('/maps/seoul-station/pois', {
      query: { query: '직통', skip: undefined },
    })
    expect(calls[0].url).toBe(`${BASE}/maps/seoul-station/pois?query=%EC%A7%81%ED%86%B5`)
    expect(calls[0].headers.has('Authorization')).toBe(false)
  })

  it('세션을 보관하면 모든 요청에 Bearer 토큰을 붙인다', async () => {
    const { fetch, calls } = fakeFetch(json(200, {}), json(200, {}))
    const client = createApiClient({ baseUrl: BASE, fetch, storage: null })
    client.setSession({ sessionId: 'ses_1', token: 'tok_1' })
    await client.request('/sessions/ses_1/navigation-state')
    await client.request('/sessions/ses_1/messages', { method: 'POST', json: { message: '안녕' } })
    expect(calls.map((c) => c.headers.get('Authorization'))).toEqual(['Bearer tok_1', 'Bearer tok_1'])
  })

  it('JSON 본문에는 Content-Type을 붙이고, FormData는 키로 정한 경계값의 multipart로 직접 직렬화한다', async () => {
    const { fetch, calls } = fakeFetch(json(200, {}), json(200, {}))
    const client = createApiClient({ baseUrl: BASE, fetch, storage: null })
    await client.request('/a', { method: 'POST', json: { message: '안녕' } })
    const form = new FormData()
    form.append('map_version', 'v1')
    await client.request('/b', { method: 'POST', form, idempotencyKey: 'key-1' })
    expect(calls[0].headers.get('Content-Type')).toBe('application/json')
    expect(calls[0].init.body).toBe('{"message":"안녕"}')
    expect(calls[1].headers.get('Content-Type')).toBe('multipart/form-data; boundary=oneload-key-1')
    expect(calls[1].init.body).toBeInstanceOf(Blob)
    expect((await readMultipart(calls[1].init)).get('map_version')).toBe('v1')
  })
})

describe('Idempotency-Key', () => {
  it('POST와 PATCH에는 요청마다 새 UUID를 붙이고 GET에는 붙이지 않는다', async () => {
    const { fetch, calls } = fakeFetch(json(200, {}), json(200, {}), json(200, {}), json(200, {}))
    const client = createApiClient({ baseUrl: BASE, fetch, storage: null })
    await client.request('/sessions', { method: 'POST', json: {} })
    await client.request('/sessions', { method: 'POST', json: {} })
    await client.request('/sessions/ses_1', { method: 'PATCH', json: {} })
    await client.request('/maps')

    const keys = calls.map((c) => c.headers.get('Idempotency-Key'))
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    for (const key of keys.slice(0, 3)) expect(key).toMatch(uuid)
    expect(new Set(keys.slice(0, 3)).size).toBe(3)
    expect(keys[3]).toBeNull()
  })

  it('재시도할 때 넘긴 키를 그대로 쓴다', async () => {
    const { fetch, calls } = fakeFetch(json(200, {}))
    await createApiClient({ baseUrl: BASE, fetch, storage: null }).request('/sessions', {
      method: 'POST',
      json: {},
      idempotencyKey: 'retry-key-1',
    })
    expect(calls[0].headers.get('Idempotency-Key')).toBe('retry-key-1')
  })

  it('자동으로 만든 키를 오류에 남겨, 재시도 때 같은 키와 같은 본문을 보낼 수 있다', async () => {
    const { fetch, calls } = fakeFetch(new TypeError('fetch failed'), json(200, { ok: true }))
    const client = createApiClient({ baseUrl: BASE, fetch, storage: null })
    const message = { message: '돈은 어떻게 내요?' }

    const error = await client.request('/sessions/ses_1/messages', { method: 'POST', json: message }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    const { idempotencyKey } = error as ApiError
    expect(idempotencyKey).toBe(calls[0].headers.get('Idempotency-Key'))
    expect(error).toMatchObject({ code: 'NETWORK', retryable: true })

    await client.request('/sessions/ses_1/messages', { method: 'POST', json: message, idempotencyKey: idempotencyKey ?? undefined })
    expect(calls[1].headers.get('Idempotency-Key')).toBe(idempotencyKey)
    expect(calls[1].init.body).toBe(calls[0].init.body)
  })

  it('같은 키로 다시 보낸 multipart는 Content-Type과 본문 바이트가 처음과 같고, 키가 다르면 경계값이 다르다', async () => {
    const { fetch, calls } = fakeFetch(new TypeError('fetch failed'), json(200, {}), json(200, {}))
    const client = createApiClient({ baseUrl: BASE, fetch, storage: null })
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], { type: 'image/jpeg' })
    // 어댑터처럼 시도마다 FormData를 새로 만든다
    const form = () => {
      const f = new FormData()
      f.append('image', photo)
      f.append('map_version', 'v1')
      return f
    }

    const error = await client.request('/sessions/ses_1/localizations', { method: 'POST', form: form() }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'NETWORK' })
    const idempotencyKey = (error as ApiError).idempotencyKey ?? undefined
    await client.request('/sessions/ses_1/localizations', { method: 'POST', form: form(), idempotencyKey })
    await client.request('/sessions/ses_1/localizations', { method: 'POST', form: form() })

    const bytes = await Promise.all(calls.map(async (c) => new Uint8Array(await new Response(c.init.body).arrayBuffer())))
    const contentTypes = calls.map((c) => c.headers.get('Content-Type'))
    expect(contentTypes[1]).toBe(contentTypes[0])
    expect(bytes[1]).toEqual(bytes[0])
    expect(contentTypes[2]).not.toBe(contentTypes[0])
    expect(bytes[2]).not.toEqual(bytes[0])
  })

  it('서버 오류에도 보낸 키를 남기고, 키를 보내지 않은 GET 오류는 null이다', async () => {
    const { fetch, calls } = fakeFetch(serverError(503, 'AI_SERVICE_UNAVAILABLE'), serverError(404, 'MAP_NOT_FOUND'))
    const client = createApiClient({ baseUrl: BASE, fetch, storage: null, newIdempotencyKey: () => 'auto-key-1' })

    const postError = await client
      .request('/sessions/ses_1/localizations', { method: 'POST', form: new FormData() })
      .catch((e: unknown) => e)
    const getError = await client.request('/maps/unknown/graph').catch((e: unknown) => e)

    expect(postError).toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE', idempotencyKey: 'auto-key-1' })
    expect(getError).toMatchObject({ code: 'MAP_NOT_FOUND', idempotencyKey: null })
    expect(calls[1].headers.has('Idempotency-Key')).toBe(false)
  })
})

describe('오류 변환', () => {
  it('409 REVISION_CONFLICT를 서버 code, details, request_id가 담긴 ApiError로 바꾼다', async () => {
    const { fetch } = fakeFetch(serverError(409, 'REVISION_CONFLICT', { revision: 3 }))
    const error = await createApiClient({ baseUrl: BASE, fetch, storage: null })
      .request('/sessions/ses_1', { method: 'PATCH', json: { expected_revision: 2 } })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      code: 'REVISION_CONFLICT',
      message: 'REVISION_CONFLICT 메시지',
      requestId: 'req_abc123',
      retryable: true,
      details: { revision: 3 },
    })
    expect(isRevisionConflict(error)).toBe(true)
    expect(isAiServiceUnavailable(error)).toBe(false)
  })

  it('같은 409라도 code가 다르면 REVISION_CONFLICT로 보지 않는다', async () => {
    const { fetch } = fakeFetch(serverError(409, 'MAP_VERSION_MISMATCH', { required_map_version: 'v2' }))
    const error = await createApiClient({ baseUrl: BASE, fetch, storage: null })
      .request('/sessions/ses_1/routes', { method: 'POST', json: {} })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 409, code: 'MAP_VERSION_MISMATCH' })
    expect(isRevisionConflict(error)).toBe(false)
  })

  it('503 AI_SERVICE_UNAVAILABLE을 구분할 수 있다', async () => {
    const { fetch } = fakeFetch(serverError(503, 'AI_SERVICE_UNAVAILABLE'))
    const error = await createApiClient({ baseUrl: BASE, fetch, storage: null })
      .request('/sessions/ses_1/localizations', { method: 'POST', form: new FormData() })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 503, code: 'AI_SERVICE_UNAVAILABLE', retryable: true })
    expect(isAiServiceUnavailable(error)).toBe(true)
    expect(isRevisionConflict(error)).toBe(false)
  })

  it('공통 형식이 아닌 오류 응답은 UNEXPECTED_RESPONSE로 바꾸고 X-Request-ID를 남긴다', async () => {
    const { fetch } = fakeFetch(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'X-Request-ID': 'req_hdr' } }))
    const error = await createApiClient({ baseUrl: BASE, fetch, storage: null }).request('/maps').catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 502, code: 'UNEXPECTED_RESPONSE', requestId: 'req_hdr' })
  })

  it('연결에 실패하면 status 0의 NETWORK로 바꾼다', async () => {
    const { fetch } = fakeFetch(new TypeError('fetch failed'))
    const error = await createApiClient({ baseUrl: BASE, fetch, storage: null }).request('/maps').catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 0, code: 'NETWORK', retryable: true })
  })

  it('기본 15초 안에 응답이 없으면 요청을 끊고 TIMEOUT으로 바꾼다', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init.signal ?? undefined
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })

    let settled = false
    const pending = createApiClient({ baseUrl: BASE, fetch: hanging, storage: null })
      .request('/sessions', { method: 'POST', json: {} })
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true
      })

    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ status: 0, code: 'TIMEOUT', retryable: true })
    expect(signal?.aborted).toBe(true)
  })

  it('호출별 timeoutMs가 클라이언트 기본값보다 먼저 쓰이고, 타임아웃 오류에도 키가 남는다', async () => {
    vi.useFakeTimers()
    const client = createApiClient({ baseUrl: BASE, fetch: hangingFetch, storage: null, timeoutMs: 30_000 })

    let settled = false
    const pending = client
      .request('/sessions/ses_1/localizations', { method: 'POST', form: new FormData(), timeoutMs: 3_000, idempotencyKey: 'photo-1' })
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true
      })

    await vi.advanceTimersByTimeAsync(2_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({
      code: 'TIMEOUT',
      message: '3000ms 안에 응답이 없습니다.',
      retryable: true,
      idempotencyKey: 'photo-1',
    })
  })

  it('클라이언트 timeoutMs는 기본 15초를 바꾼다', async () => {
    vi.useFakeTimers()
    let settled = false
    const pending = createApiClient({ baseUrl: BASE, fetch: hangingFetch, storage: null, timeoutMs: 30_000 })
      .request('/maps/seoul-station/graph')
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true
      })

    await vi.advanceTimersByTimeAsync(15_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await pending).toMatchObject({ code: 'TIMEOUT', idempotencyKey: null })
  })

  it('응답이 제때 오면 타임아웃 타이머를 남기지 않는다', async () => {
    vi.useFakeTimers()
    const { fetch } = fakeFetch(json(200, { ok: true }))
    await expect(createApiClient({ baseUrl: BASE, fetch, storage: null }).request('/health')).resolves.toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('세션 토큰 보관', () => {
  it('새로고침 뒤 새 클라이언트가 sessionStorage에서 세션을 복구해 토큰을 붙인다', async () => {
    const { storage } = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify({ sessionId: 'ses_9', token: 'tok_9' }) })
    const { fetch, calls } = fakeFetch(json(200, {}))
    const client = createApiClient({ baseUrl: BASE, fetch, storage })

    expect(client.getSession()).toEqual({ sessionId: 'ses_9', token: 'tok_9' })
    await client.request('/sessions/ses_9/navigation-state')
    expect(calls[0].headers.get('Authorization')).toBe('Bearer tok_9')
  })

  it('setSession은 메모리와 저장소에 함께 남기고 clearSession은 둘 다 지운다', () => {
    const { storage, data } = memoryStorage()
    const client = createApiClient({ baseUrl: BASE, storage })

    client.setSession({ sessionId: 'ses_1', token: 'tok_1' })
    expect(client.getSession()).toEqual({ sessionId: 'ses_1', token: 'tok_1' })
    expect(JSON.parse(data.get(SESSION_STORAGE_KEY) ?? 'null')).toEqual({ sessionId: 'ses_1', token: 'tok_1' })

    client.clearSession()
    expect(client.getSession()).toBeNull()
    expect(data.has(SESSION_STORAGE_KEY)).toBe(false)
  })

  it('저장소 쓰기가 실패해도 메모리의 토큰으로 계속 요청한다', async () => {
    const broken: TokenStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {},
    }
    const { fetch, calls } = fakeFetch(json(200, {}))
    const client = createApiClient({ baseUrl: BASE, fetch, storage: broken })
    client.setSession({ sessionId: 'ses_1', token: 'tok_1' })
    await client.request('/sessions/ses_1/navigation-state')
    expect(calls[0].headers.get('Authorization')).toBe('Bearer tok_1')
  })

  it('저장된 값이 깨져 있으면 세션이 없는 것으로 본다', () => {
    for (const raw of ['not json', '{"sessionId":"ses_1"}', 'null']) {
      const { storage } = memoryStorage({ [SESSION_STORAGE_KEY]: raw })
      expect(createApiClient({ baseUrl: BASE, storage }).getSession()).toBeNull()
    }
  })
})
