/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: mock 어댑터가 기존 mock 규칙을 서버 응답 모양(세션 상태·revision, 칩, 후보, 경로, 이벤트)으로 돌려주는지 검증한다
 */
import { describe, expect, it } from 'vitest'
import { NODES, PANOS } from '../data'
import { serverGuide, toActiveRoute } from '../features/route/guide'
import { UI } from '../i18n'
import { createMockAdapter, MOCK_MAP_ID, MOCK_MAP_VERSION } from './mockAdapter'

async function start(language: 'en' | 'ko' = 'en') {
  const api = createMockAdapter({ aiDelayMs: 0, visionDelayMs: 0 })
  const created = await api.createSession({ language, map_id: MOCK_MAP_ID, client: { platform: 'web', app_version: 'test', ar_capable: false } })
  const id = created.session_id
  const revision = async () => (await api.getNavigationState(id)).session.revision
  const say = (message: string) => api.sendMessage(id, { message })
  const photo = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
  return { api, id, created, revision, say, photo }
}

describe('createMockAdapter', () => {
  it('직통열차: 칩 → 목적지 → 데모 사진 후보 → 확정 → 경로 → 출발·도착 → 승강장까지 서버처럼 상태와 revision이 바뀐다', async () => {
    const { api, id, created, revision, say, photo } = await start()
    expect(created.session).toEqual({ state: 'idle', revision: 1 })

    const types = await say('Incheon Airport')
    expect(types).toMatchObject({ status: 'needs_clarification', next_action: 'reply', session: { state: 'needs_clarification', revision: 2 } })
    expect(types.assistant_message).toContain('Which one do you want?')
    expect(types.suggested_replies.map((r) => r.label)).toEqual(['Express', 'All-stop', 'Not sure'])
    expect(types.sources[0]).toMatchObject({ document_id: 'doc-arex-train-types', title: 'AREX train types (demo doc)' })

    const express = await say('Express')
    expect(express).toMatchObject({
      status: 'destination_set',
      destination: { poi_id: 'expressDesk' },
      tip: 'You can pay by card or cash at the counter.',
      next_action: 'locate',
      slots: { train_type: 'express', has_transit_card: 'unknown' },
      session: { state: 'needs_location' },
    })

    api.setPhotoScenario('arexSign')
    const located = await api.postLocalization(id, { image: photo(), map_version: MOCK_MAP_VERSION })
    expect(located.status).toBe('needs_confirmation')
    expect(located.candidates.map((c) => c.node_id)).toEqual(['l4gate', 'l1gate'])
    expect(located.candidates[0].evidence[0]).toBe('“공항철도 Airport Railroad” transfer arrow')

    const confirmed = await api.confirmLocation(id, {
      expected_revision: located.session.revision,
      method: 'photo_candidate',
      localization_id: located.localization_id,
      selected_node_id: 'l4gate',
    })
    expect(confirmed.session.state).toBe('ready_to_navigate')

    const route = await api.createRoute(id, {
      expected_revision: confirmed.session.revision,
      destination_poi_id: 'expressDesk',
      map_version: MOCK_MAP_VERSION,
      start: { type: 'confirmed_node' },
      reroute: false,
    })
    expect(route.path_node_ids).toEqual(['l4gate', 'concourse', 'expressDesk'])
    expect(route.steps.map((s) => [s.kind, s.pano_id])).toEqual([
      ['escalator_down', 'pano-l4gate'],
      ['walk', 'pano-concourse'],
    ])

    const event = (type: 'navigation_started' | 'arrived', event_id: string) =>
      api.postNavigationEvents(id, { route_id: route.route_id, events: [{ event_id, type, client_timestamp: new Date().toISOString(), context: {} }] })
    expect((await event('navigation_started', 'e1')).session.state).toBe('navigating')
    expect((await event('arrived', 'e2')).session.state).toBe('arrived')
    expect((await api.getNavigationState(id)).confirmed_node_id).toBe('expressDesk')

    // 도착한 표 사는 곳이 현재 위치라서 사진 없이 바로 출발할 수 있다
    const platform = await say('Go to the platform')
    expect(platform).toMatchObject({ destination: { poi_id: 'expressPlatform' }, next_action: 'navigate', session: { state: 'ready_to_navigate' } })
    expect(platform.session.revision).toBe(await revision())
  })

  it('라벨만으로는 분류되지 않는 칩도 마지막 답의 칩이면 그 intent로 처리한다', async () => {
    const { say } = await start('ko')
    await say('인천공항')
    const askCard = await say('일반열차')
    expect(askCard.suggested_replies.map((r) => r.label)).toContain('없어요')

    const noCard = await say('없어요')
    expect(noCard).toMatchObject({ destination: { poi_id: 'machines' }, slots: { train_type: 'allstop', has_transit_card: 'no' } })
    expect(noCard.tip).toContain('1회용 교통카드')
  })

  it('목적지 목록에서 고른 곳(selected_poi_id)은 그 목적지와 열차 종류를 정한다', async () => {
    const { api, id } = await start()
    const picked = await api.sendMessage(id, { message: 'All-stop ticket machines', selected_poi_id: 'machines' })
    expect(picked).toMatchObject({ destination: { poi_id: 'machines' }, slots: { train_type: 'allstop' } })
  })

  it('사진 결과 스위치가 흐린 사진이면 no_match와 재촬영 안내를 주고, 위치 확인 중이 아니면 사진을 받지 않는다', async () => {
    const { api, id, say, photo } = await start()
    await expect(api.postLocalization(id, { image: photo(), map_version: MOCK_MAP_VERSION })).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' })

    await say('Express')
    api.setPhotoScenario('blurry')
    const noMatch = await api.postLocalization(id, { image: photo(), map_version: MOCK_MAP_VERSION })
    expect(noMatch).toMatchObject({ status: 'no_match', candidates: [], next_action: 'recapture', session: { state: 'needs_location' } })
    expect(noMatch.retake_hint).toBeTruthy()
  })

  it('revision이 다르면 409 REVISION_CONFLICT, 사진 후보에 없는 위치는 422, 위치 없이 경로는 409', async () => {
    const { api, id, say, revision, photo } = await start()
    await say('Express')
    await expect(api.confirmLocation(id, { expected_revision: 1, method: 'manual', selected_node_id: 'ktxHall' })).rejects.toMatchObject({
      status: 409,
      code: 'REVISION_CONFLICT',
      retryable: true,
      details: { revision: await revision() },
    })
    await expect(
      api.createRoute(id, { expected_revision: await revision(), destination_poi_id: 'expressDesk', map_version: MOCK_MAP_VERSION, start: { type: 'confirmed_node' }, reroute: false }),
    ).rejects.toMatchObject({ code: 'LOCATION_NOT_CONFIRMED' })

    api.setPhotoScenario('ktxSign')
    const located = await api.postLocalization(id, { image: photo(), map_version: MOCK_MAP_VERSION })
    const wrong = api.confirmLocation(id, { expected_revision: located.session.revision, method: 'photo_candidate', localization_id: located.localization_id, selected_node_id: 'l4gate' })
    await expect(wrong).rejects.toMatchObject({ status: 422, code: 'INVALID_INPUT' })
  })

  it('길을 잃었다고 하면 확정 위치를 지우고 위치를 다시 찾게 한다', async () => {
    const { api, id, say, revision } = await start()
    await say('Express')
    await api.confirmLocation(id, { expected_revision: await revision(), method: 'manual', selected_node_id: 'ktxHall' })
    const lost = await say('I think I’m lost')
    expect(lost).toMatchObject({ status: 'relocalize', next_action: 'locate', session: { state: 'needs_location' } })
    expect((await api.getNavigationState(id)).confirmed_node_id).toBeNull()
  })

  it('언어를 바꾸면 그다음 답부터 그 언어로 답한다', async () => {
    const { api, id, say, revision } = await start()
    const patched = await api.patchSession(id, { expected_revision: await revision(), language: 'ko' })
    expect(patched).toMatchObject({ language: 'ko', session: { revision: 2 } })
    expect((await say('How do I pay?')).assistant_message).toBe('열차에 따라 달라요.')
  })

  it('경로 화면 모델로 그리면 기존 mock 경로와 같은 이름·예시 사진·화살표가 나온다', async () => {
    const { api, id, say, revision } = await start()
    await say('Express')
    await api.confirmLocation(id, { expected_revision: await revision(), method: 'manual', selected_node_id: 'l4gate' })
    const route = await api.createRoute(id, {
      expected_revision: await revision(),
      destination_poi_id: 'expressDesk',
      map_version: MOCK_MAP_VERSION,
      start: { type: 'confirmed_node' },
      reroute: false,
    })
    // store처럼 지도 그래프를 같이 넘겨야 화살표 폴백(사진 북쪽 + 통로 방향)을 계산한다
    const graph = await api.getMapGraph(MOCK_MAP_ID)
    const guide = serverGuide(toActiveRoute(route, graph), graph)

    expect(guide.destination).toEqual({ nodeId: 'expressDesk', floor: 'B2', name: NODES.expressDesk.name })
    expect(guide.legs[0].pano).toEqual({ src: PANOS.l4gate!.src, example: UI.svExample })
    // 사진의 북쪽 + 통로 방향. 4호선 사진(northYaw -80) + 북쪽(0), 대합실 사진(162) + 직통 표 방향(90)
    expect(guide.legs.map((l) => l.yawDeg)).toEqual([-80, -108])
  })

  it('지도와 목적지는 data.ts의 데모 데이터를 서버 모양으로 돌려준다', async () => {
    const { api } = await start()
    const graph = await api.getMapGraph(MOCK_MAP_ID)
    expect(graph.edges.find((e) => e.from === 'ktxHall')).toMatchObject({ to: 'concourse', type: 'escalator', distance_m: 120 })
    expect(graph.panoramas.every((p) => p.is_example)).toBe(true)
    const pois = await api.searchPois(MOCK_MAP_ID)
    expect(pois.pois.filter((p) => p.category === 'tickets').map((p) => p.poi_id)).toEqual(['expressDesk', 'machines'])
    await expect(api.getMapGraph('busan')).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
  })
})
