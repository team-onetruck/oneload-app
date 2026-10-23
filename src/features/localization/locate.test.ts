/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 사진 위치 인식 요청(locateFromPhoto)이 서버 응답별로 맞는 화면 결과를 내는지 가짜 응답으로 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from '../../api/client'
import type { FetchLike } from '../../api/client'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { LocalizationOut } from '../../api/types'
import { locateFromPhoto, toLocateResult } from './locate'

const MAP_VERSION = '2026-10-22.1'
const PHOTO = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' })
const noCompress = async (photo: Blob) => photo

// 서버 LocalizationOut 모양의 가짜 응답 (backend/app/api/location.py)
const CANDIDATES: LocalizationOut = {
  localization_id: 'loc_1',
  status: 'needs_confirmation',
  map_version: MAP_VERSION,
  expires_in_s: 300,
  candidates: [
    { node_id: 'line4-gates', floor_id: 'B1', rank_score: 0.75, heading_deg: null, landmark_id: 'lm-line4-transfer', evidence: ['“공항철도” 안내판', '“4호선” 안내판'] },
    { node_id: 'line1-gates', floor_id: 'B1', rank_score: 0.5, heading_deg: null, landmark_id: 'lm-line1-transfer', evidence: ['“공항철도” 안내판'] },
  ],
  retake_hint: null,
  next_action: 'confirm_location',
  session: { state: 'needs_confirmation', revision: 4 },
}

const NO_MATCH: LocalizationOut = {
  localization_id: 'loc_2',
  status: 'no_match',
  map_version: MAP_VERSION,
  expires_in_s: 300,
  candidates: [],
  retake_hint: '사진이 흐려요. 잠시 멈춰서 다시 찍어주세요.',
  next_action: 'recapture',
  session: { state: 'needs_location', revision: 4 },
}

// 실제 http 어댑터에 가짜 fetch를 끼워 요청 모양과 응답 처리를 함께 본다.
function fakeServer(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  const client = createApiClient({ baseUrl: '/api/v1', fetch, storage: null, newIdempotencyKey: () => 'key-1' })
  client.setSession({ sessionId: 'ses_1', token: 'tok_1' })
  return { api: createHttpAdapter(client), calls }
}

describe('toLocateResult', () => {
  it('needs_confirmation이면 서버 순서 그대로 후보와 근거를 넘긴다', () => {
    const result = toLocateResult(CANDIDATES)
    expect(result).toEqual({ kind: 'candidates', localizationId: 'loc_1', candidates: CANDIDATES.candidates, session: CANDIDATES.session })
  })

  it('no_match이면 서버의 재촬영 안내를 그대로 넘긴다', () => {
    expect(toLocateResult(NO_MATCH)).toEqual({ kind: 'no_match', retakeHint: NO_MATCH.retake_hint, session: NO_MATCH.session })
  })
})

describe('locateFromPhoto', () => {
  it('압축한 사진과 지도 버전을 서버 multipart 필드명으로 보낸다', async () => {
    const server = fakeServer(200, CANDIDATES)
    const compressed = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
    await locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO, async () => compressed)

    const [{ url, init }] = server.calls
    expect(url).toBe('/api/v1/sessions/ses_1/localizations')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('map_version')).toBe(MAP_VERSION)
    expect((form.get('image') as Blob).size).toBe(compressed.size)
    // 값이 없는 선택 필드는 보내지 않는다.
    expect(form.has('last_node_id')).toBe(false)
    expect(form.has('floor_hint')).toBe(false)
  })

  it('마지막으로 확정한 노드가 있으면 last_node_id로 함께 보낸다', async () => {
    const server = fakeServer(200, CANDIDATES)
    await locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION, lastNodeId: 'ktx-hall' }, PHOTO, noCompress)
    expect((server.calls[0].init.body as FormData).get('last_node_id')).toBe('ktx-hall')
  })

  it('후보 응답이면 위치를 확정하지 않고 후보 결과와 서버 session을 돌려준다', async () => {
    const server = fakeServer(200, CANDIDATES)
    const result = await locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO, noCompress)
    expect(result.kind).toBe('candidates')
    expect(result.session).toEqual({ state: 'needs_confirmation', revision: 4 })
    // 확정 요청은 사용자가 고른 뒤에만 따로 보낸다.
    expect(server.calls.map((c) => c.url)).toEqual(['/api/v1/sessions/ses_1/localizations'])
  })

  it('후보가 없으면 재촬영 결과를 돌려준다', async () => {
    const server = fakeServer(200, NO_MATCH)
    const result = await locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO, noCompress)
    expect(result).toEqual({ kind: 'no_match', retakeHint: NO_MATCH.retake_hint, session: NO_MATCH.session })
  })
})
