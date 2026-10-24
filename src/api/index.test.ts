/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: API 진입점이 과거 모드 설정과 관계없이 HTTP 요청을 보내고 연결 실패를 데모로 대체하지 않는지 검증한다
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const body = { language: 'ko' as const, map_id: 'seoul-station', client: { platform: 'web', app_version: 'test', ar_capable: false } }
const created = {
  session_id: 'ses_server', session_token: 'tok_server', expires_in_s: 7200,
  language: 'ko', map_id: 'seoul-station', map_version: '2026-10-22.1',
  session: { state: 'idle', revision: 1 },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('서버 연결 API 진입점', () => {
  it.each([undefined, 'mock', 'http'])('과거 VITE_API_MODE=%s 설정에서도 HTTP로 세션을 만든다', async (mode) => {
    vi.resetModules()
    vi.stubEnv('VITE_API_MODE', mode)
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(created), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const api = await import('./index')

    await expect(api.createSession(body, { idempotencyKey: 'session-key' })).resolves.toEqual(created)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/sessions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(body)
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('session-key')
    expect(api.getSavedSessionId()).toBe('ses_server')
    api.clearSession()
    expect(api.getSavedSessionId()).toBeNull()
  })

  it('서버 연결 실패는 오류를 반환하고 데모 세션을 만들지 않는다', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_MODE', 'mock')
    const fetch = vi.fn().mockRejectedValue(new TypeError('연결 실패'))
    vi.stubGlobal('fetch', fetch)
    const api = await import('./index')

    await expect(api.createSession(body)).rejects.toMatchObject({ code: 'NETWORK' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(api.getSavedSessionId()).toBeNull()
  })
})
