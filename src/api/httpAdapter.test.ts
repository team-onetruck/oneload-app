/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: http 어댑터가 엔드포인트 경로, 본문 형식(JSON/multipart), 세션 토큰 보관을 백엔드 계약대로 쓰는지 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from './client'
import type { FetchLike } from './client'
import { createHttpAdapter } from './httpAdapter'

interface Call {
  url: string
  init: RequestInit
  headers: Headers
}

function fakeFetch(...bodies: unknown[]) {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init, headers: new Headers(init.headers) })
    return new Response(JSON.stringify(bodies.shift() ?? {}), { status: 200 })
  }
  return { fetch, calls }
}

const BASE = 'http://api.test/api/v1'

const created = {
  session_id: 'ses_1',
  session_token: 'tok_1',
  expires_in_s: 7200,
  language: 'ko',
  map_id: 'seoul-station',
  map_version: '2026-10-22.1',
  session: { state: 'idle', revision: 1 },
}

describe('createHttpAdapter', () => {
  it('createSession이 받은 토큰을 보관해 다음 세션 API에 붙인다', async () => {
    const { fetch, calls } = fakeFetch(created, {})
    const api = createHttpAdapter(createApiClient({ baseUrl: BASE, fetch, storage: null }))

    await api.createSession({ language: 'ko', map_id: 'seoul-station', client: { platform: 'web', app_version: 'test', ar_capable: false } })
    await api.getNavigationState('ses_1')

    expect(calls[0]).toMatchObject({ url: `${BASE}/sessions`, init: { method: 'POST' } })
    expect(calls[1].url).toBe(`${BASE}/sessions/ses_1/navigation-state`)
    expect(calls[1].headers.get('Authorization')).toBe('Bearer tok_1')
    expect(api.getSavedSessionId()).toBe('ses_1')

    api.clearSession()
    expect(api.getSavedSessionId()).toBeNull()
  })

  it('sendMessage는 사진이 없으면 JSON, 있으면 값이 있는 필드만 multipart로 보낸다', async () => {
    const { fetch, calls } = fakeFetch({}, {})
    const api = createHttpAdapter(createApiClient({ baseUrl: BASE, fetch, storage: null }))

    await api.sendMessage('ses_1', { message: '돈은 어떻게 내요?', language: null })
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
    await api.sendMessage('ses_1', { message: '뭘 눌러요?', language: null, image: photo })

    expect(calls[0].url).toBe(`${BASE}/sessions/ses_1/messages`)
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ message: '돈은 어떻게 내요?', language: null })

    const form = calls[1].init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('message')).toBe('뭘 눌러요?')
    expect(form.has('language')).toBe(false)
    expect(form.get('image')).toBeInstanceOf(Blob)
  })

  it('postLocalization은 사진과 map_version을 multipart로 보낸다', async () => {
    const { fetch, calls } = fakeFetch({})
    const api = createHttpAdapter(createApiClient({ baseUrl: BASE, fetch, storage: null }))

    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
    await api.postLocalization('ses_1', { image: photo, map_version: '2026-10-22.1', floor_hint: 'B1' })

    expect(calls[0].url).toBe(`${BASE}/sessions/ses_1/localizations`)
    const form = calls[0].init.body as FormData
    expect(form.get('map_version')).toBe('2026-10-22.1')
    expect(form.get('floor_hint')).toBe('B1')
    expect(form.has('last_node_id')).toBe(false)
    expect(form.get('image')).toBeInstanceOf(Blob)
  })

  it('세션 API는 계약의 경로와 메서드를 쓴다', async () => {
    const { fetch, calls } = fakeFetch()
    const api = createHttpAdapter(createApiClient({ baseUrl: BASE, fetch, storage: null }))

    await api.patchSession('ses_1', { expected_revision: 1, language: 'en' })
    await api.confirmLocation('ses_1', { expected_revision: 2, method: 'manual', selected_node_id: 'line4-gates' })
    await api.createRoute('ses_1', {
      expected_revision: 3,
      destination_poi_id: 'poi-express-tickets',
      map_version: 'v1',
      start: { type: 'confirmed_node' },
      reroute: false,
    })
    await api.postNavigationEvents('ses_1', {
      events: [{ event_id: 'ev-1', type: 'arrived', client_timestamp: '2026-10-23T00:00:00Z', context: {} }],
    })
    await api.postFeedback('ses_1', { rating: 5, category: 'other', comment: '', allow_image_retention: false })

    expect(calls.map((c) => `${c.init.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'PATCH /sessions/ses_1',
      'POST /sessions/ses_1/location-confirmations',
      'POST /sessions/ses_1/routes',
      'POST /sessions/ses_1/navigation-events',
      'POST /sessions/ses_1/feedback',
    ])
  })

  it('지도 API는 토큰 없이 GET으로 부르고 검색어를 query로 보낸다', async () => {
    const { fetch, calls } = fakeFetch()
    const api = createHttpAdapter(createApiClient({ baseUrl: BASE, fetch, storage: null }))

    await api.getHealth()
    await api.getMaps()
    await api.getMapGraph('seoul-station')
    await api.searchPois('seoul-station', 'express')

    expect(calls.map((c) => `${c.init.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'GET /health',
      'GET /maps',
      'GET /maps/seoul-station/graph',
      'GET /maps/seoul-station/pois?query=express',
    ])
  })
})
