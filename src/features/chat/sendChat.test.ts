/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: MSW 가짜 백엔드로 채팅 흐름(응답 → 말풍선·칩, 타임아웃 → 같은 키로 다시 시도, INVALID_STATE 재동기화)을 검증한다
 */
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../../api/client'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { MessageOut, NavigationStateOut } from '../../api'
import type { FailHandlers } from '../recovery/context'
import { MAP_ID } from '../../test/fixtures/seoulStation'
import { mockBackend } from '../../test/handlers'
import { server } from '../../test/server'
import { messageBody, replyEffects } from './replyEffects'
import { sendChat } from './sendChat'
import type { ChatHooks } from './sendChat'
import type { ErrorView } from './toViewModel'

const BASE = 'http://api.test/api/v1'

// 실제 http 어댑터를 MSW에 붙이고, /messages로 나간 요청의 Idempotency-Key를 기록한다
async function start() {
  const keys: string[] = []
  const client = createApiClient({
    baseUrl: BASE,
    storage: null,
    fetch: (url, init) => {
      if (url.endsWith('/messages')) keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '')
      return globalThis.fetch(url, init)
    },
  })
  const api = createHttpAdapter(client)
  const created = await api.createSession({ language: 'en', map_id: MAP_ID, client: { platform: 'web', app_version: 'test', ar_capable: false } })
  return { api, sessionId: created.session_id, keys }
}

// store 대신 콜백 결과를 모아 둔다. fail은 오류 알림 시트가 받는 것과 같은 (error, handlers)를 기록한다
function hooks() {
  const replies: MessageOut[] = []
  const errors: ErrorView[] = []
  const resyncs: NavigationStateOut[] = []
  const failures: { error: unknown; handlers: FailHandlers }[] = []
  let settled: () => void = () => {}
  const next = () => new Promise<void>((resolve) => (settled = resolve))
  const h: ChatHooks = {
    fail: vi.fn((error: unknown, handlers: FailHandlers = {}) => {
      failures.push({ error, handlers })
      settled()
    }),
    onReply: (res) => {
      replies.push(res)
      settled()
    },
    onError: (view) => errors.push(view),
    onRetry: vi.fn(),
    onResync: (state) => {
      resyncs.push(state)
      settled()
    },
    manual: vi.fn(),
  }
  return { h, replies, errors, resyncs, failures, next }
}

describe('sendChat', () => {
  it('질문을 보내면 응답의 말풍선·칩과 서버 세션을 그대로 받는다', async () => {
    const { api, sessionId } = await start()
    const t = hooks()
    await sendChat({ api, sessionId, body: messageBody('Incheon Airport'), hooks: t.h })

    const effects = replyEffects(t.replies[0])
    expect(effects.view.status).toBe('needs_clarification')
    expect(effects.view.items).toHaveLength(2)
    expect(effects.view.chips.map((c) => c.label)).toEqual(['Express', 'All-stop', 'Not sure'])
    expect(effects.session).toEqual({ state: 'needs_clarification', revision: 2 })
    expect(t.failures).toHaveLength(0)
  })

  it('칩을 누르면 라벨을 보내고, selected_poi_id가 있으면 함께 보내 목적지가 정해진다', async () => {
    const { api, sessionId } = await start()
    const t = hooks()
    await sendChat({ api, sessionId, body: messageBody('Express'), hooks: t.h })
    expect(replyEffects(t.replies[0]).destination).toEqual({ serverPoiId: 'poi-express-tickets', local: 'expressDesk' })

    await sendChat({ api, sessionId, body: messageBody('All-stop train platform', 'poi-allstop-platform'), hooks: t.h })
    const second = replyEffects(t.replies[1])
    expect(second.view.status).toBe('destination_set')
    expect(second.destination).toEqual({ serverPoiId: 'poi-allstop-platform', local: 'allstopPlatform' })
    expect(mockBackend.session(sessionId)?.destinationPoiId).toBe('poi-allstop-platform')
  })

  it('타임아웃이면 오류 알림으로 넘기고, 다시 시도는 처음과 같은 Idempotency-Key로 보내 답을 받는다', async () => {
    const { api, sessionId, keys } = await start()
    mockBackend.hang('messages')
    const t = hooks()
    await sendChat({ api, sessionId, body: messageBody('How do I pay?'), hooks: t.h, timeoutMs: 30 })

    expect(t.errors[0]).toMatchObject({ reason: 'timeout', actions: ['retry', 'pickDest'] })
    const [{ error, handlers }] = t.failures
    expect(error).toMatchObject({ code: 'TIMEOUT' })
    expect(handlers.manual).toBe(t.h.manual)

    const replied = t.next()
    handlers.retry!()
    await replied
    expect(t.h.onRetry).toHaveBeenCalledTimes(1)
    expect(t.replies[0].status).toBe('answered')
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('데모 타임아웃은 첫 요청을 보내지 않고 오류로 처리하며, 다시 시도에서 실제로 보낸다', async () => {
    const { api, sessionId, keys } = await start()
    const t = hooks()
    await sendChat({ api, sessionId, body: messageBody('How do I pay?'), hooks: t.h, simulateTimeout: true })
    expect(keys).toHaveLength(0)
    expect(t.errors[0].reason).toBe('timeout')

    const replied = t.next()
    t.failures[0].handlers.retry!()
    await replied
    expect(keys).toHaveLength(1)
    expect(t.replies[0].status).toBe('answered')
  })

  it('409 INVALID_STATE면 다시 보내지 않고 navigation-state를 다시 읽는다', async () => {
    const { api, sessionId, keys } = await start()
    server.use(
      http.post(`${BASE}/sessions/:sessionId/messages`, () =>
        HttpResponse.json(
          { error: { code: 'INVALID_STATE', message: 'Not allowed while the session is failed.', retryable: false, details: { state: 'failed' } }, request_id: 'req_x' },
          { status: 409 },
        ),
      ),
    )
    const t = hooks()
    const resynced = t.next()
    await sendChat({ api, sessionId, body: messageBody('How do I pay?'), hooks: t.h })
    await resynced

    expect(t.errors[0]).toMatchObject({ reason: 'resync', requestId: 'req_x' })
    expect(t.failures).toHaveLength(0)
    expect(t.resyncs[0].next_action).toBe('reply')
    expect(keys).toHaveLength(1)
  })

  it('토큰이 없으면(401) 오류 알림의 세션 종료 처리로 넘기고 말풍선은 세션 오류로 표시한다', async () => {
    const { api, sessionId } = await start()
    api.clearSession()
    const t = hooks()
    await sendChat({ api, sessionId, body: messageBody('How do I pay?'), hooks: t.h })
    expect(t.errors[0]).toMatchObject({ reason: 'session', actions: ['restart'] })
    expect(t.failures[0].error).toMatchObject({ status: 401, code: 'SESSION_UNAUTHORIZED' })
  })

  it('토큰의 세션과 경로의 세션이 다르면(403) 같은 세션 종료 처리로 넘긴다', async () => {
    const { api } = await start()
    const t = hooks()
    await sendChat({ api, sessionId: 'ses_other', body: messageBody('How do I pay?'), hooks: t.h })
    expect(t.errors[0].reason).toBe('session')
    expect(t.failures[0].error).toMatchObject({ status: 403, code: 'SESSION_FORBIDDEN' })
  })
})
