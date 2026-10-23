/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: MSW 가짜 백엔드로 사진 위치 인식·확정 흐름(후보, 503 직접 선택, 재촬영, 409 재동기화, 같은 키 재시도)을 검증한다
 */
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../../api/client'
import type { FetchLike } from '../../api/client'
import { losingFirstResponse } from '../../api/fakeFetch'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { ConfirmationOut, LocalizationOut, NavigationStateOut } from '../../api'
import { recoveryFor } from '../recovery/recovery'
import type { FailHandlers } from '../recovery/context'
import { GRAPH, MAP_ID, MAP_VERSION } from '../../test/fixtures/seoulStation'
import { mockBackend } from '../../test/handlers'
import { sendConfirmation, sendPhoto } from './flow'
import type { LocationHooks } from './flow'
import type { LocateResult } from './locate'
import { toManualNodes } from './manualNodes'

const BASE = 'http://api.test/api/v1'
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], { type: 'image/jpeg' })

// 실제 http 어댑터를 MSW에 붙인다. location-confirmations로 나간 요청의 Idempotency-Key를 기록한다
// fetch를 넘기면 MSW로 보내기 전에 그 함수를 거친다
async function start({
  destination = true,
  timeoutMs,
  fetch: next = (url, init) => globalThis.fetch(url, init),
}: { destination?: boolean; timeoutMs?: number; fetch?: FetchLike } = {}) {
  const confirmKeys: string[] = []
  const client = createApiClient({
    baseUrl: BASE,
    storage: null,
    timeoutMs,
    fetch: (url, init) => {
      if (url.endsWith('/location-confirmations')) confirmKeys.push(new Headers(init.headers).get('Idempotency-Key') ?? '')
      return next(url, init)
    },
  })
  const api = createHttpAdapter(client)
  const created = await api.createSession({ language: 'en', map_id: MAP_ID, client: { platform: 'web', app_version: 'test', ar_capable: false } })
  const sessionId = created.session_id
  let revision = created.session.revision
  // 목적지가 정해지고 위치가 없으면 서버가 needs_location이 된다 (backend/app/domain/session_state.py)
  if (destination) revision = (await api.sendMessage(sessionId, { message: 'Express' })).session.revision
  return { api, sessionId, revision, confirmKeys, req: { sessionId, mapVersion: MAP_VERSION } }
}

// store 대신 콜백 결과를 모아 둔다. fail은 오류 알림 시트가 받는 것과 같은 (error, handlers)를 기록한다
function hooks<T>() {
  const results: T[] = []
  const resyncs: NavigationStateOut[] = []
  const invalid: unknown[] = []
  const failures: { error: unknown; handlers: FailHandlers }[] = []
  let settled: () => void = () => {}
  const next = () => new Promise<void>((resolve) => (settled = resolve))
  const h: LocationHooks<T> = {
    fail: vi.fn((error: unknown, handlers: FailHandlers = {}) => {
      failures.push({ error, handlers })
      settled()
    }),
    onSuccess: (out) => {
      results.push(out)
      settled()
    },
    onInvalidState: (state, error) => {
      resyncs.push(state)
      invalid.push(error)
      settled()
    },
    onRetry: vi.fn(),
    manual: vi.fn(),
  }
  return { h, results, resyncs, invalid, failures, next }
}

describe('사진 → 후보 → 확정', () => {
  it('후보를 받아도 위치는 확정되지 않고, 사용자가 고른 후보로 확정하면 서버에 그 노드가 남는다', async () => {
    const { api, sessionId, req } = await start()
    const photo = hooks<LocateResult>()
    await sendPhoto({ api, req, image: JPEG, hooks: photo.h })

    const result = photo.results[0]
    if (result.kind !== 'candidates') throw new Error(`후보가 와야 한다: ${result.kind}`)
    expect(result.candidates.map((c) => c.node_id)).toEqual(['line4-gates', 'line1-gates'])
    expect(result.candidates[0].evidence.length).toBeGreaterThan(0)
    expect(mockBackend.session(sessionId)).toMatchObject({ state: 'needs_confirmation', confirmedNodeId: null })

    // 상위 후보가 아닌 두 번째 후보를 골라도 그대로 확정된다
    const confirm = hooks<ConfirmationOut>()
    await sendConfirmation({
      api,
      sessionId,
      choice: { method: 'photo_candidate', localizationId: result.localizationId, candidate: result.candidates[1] },
      revision: result.session.revision,
      hooks: confirm.h,
    })

    expect(confirm.failures).toHaveLength(0)
    expect(confirm.results[0].location.node_id).toBe('line1-gates')
    expect(confirm.results[0].session).toEqual({ state: 'ready_to_navigate', revision: mockBackend.session(sessionId)!.revision })
    expect(mockBackend.session(sessionId)).toMatchObject({ state: 'ready_to_navigate', confirmedNodeId: 'line1-gates' })
  })
})

describe('사진 인식 503 → 직접 선택 → 확정', () => {
  it('503이면 오류 알림 없이 manual 결과를 받고, 서버 세션은 그대로다', async () => {
    const { api, sessionId, revision, req } = await start()
    mockBackend.setVision('unavailable')
    const photo = hooks<LocateResult>()
    await sendPhoto({ api, req, image: JPEG, hooks: photo.h })

    expect(photo.results).toEqual([{ kind: 'manual', reason: 'ai_unavailable' }])
    expect(photo.failures).toHaveLength(0)
    expect(mockBackend.session(sessionId)).toMatchObject({ state: 'needs_location', revision })
  })

  it('지도 그래프 목록에서 고른 노드로 manual 확정하면 서버에 그 노드가 남는다', async () => {
    const { api, sessionId, revision } = await start()
    const place = toManualNodes(GRAPH).find((n) => n.id === 'ktx-hall')!
    const confirm = hooks<ConfirmationOut>()
    await sendConfirmation({ api, sessionId, choice: { method: 'manual', nodeId: place.id }, revision, hooks: confirm.h })

    expect(confirm.results[0].location).toMatchObject({ node_id: 'ktx-hall', floor_id: '2F', method: 'manual' })
    expect(mockBackend.session(sessionId)).toMatchObject({ state: 'ready_to_navigate', confirmedNodeId: 'ktx-hall' })
  })
})

describe('후보 없음 → 재촬영', () => {
  it('흐린 사진은 서버의 재촬영 안내를 받고, 다시 찍으면 후보가 온다', async () => {
    const { api, sessionId, req } = await start()
    mockBackend.setVision({ image_quality: 'blurry', texts: [] })
    const blurry = hooks<LocateResult>()
    await sendPhoto({ api, req, image: JPEG, hooks: blurry.h })

    expect(blurry.results[0]).toMatchObject({ kind: 'no_match', retakeHint: 'The photo is blurry. Hold still and try again.' })
    expect(mockBackend.session(sessionId)).toMatchObject({ state: 'needs_location', confirmedNodeId: null })

    mockBackend.setVision({ image_quality: 'usable', texts: ['KTX', '맞이방', 'KTX hall'] })
    const retake = hooks<LocateResult>()
    await sendPhoto({ api, req, image: JPEG, hooks: retake.h })
    expect(retake.results[0].kind).toBe('candidates')
  })
})

describe('오류 복구', () => {
  it('409 REVISION_CONFLICT면 navigation-state로 맞춘 revision과 새 키로 한 번 더 보내 확정한다', async () => {
    const { api, sessionId, revision, confirmKeys } = await start()
    mockBackend.conflictNext()
    const onResync = vi.fn()
    const confirm = hooks<ConfirmationOut>()
    await sendConfirmation({ api, sessionId, choice: { method: 'manual', nodeId: 'line4-gates' }, revision, onResync, hooks: confirm.h })

    expect(confirm.failures).toHaveLength(0)
    expect(onResync).toHaveBeenCalledTimes(1)
    expect(confirmKeys).toHaveLength(2)
    expect(confirmKeys[0]).not.toBe(confirmKeys[1])
    expect(mockBackend.session(sessionId)).toMatchObject({ state: 'ready_to_navigate', confirmedNodeId: 'line4-gates' })
  })

  it('타임아웃 뒤 다시 시도하면 처음 요청과 같은 Idempotency-Key로 보낸다', async () => {
    const { api, sessionId, revision, confirmKeys } = await start({ timeoutMs: 50 })
    mockBackend.hang('confirmations')
    const confirm = hooks<ConfirmationOut>()
    await sendConfirmation({ api, sessionId, choice: { method: 'manual', nodeId: 'ktx-hall' }, revision, hooks: confirm.h })

    expect(confirm.failures[0].error).toMatchObject({ code: 'TIMEOUT' })
    const done = confirm.next()
    confirm.failures[0].handlers.retry!()
    await done

    expect(confirm.h.onRetry).toHaveBeenCalledTimes(1)
    expect(confirmKeys).toHaveLength(2)
    expect(confirmKeys[1]).toBe(confirmKeys[0])
    expect(mockBackend.session(sessionId)).toMatchObject({ confirmedNodeId: 'ktx-hall' })
  })

  it('서버가 처리한 사진 요청의 응답을 못 받아도, 다시 시도는 같은 바이트로 가서 저장된 200을 그대로 받는다', async () => {
    const lose = losingFirstResponse('/localizations')
    const { api, sessionId, req } = await start({ timeoutMs: 200, fetch: lose.fetch })
    const photo = hooks<LocateResult>()
    await sendPhoto({ api, req, image: JPEG, hooks: photo.h })

    // 서버는 처리를 끝냈고 응답만 사라졌다
    expect(photo.failures[0].error).toMatchObject({ code: 'TIMEOUT' })
    const processed = mockBackend.session(sessionId)!
    expect(processed.state).toBe('needs_confirmation')
    const revisionAfterFirst = processed.revision

    const done = photo.next()
    photo.failures[0].handlers.retry!()
    await done

    // 같은 키, 같은 Content-Type, 같은 본문 바이트라서 서버가 422 대신 저장된 응답을 돌려준다
    expect(lose.sent).toHaveLength(2)
    expect(lose.sent[1].idempotencyKey).toBe(lose.sent[0].idempotencyKey)
    expect(lose.sent[1].contentType).toBe(lose.sent[0].contentType)
    expect(lose.sent[1].bytes).toEqual(lose.sent[0].bytes)
    expect(photo.failures).toHaveLength(1)
    const result = photo.results[0]
    if (result?.kind !== 'candidates') throw new Error(`저장된 후보 응답이 와야 한다: ${result?.kind}`)
    expect(result.localizationId).toBe((lose.lost[0] as LocalizationOut).localization_id)
    // 두 번 처리되지 않았다
    expect(mockBackend.session(sessionId)!.revision).toBe(revisionAfterFirst)
  })

  it('목적지 전(idle)이라 사진 요청이 409 INVALID_STATE면 다시 보내지 않고 서버 상태를 다시 읽는다', async () => {
    const { api, req } = await start({ destination: false })
    const photo = hooks<LocateResult>()
    await sendPhoto({ api, req, image: JPEG, hooks: photo.h })
    await vi.waitFor(() => expect(photo.resyncs).toHaveLength(1))

    expect(photo.failures).toHaveLength(0)
    expect(photo.resyncs[0]).toMatchObject({ session: { state: 'idle' }, next_action: 'reply' })
    expect(photo.invalid[0]).toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })

  it('사진 결과가 만료(410)되면 오류 복구로 넘기고, 복구 규칙은 다시 찍기(relocate)를 준다', async () => {
    const { api, sessionId, req } = await start()
    const photo = hooks<LocateResult>()
    await sendPhoto({ api, req, image: JPEG, hooks: photo.h })
    const result = photo.results[0]
    if (result.kind !== 'candidates') throw new Error('후보가 와야 한다')

    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 301_000)
    const confirm = hooks<ConfirmationOut>()
    await sendConfirmation({
      api,
      sessionId,
      choice: { method: 'photo_candidate', localizationId: result.localizationId, candidate: result.candidates[0] },
      revision: result.session.revision,
      hooks: confirm.h,
    })
    clock.mockRestore()

    expect(confirm.failures[0].error).toMatchObject({ code: 'LOCALIZATION_EXPIRED', status: 410 })
    expect(recoveryFor(confirm.failures[0].error, { retry: true, manual: true })).toEqual({ type: 'relocate', reason: 'localization_expired' })
    expect(mockBackend.session(sessionId)).toMatchObject({ confirmedNodeId: null })
  })
})
