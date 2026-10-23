/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: MSW 핸들러가 백엔드 계약대로 응답하는지, 실제 http 어댑터로 백엔드 API 테스트(backend/tests/test_api.py)와 같은 흐름을 돌려 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from '../api/client'
import { ApiError, isAiServiceUnavailable, isRevisionConflict } from '../api/errors'
import { createHttpAdapter } from '../api/httpAdapter'
import { MAP_ID, MAP_VERSION } from './fixtures/seoulStation'
import { mockBackend } from './handlers'

const BASE = 'http://api.test/api/v1'
const JPEG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0)])], { type: 'image/jpeg' })

async function start(language: 'en' | 'ko' = 'en', timeoutMs?: number) {
  const client = createApiClient({ baseUrl: BASE, storage: null, timeoutMs })
  const api = createHttpAdapter(client)
  const created = await api.createSession({ language, map_id: MAP_ID, client: { platform: 'web', app_version: 'test', ar_capable: false } })
  const id = created.session_id
  const revision = async () => (await api.getNavigationState(id)).session.revision
  const route = async (destination_poi_id: string) =>
    api.createRoute(id, { expected_revision: await revision(), destination_poi_id, map_version: MAP_VERSION, start: { type: 'confirmed_node' }, reroute: false })
  const event = (type: 'navigation_started' | 'arrived' | 'navigation_cancelled', event_id: string, route_id: string) =>
    api.postNavigationEvents(id, { route_id, events: [{ event_id, type, client_timestamp: new Date().toISOString(), context: {} }] })
  return { api, client, id, revision, route, event }
}

describe('대표 흐름', () => {
  it('직통열차: 질문, 목적지, 사진 후보, 위치 확정, 경로, 출발·도착, 다음 목적지까지 이어진다', async () => {
    const { api, id, route, event } = await start()
    expect((await api.sendMessage(id, { message: 'How do I pay?' })).status).toBe('answered')

    const express = await api.sendMessage(id, { message: 'Express' })
    expect(express.destination).toEqual({ poi_id: 'poi-express-tickets' })
    expect(express.session.state).toBe('needs_location')

    mockBackend.setVision({ image_quality: 'usable', texts: ['공항철도', 'Airport Railroad', '4호선'] })
    const located = await api.postLocalization(id, { image: JPEG(), map_version: MAP_VERSION })
    expect(located.status).toBe('needs_confirmation')
    expect(located.candidates[0].node_id).toBe('line4-gates')

    const confirmed = await api.confirmLocation(id, {
      expected_revision: located.session.revision,
      method: 'photo_candidate',
      localization_id: located.localization_id,
      selected_node_id: 'line4-gates',
    })
    expect(confirmed.session.state).toBe('ready_to_navigate')

    const toCounter = await route('poi-express-tickets')
    expect(toCounter.path_node_ids).toEqual(['line4-gates', 'arex-concourse', 'express-tickets'])
    expect(toCounter.steps[0].arrow_yaw_deg).toBe(-80)

    expect((await event('navigation_started', 'e1', toCounter.route_id)).session.state).toBe('navigating')
    expect((await event('arrived', 'e2', toCounter.route_id)).session.state).toBe('arrived')

    const machine = await api.sendMessage(id, { message: 'What should I press?', image: JPEG() })
    expect(machine.assistant_message).toMatch(/^I can see a ticket machine/)

    // 도착한 표 사는 곳에서 출발하므로 사진을 다시 찍지 않는다.
    const platform = await api.sendMessage(id, { message: 'Go to the platform' })
    expect(platform.destination).toEqual({ poi_id: 'poi-express-platform' })
    expect(platform.session.state).toBe('ready_to_navigate')
    expect((await route('poi-express-platform')).path_node_ids.at(-1)).toBe('express-platform')
  })

  it('일반열차 + 카드 없음: 카드가 있는지 묻고, 없다고 하면 일반열차 표 사는 곳을 목적지로 정한다', async () => {
    const { api, id } = await start('ko')

    const askCard = await api.sendMessage(id, { message: '일반열차' })
    expect(askCard.status).toBe('needs_clarification')
    expect(askCard.suggested_replies.map((r) => r.label)).toContain('없어요')

    const noCard = await api.sendMessage(id, { message: '없어요' })
    expect(noCard.destination).toEqual({ poi_id: 'poi-allstop-tickets' })
    expect(noCard.slots).toEqual({ train_type: 'allstop', has_transit_card: 'no' })
    expect(noCard.tip).toContain('1회용 교통카드')
    expect(noCard.session.state).toBe('needs_location')
  })

  it('요금은 지어내지 않고 cannot_answer로 답한다', async () => {
    const { api, id } = await start()
    const fare = await api.sendMessage(id, { message: 'How much is the fare?' })
    expect(fare.status).toBe('cannot_answer')
    expect(fare.sources).toEqual([])
  })
})

describe('위치 확인', () => {
  it('사진에 안내판이 없으면 no_match와 재촬영 안내를 주고, 직접 선택은 그대로 된다', async () => {
    const { api, id, revision } = await start()
    await api.sendMessage(id, { message: 'Express' })
    mockBackend.setVision({ image_quality: 'no_signage', texts: [] })

    const noMatch = await api.postLocalization(id, { image: JPEG(), map_version: MAP_VERSION })
    expect(noMatch.status).toBe('no_match')
    expect(noMatch.retake_hint).toBeTruthy()
    expect(noMatch.session.state).toBe('needs_location')

    const manual = await api.confirmLocation(id, { expected_revision: await revision(), method: 'manual', selected_node_id: 'ktx-hall' })
    expect(manual.location.floor_id).toBe('2F')
  })

  it('사진 결과에 없는 후보는 확정할 수 없다', async () => {
    const { api, id } = await start()
    await api.sendMessage(id, { message: 'Express' })
    mockBackend.setVision({ image_quality: 'usable', texts: ['4호선', 'Airport Railroad'] })
    const located = await api.postLocalization(id, { image: JPEG(), map_version: MAP_VERSION })

    const confirm = api.confirmLocation(id, {
      expected_revision: located.session.revision,
      method: 'photo_candidate',
      localization_id: located.localization_id,
      selected_node_id: 'ktx-hall',
    })
    await expect(confirm).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('사진 업로드는 JPEG, 2MB 이하, 같은 지도 버전만 받는다', async () => {
    const { api, id } = await start()
    await api.sendMessage(id, { message: 'Express' })

    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    const huge = new Blob([new Uint8Array([0xff, 0xd8, 0xff]), new Uint8Array(2 * 1024 * 1024)], { type: 'image/jpeg' })
    await expect(api.postLocalization(id, { image: png, map_version: MAP_VERSION })).rejects.toMatchObject({ status: 415, code: 'UNSUPPORTED_IMAGE' })
    await expect(api.postLocalization(id, { image: huge, map_version: MAP_VERSION })).rejects.toMatchObject({ status: 413, code: 'IMAGE_TOO_LARGE' })
    await expect(api.postLocalization(id, { image: JPEG(), map_version: '2020-01-01.1' })).rejects.toMatchObject({
      status: 409,
      code: 'MAP_VERSION_MISMATCH',
    })
  })
})

describe('세션 규칙', () => {
  it('revision이 다르면 409 REVISION_CONFLICT와 서버의 revision을 돌려준다', async () => {
    const { api, id, revision } = await start()
    await api.sendMessage(id, { message: 'Express' })

    const stale = api.confirmLocation(id, { expected_revision: 1, method: 'manual', selected_node_id: 'ktx-hall' })
    await expect(stale).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT', retryable: true, details: { revision: await revision() } })
  })

  it('순서가 맞지 않는 요청은 거절한다', async () => {
    const { api, id, revision } = await start()

    // 목적지가 없어서 위치 확인 단계가 아니다.
    await expect(api.postLocalization(id, { image: JPEG(), map_version: MAP_VERSION })).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' })
    // 목적지는 /messages로만 정한다.
    const route = api.createRoute(id, {
      expected_revision: await revision(),
      destination_poi_id: 'poi-express-tickets',
      map_version: MAP_VERSION,
      start: { type: 'confirmed_node' },
      reroute: false,
    })
    await expect(route).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('PATCH로는 목적지를 정할 수 없다', async () => {
    const { client, id, revision } = await start()
    const patch = client.request(`/sessions/${id}`, { method: 'PATCH', json: { expected_revision: await revision(), destination_poi_id: 'x' } })
    await expect(patch).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('같은 Idempotency-Key는 저장된 응답을 돌려주고, 다른 본문에 쓰면 거절하며, 없으면 400이다', async () => {
    const { client, id } = await start()
    const send = (message: string) => client.request(`/sessions/${id}/messages`, { method: 'POST', json: { message }, idempotencyKey: 'key-1' })

    const first = await send('Express')
    expect(await send('Express')).toEqual(first)
    await expect(send('All-stop')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })

    const token = client.getSession()!.token
    const missing = await fetch(`${BASE}/sessions/${id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Express' }),
    })
    expect(missing.status).toBe(400)
    expect((await missing.json()).error.code).toBe('BAD_REQUEST')
  })

  it('토큰이 없으면 401, 다른 세션의 토큰이면 403이다', async () => {
    const first = await start()
    const ownToken = first.client.getSession()!.token
    const second = await start()

    const other = await fetch(`${BASE}/sessions/${second.id}/navigation-state`, { headers: { Authorization: `Bearer ${ownToken}` } })
    const anonymous = await fetch(`${BASE}/sessions/${second.id}/navigation-state`)
    expect([other.status, (await other.json()).error.code]).toEqual([403, 'SESSION_FORBIDDEN'])
    expect([anonymous.status, (await anonymous.json()).error.code]).toEqual([401, 'SESSION_UNAUTHORIZED'])
  })

  it('지도는 토큰 없이 조회한다', async () => {
    const api = createHttpAdapter(createApiClient({ baseUrl: BASE, storage: null }))
    const graph = await api.getMapGraph(MAP_ID)
    const pois = await api.searchPois(MAP_ID, '직통')

    expect(graph.edges[0].from).toBe('ktx-hall')
    expect(new Set(pois.pois.map((p) => p.poi_id))).toEqual(new Set(['poi-express-tickets', 'poi-express-platform']))
    await expect(api.getMapGraph('busan')).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
  })
})

describe('mockBackend 스위치', () => {
  it('conflictNext: 다음 revision 검사가 409가 되고, navigation-state로 다시 읽은 revision으로는 성공한다', async () => {
    const { api, id, revision } = await start()
    await api.sendMessage(id, { message: 'Express' })
    const before = await revision()
    mockBackend.conflictNext()

    const conflict = await api.confirmLocation(id, { expected_revision: before, method: 'manual', selected_node_id: 'ktx-hall' }).catch((e: unknown) => e)
    expect(isRevisionConflict(conflict)).toBe(true)

    const synced = await revision()
    expect(synced).toBe(before + 1)
    const confirmed = await api.confirmLocation(id, { expected_revision: synced, method: 'manual', selected_node_id: 'ktx-hall' })
    expect(confirmed.session.state).toBe('ready_to_navigate')
  })

  it("setVision('unavailable'): 사진 위치 인식이 503 AI_SERVICE_UNAVAILABLE이고 세션 상태는 그대로다", async () => {
    const { api, id } = await start()
    const express = await api.sendMessage(id, { message: 'Express' })
    mockBackend.setVision('unavailable')

    const failed = await api.postLocalization(id, { image: JPEG(), map_version: MAP_VERSION }).catch((e: unknown) => e)
    expect(isAiServiceUnavailable(failed)).toBe(true)
    expect(failed).toMatchObject({ status: 503, retryable: true })
    expect((await api.getNavigationState(id)).session).toEqual(express.session)
  })

  it('hang: 그 엔드포인트의 다음 요청만 응답하지 않아 클라이언트가 TIMEOUT을 내고, 그다음 요청은 응답한다', async () => {
    const { api, id } = await start('en', 50)
    mockBackend.hang('messages')

    const timedOut = await api.sendMessage(id, { message: 'Express' }).catch((e: unknown) => e)
    expect(timedOut).toBeInstanceOf(ApiError)
    expect(timedOut).toMatchObject({ code: 'TIMEOUT', retryable: true })
    expect((await api.sendMessage(id, { message: 'Express' })).destination).toEqual({ poi_id: 'poi-express-tickets' })
  })

  it('reset: 테스트마다 세션과 스위치가 지워진다', async () => {
    const { id } = await start()
    mockBackend.setVision('unavailable')
    mockBackend.reset()
    expect(mockBackend.session(id)).toBeUndefined()
  })
})
