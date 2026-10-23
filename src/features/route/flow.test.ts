/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: MSW 가짜 백엔드로 경로 요청(확정 → createRoute → 단계 모델, 409, 오류)과 길안내 이벤트 전달(도착, 같은 키 재전송, 422 조건, 재탐색)을 검증한다
 */
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../../api/client'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { NavigationStateOut, RouteOut } from '../../api'
import { GRAPH, MAP_ID, MAP_VERSION } from '../../test/fixtures/seoulStation'
import { mockBackend } from '../../test/handlers'
import { server } from '../../test/server'
import type { FailHandlers } from '../recovery/context'
import { recoveryFor } from '../recovery/recovery'
import { createNavigationEvent } from './events'
import { deliverEvents, sendRoute } from './flow'
import type { RouteHooks } from './flow'
import { planReroute } from './request'
import { arrowYawDeg, toSteps } from './toSteps'

const BASE = 'http://api.test/api/v1'
const EXPRESS_TICKETS = 'poi-express-tickets'

// 실제 http 어댑터를 MSW에 붙이고, 경로·이벤트 요청의 Idempotency-Key를 기록한다. 목적지는 /messages로 정한다
async function start({ timeoutMs }: { timeoutMs?: number } = {}) {
  const keys = { routes: [] as string[], events: [] as string[] }
  const client = createApiClient({
    baseUrl: BASE,
    storage: null,
    timeoutMs,
    fetch: (url, init) => {
      const key = new Headers(init.headers).get('Idempotency-Key') ?? ''
      if (url.endsWith('/routes')) keys.routes.push(key)
      if (url.endsWith('/navigation-events')) keys.events.push(key)
      return globalThis.fetch(url, init)
    },
  })
  const api = createHttpAdapter(client)
  const created = await api.createSession({ language: 'en', map_id: MAP_ID, client: { platform: 'web', app_version: 'test', ar_capable: false } })
  const sessionId = created.session_id
  await api.sendMessage(sessionId, { message: 'Express' })
  // 사용자가 목록에서 고른 것처럼 manual로 확정한다
  const confirmAt = async (nodeId: string) => {
    const state = await api.getNavigationState(sessionId)
    return api.confirmLocation(sessionId, { expected_revision: state.session.revision, method: 'manual', selected_node_id: nodeId })
  }
  const revision = async () => (await api.getNavigationState(sessionId)).session.revision
  return { api, sessionId, keys, confirmAt, revision }
}

// store 대신 콜백 결과를 모아 둔다
function hooks() {
  const results: RouteOut[] = []
  const invalid: NavigationStateOut[] = []
  const failures: { error: unknown; handlers: FailHandlers }[] = []
  let settled: () => void = () => {}
  const next = () => new Promise<void>((resolve) => (settled = resolve))
  const h: RouteHooks = {
    fail: vi.fn((error: unknown, handlers: FailHandlers = {}) => {
      failures.push({ error, handlers })
      settled()
    }),
    onSuccess: (out) => {
      results.push(out)
      settled()
    },
    onInvalidState: (state) => {
      invalid.push(state)
      settled()
    },
    onRetry: vi.fn(),
  }
  return { h, results, invalid, failures, next }
}

const input = (revision: number) => ({ revision, destinationPoiId: EXPRESS_TICKETS, mapVersion: MAP_VERSION })

describe('sendRoute', () => {
  it('확정한 위치에서 경로를 받고, 서버 steps를 문구·사진·화살표 그대로 단계 모델로 바꾼다', async () => {
    const { api, sessionId, keys, confirmAt } = await start()
    const confirmed = await confirmAt('line4-gates')
    const r = hooks()
    await sendRoute({ api, sessionId, input: input(confirmed.session.revision), reroute: false, hooks: r.h })

    const out = r.results[0]
    expect(out.path_node_ids).toEqual(['line4-gates', 'arex-concourse', 'express-tickets'])
    expect(out.session.state).toBe('ready_to_navigate')
    const steps = toSteps(out, GRAPH)
    expect(steps.map((s) => s.instruction.ko)).toEqual(out.steps.map((s) => s.instruction_ko))
    expect(steps[0]).toMatchObject({ panoId: 'pano-line4-gates', floorChange: true })
    expect(arrowYawDeg(steps[0])).toBe(-80)
    expect(keys.routes).toHaveLength(1)
  })

  it('409 REVISION_CONFLICT면 navigation-state로 다시 맞춰 한 번만 다시 보내고, 재시도는 새 키를 쓴다', async () => {
    const { api, sessionId, keys, confirmAt } = await start()
    const confirmed = await confirmAt('line4-gates')
    mockBackend.conflictNext(1)
    const onResync = vi.fn()
    const r = hooks()
    await sendRoute({ api, sessionId, input: input(confirmed.session.revision), reroute: false, onResync, hooks: r.h })

    expect(r.results).toHaveLength(1)
    expect(onResync).toHaveBeenCalledTimes(1)
    expect(keys.routes).toHaveLength(2)
    expect(keys.routes[0]).not.toBe(keys.routes[1])
  })

  it('위치를 확정하기 전이면 LOCATION_NOT_CONFIRMED를 fail로 넘겨 위치 확인 화면으로 보낸다', async () => {
    const { api, sessionId, revision } = await start()
    const r = hooks()
    await sendRoute({ api, sessionId, input: input(await revision()), reroute: false, hooks: r.h })

    const { error, handlers } = r.failures[0]
    expect(error).toMatchObject({ code: 'LOCATION_NOT_CONFIRMED' })
    expect(recoveryFor(error, { retry: Boolean(handlers.retry), manual: false })).toEqual({ type: 'relocate', reason: 'location_not_confirmed' })
  })

  it('등록된 경로가 없으면 ROUTE_NOT_FOUND를 그대로 넘기고 경로를 지어내지 않는다', async () => {
    const { api, sessionId, confirmAt } = await start()
    const confirmed = await confirmAt('express-platform')
    const r = hooks()
    await sendRoute({ api, sessionId, input: input(confirmed.session.revision), reroute: false, hooks: r.h })

    expect(r.results).toEqual([])
    expect(r.failures[0].error).toMatchObject({ code: 'ROUTE_NOT_FOUND' })
  })

  it('409 INVALID_STATE면 다시 보내지 않고 navigation-state를 읽어 넘긴다', async () => {
    const { api, sessionId, keys, confirmAt } = await start()
    const confirmed = await confirmAt('line4-gates')
    server.use(
      http.post(
        '*/api/v1/sessions/:sessionId/routes',
        () =>
          HttpResponse.json(
            { error: { code: 'INVALID_STATE', message: 'Not allowed.', retryable: false, details: { state: 'arrived' } }, request_id: 'req_1' },
            { status: 409 },
          ),
        { once: true },
      ),
    )
    const r = hooks()
    // 재동기화는 fail 안에서 따로 진행되므로 콜백이 올 때까지 기다린다
    const resynced = r.next()
    await sendRoute({ api, sessionId, input: input(confirmed.session.revision), reroute: false, hooks: r.h })
    await resynced

    expect(r.invalid).toHaveLength(1)
    expect(r.failures).toEqual([])
    expect(keys.routes).toHaveLength(1)
  })
})

// 경로를 만들어 둔 세션. 이벤트 테스트가 함께 쓴다
async function routed(options: { timeoutMs?: number } = {}) {
  const s = await start(options)
  const confirmed = await s.confirmAt('line4-gates')
  const r = hooks()
  await sendRoute({ api: s.api, sessionId: s.sessionId, input: input(confirmed.session.revision), reroute: false, hooks: r.h })
  return { ...s, route: r.results[0] }
}

describe('deliverEvents', () => {
  it('시작 뒤 도착을 보내면 서버가 arrived가 되고 활성 경로를 비운다', async () => {
    const { api, sessionId, route } = await routed()
    const started = await deliverEvents({ api, sessionId, routeId: route.route_id, pending: [createNavigationEvent('navigation_started')] })
    expect(started).toMatchObject({ kind: 'sent', session: { state: 'navigating' }, pending: [] })

    const arrived = await deliverEvents({ api, sessionId, routeId: route.route_id, pending: [createNavigationEvent('arrived')] })
    expect(arrived).toMatchObject({ kind: 'sent', session: { state: 'arrived' } })
    expect(mockBackend.session(sessionId)).toMatchObject({ state: 'arrived', activeRouteId: null, confirmedNodeId: 'express-tickets' })
  })

  it('응답이 없으면 처음 요청과 같은 Idempotency-Key로 한 번만 조용히 다시 보낸다', async () => {
    const { api, sessionId, route, keys } = await routed({ timeoutMs: 50 })
    mockBackend.hang('navigationEvents', 1)
    const outcome = await deliverEvents({ api, sessionId, routeId: route.route_id, pending: [createNavigationEvent('navigation_started')] })

    expect(outcome).toMatchObject({ kind: 'sent', session: { state: 'navigating' } })
    expect(keys.events).toHaveLength(2)
    expect(keys.events[1]).toBe(keys.events[0])
  })

  it('두 번 다 응답이 없으면 더 보내지 않고 대기열을 그대로 돌려준다', async () => {
    const { api, sessionId, route, keys } = await routed({ timeoutMs: 50 })
    mockBackend.hang('navigationEvents', 2)
    const pending = [createNavigationEvent('navigation_started')]
    const outcome = await deliverEvents({ api, sessionId, routeId: route.route_id, pending })

    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'TIMEOUT' }, pending })
    expect(keys.events).toHaveLength(2)
  })

  it('키를 재사용하지 못한 도착 재전송이 422면 이미 반영된 것으로 보고 navigation-state로 맞춘다', async () => {
    const { api, sessionId, route } = await routed()
    await deliverEvents({ api, sessionId, routeId: route.route_id, pending: [createNavigationEvent('navigation_started')] })
    const arrived = [createNavigationEvent('arrived')]
    await deliverEvents({ api, sessionId, routeId: route.route_id, pending: arrived })

    // 새로고침 뒤 대기열처럼 새 키로 같은 이벤트를 다시 보낸다
    const again = await deliverEvents({ api, sessionId, routeId: route.route_id, pending: arrived })
    expect(again).toMatchObject({ kind: 'closed', state: { session: { state: 'arrived' }, active_route_id: null } })
  })

  it('시작 이벤트만 보낸 422는 반영된 것으로 보지 않고 다시 보내지도 않는다', async () => {
    const { api, sessionId, route, keys } = await routed()
    await deliverEvents({ api, sessionId, routeId: route.route_id, pending: [createNavigationEvent('navigation_started')] })
    await deliverEvents({ api, sessionId, routeId: route.route_id, pending: [createNavigationEvent('arrived')] })
    const before = keys.events.length

    const late = await deliverEvents({ api, sessionId, routeId: route.route_id, pending: [createNavigationEvent('navigation_started')] })
    expect(late).toMatchObject({ kind: 'failed', error: { code: 'INVALID_INPUT' } })
    expect(keys.events.length - before).toBe(1)
  })
})

describe('재탐색', () => {
  it('길을 잃으면 위치부터 다시 확인하고, 다시 확정하면 같은 경로 id로 reroute해 안내를 다시 시작한다', async () => {
    const { api, sessionId, route, confirmAt } = await routed()
    await deliverEvents({ api, sessionId, routeId: route.route_id, pending: [createNavigationEvent('navigation_started')] })
    await api.sendMessage(sessionId, { message: 'I think I’m lost' })

    expect(planReroute(await api.getNavigationState(sessionId), MAP_VERSION)).toEqual({ kind: 'needs_location' })

    await confirmAt('arex-concourse')
    const plan = planReroute(await api.getNavigationState(sessionId), MAP_VERSION)
    if (plan.kind !== 'ready') throw new Error(`재탐색할 수 있어야 한다: ${plan.kind}`)
    const r = hooks()
    await sendRoute({
      api,
      sessionId,
      input: { revision: plan.request.expected_revision, destinationPoiId: plan.request.destination_poi_id, mapVersion: MAP_VERSION },
      reroute: true,
      hooks: r.h,
    })

    const rerouted = r.results[0]
    expect(rerouted).toMatchObject({ route_id: route.route_id, route_revision: 2, start_node_id: 'arex-concourse' })
    expect(rerouted.path_node_ids).toEqual(['arex-concourse', 'express-tickets'])
    const restarted = await deliverEvents({ api, sessionId, routeId: rerouted.route_id, pending: [createNavigationEvent('navigation_started')] })
    expect(restarted).toMatchObject({ kind: 'sent', session: { state: 'navigating' } })
  })
})
