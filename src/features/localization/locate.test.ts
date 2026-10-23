/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 사진 위치 인식 요청(locateFromPhoto)이 서버 응답별로 맞는 화면 결과를 내는지 가짜 응답으로 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from '../../api/client'
import type { FetchLike } from '../../api/client'
import { readMultipart } from '../../api/fakeFetch'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { LocalizationOut } from '../../api/types'
import { locateFromPhoto, requestLocalization, toLocateResult } from './locate'

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
    const form = await readMultipart(init)
    expect(form.get('map_version')).toBe(MAP_VERSION)
    expect((form.get('image') as Blob).size).toBe(compressed.size)
    // 값이 없는 선택 필드는 보내지 않는다.
    expect(form.has('last_node_id')).toBe(false)
    expect(form.has('floor_hint')).toBe(false)
  })

  it('마지막으로 확정한 노드가 있으면 last_node_id로 함께 보낸다', async () => {
    const server = fakeServer(200, CANDIDATES)
    await locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION, lastNodeId: 'ktx-hall' }, PHOTO, noCompress)
    expect((await readMultipart(server.calls[0].init)).get('last_node_id')).toBe('ktx-hall')
  })

  it('후보 응답이면 위치를 확정하지 않고 후보 결과와 서버 session을 돌려준다', async () => {
    const server = fakeServer(200, CANDIDATES)
    const result = await locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO, noCompress)
    expect(result).toMatchObject({ kind: 'candidates', localizationId: 'loc_1', session: { state: 'needs_confirmation', revision: 4 } })
    // 확정 요청은 사용자가 고른 뒤에만 따로 보낸다.
    expect(server.calls.map((c) => c.url)).toEqual(['/api/v1/sessions/ses_1/localizations'])
  })

  it('후보가 없으면 재촬영 결과를 돌려준다', async () => {
    const server = fakeServer(200, NO_MATCH)
    const result = await locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO, noCompress)
    expect(result).toEqual({ kind: 'no_match', retakeHint: NO_MATCH.retake_hint, session: NO_MATCH.session })
  })
})

describe('requestLocalization', () => {
  it('이미 압축한 사진을 그대로 보내고, 넘긴 Idempotency-Key를 쓴다', async () => {
    const server = fakeServer(200, CANDIDATES)
    await requestLocalization(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO, { idempotencyKey: 'key-first' })

    const { init } = server.calls[0]
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('key-first')
    const image = (await readMultipart(init)).get('image')
    expect(image).toBeInstanceOf(Blob)
    expect((image as Blob).size).toBe(PHOTO.size)
  })

  it('키를 넘기지 않으면 클라이언트가 새 키를 만든다', async () => {
    const server = fakeServer(200, CANDIDATES)
    await requestLocalization(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO)
    expect(new Headers(server.calls[0].init.headers).get('Idempotency-Key')).toBe('key-1')
  })
})

describe('locateFromPhoto 503 폴백', () => {
  // 지금 서버(NoVision)가 실제로 보내는 오류 본문 (backend/app/ai/vision.py, app/errors.py)
  const AI_UNAVAILABLE = {
    error: { code: 'AI_SERVICE_UNAVAILABLE', message: 'Photo recognition is not configured on this server.', retryable: true, details: {} },
    request_id: 'req_1',
  }

  it('503 AI_SERVICE_UNAVAILABLE이면 후보 없이 직접 선택으로 넘기고 다시 보내지 않는다', async () => {
    const server = fakeServer(503, AI_UNAVAILABLE)
    const result = await locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO, noCompress)
    expect(result).toEqual({ kind: 'manual', reason: 'ai_unavailable' })
    expect(server.calls).toHaveLength(1)
  })

  it('다른 오류(409 INVALID_STATE 등)는 직접 선택으로 바꾸지 않고 그대로 던진다', async () => {
    const server = fakeServer(409, {
      error: { code: 'INVALID_STATE', message: 'Not allowed while the session is idle.', retryable: false, details: { state: 'idle' } },
      request_id: 'req_2',
    })
    await expect(locateFromPhoto(server.api, { sessionId: 'ses_1', mapVersion: MAP_VERSION }, PHOTO, noCompress)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    })
  })
})
