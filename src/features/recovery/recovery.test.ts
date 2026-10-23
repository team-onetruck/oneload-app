/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 오류 시나리오(타임아웃, 네트워크 끊김 등)마다 알맞은 탈출구가 나오는지 가짜 fetch로 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from '../../api/client'
import { ApiError } from '../../api/errors'
import type { ApiErrorCode, ServerErrorCode } from '../../api/errors'
import { errorResponse, fakeFetch } from '../../api/fakeFetch'
import type { FakeReply } from '../../api/fakeFetch'
import { isClientBug, recoveryFor } from './recovery'
import type { AvailableActions } from './recovery'

const ALL = { retry: true, manual: true }
// 위치 단계가 아닌 곳 (목록에서 고를 것이 없음)
const NO_MANUAL = { retry: true, manual: false }

// 메시지 하나를 보내고 난 오류와 보낸 요청 기록을 돌려준다.
async function failed(reply: FakeReply) {
  const server = fakeFetch([reply])
  const client = createApiClient({ fetch: server.fetch, storage: null, timeoutMs: 5 })
  client.setSession({ sessionId: 'ses_1', token: 'tok_1' })
  const error = await client.request('/sessions/ses_1/messages', { method: 'POST', json: { message: '돈은 어떻게 내요?' } }).then(
    () => {
      throw new Error('실패해야 하는 요청이 성공했다')
    },
    (e: unknown) => e,
  )
  return { error, calls: server.calls }
}

describe('recoveryFor: 세션 종료', () => {
  it('401 SESSION_EXPIRED면 만료 문구로 세션 종료를 알리고 새 세션을 만들지 않는다', async () => {
    const { error, calls } = await failed(errorResponse(401, 'SESSION_EXPIRED'))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'sessionEnded', cause: 'expired' })
    // POST /sessions 같은 다른 요청을 저절로 보내지 않는다.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /sessions/ses_1/messages'])
  })

  it('401 SESSION_UNAUTHORIZED면 만료가 아닌 중립 문구로 세션 종료를 알린다', async () => {
    const { error } = await failed(errorResponse(401, 'SESSION_UNAUTHORIZED'))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'sessionEnded', cause: 'unauthorized' })
    expect(isClientBug(error)).toBe(false)
  })

  it('403 SESSION_FORBIDDEN이면 세션 종료로 알리고 클라이언트 버그로 기록 대상이 된다', async () => {
    const { error } = await failed(errorResponse(403, 'SESSION_FORBIDDEN'))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'sessionEnded', cause: 'forbidden' })
    expect(isClientBug(error)).toBe(true)
  })

  it('지도 버전을 갱신해도 409 MAP_VERSION_MISMATCH면 지도가 바뀐 것으로 보고 세션을 끝낸다', async () => {
    const { error } = await failed(errorResponse(409, 'MAP_VERSION_MISMATCH', { required_map_version: 'v2' }))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'sessionEnded', cause: 'map_changed' })
  })
})

describe('recoveryFor: 409 상태 충돌', () => {
  it('REVISION_CONFLICT가 자동 재시도 뒤에도 남으면 다시 시도와 처음으로를 준다', async () => {
    const { error } = await failed(errorResponse(409, 'REVISION_CONFLICT', { revision: 6 }))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'notice', reason: 'conflict', actions: ['retry', 'home'] })
  })

  it('INVALID_STATE는 재시도하지 않고 navigation-state로 다시 맞추게 하며 처음으로를 남긴다', async () => {
    const { error } = await failed(errorResponse(409, 'INVALID_STATE', { state: 'navigating' }))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'resync', actions: ['home'] })
  })

  it('LOCATION_NOT_CONFIRMED면 위치 확인 화면으로 보낸다', async () => {
    const { error } = await failed(errorResponse(409, 'LOCATION_NOT_CONFIRMED'))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'relocate', reason: 'location_not_confirmed' })
  })
})

describe('recoveryFor: 세션은 유지하는 오류', () => {
  it('410 LOCALIZATION_EXPIRED는 세션 만료가 아니라 재촬영 안내다', async () => {
    const { error } = await failed(errorResponse(410, 'LOCALIZATION_EXPIRED'))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'relocate', reason: 'localization_expired' })
  })

  it('503 AI_SERVICE_UNAVAILABLE이면 직접 선택을 먼저, 다시 시도를 함께 준다', async () => {
    const { error } = await failed(errorResponse(503, 'AI_SERVICE_UNAVAILABLE'))
    expect(error).toMatchObject({ retryable: true })
    expect(recoveryFor(error, ALL)).toEqual({ type: 'notice', reason: 'ai_unavailable', actions: ['manual', 'retry'] })
  })

  it('위치 단계의 타임아웃은 다시 시도와 직접 선택을 준다', async () => {
    const { error } = await failed('timeout')
    expect(error).toMatchObject({ code: 'TIMEOUT', retryable: true })
    expect(recoveryFor(error, ALL)).toEqual({ type: 'notice', reason: 'timeout', actions: ['retry', 'manual'] })
  })

  it('위치 단계가 아닌 곳의 타임아웃은 다시 시도와 처음으로를 준다', async () => {
    const { error } = await failed('timeout')
    expect(recoveryFor(error, NO_MANUAL)).toEqual({ type: 'notice', reason: 'timeout', actions: ['retry', 'home'] })
  })

  it('네트워크가 끊기면 타임아웃과 같은 탈출구를 준다', async () => {
    const { error } = await failed('network')
    expect(error).toMatchObject({ code: 'NETWORK', retryable: true })
    expect(recoveryFor(error, ALL)).toEqual({ type: 'notice', reason: 'network', actions: ['retry', 'manual'] })
    expect(recoveryFor(error, NO_MANUAL)).toEqual({ type: 'notice', reason: 'network', actions: ['retry', 'home'] })
  })

  it('400 BAD_REQUEST는 일반 오류와 다시 시도를 주고 클라이언트 버그로 기록 대상이 된다', async () => {
    const { error } = await failed(errorResponse(400, 'BAD_REQUEST'))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'notice', reason: 'failed', actions: ['retry'] })
    expect(isClientBug(error)).toBe(true)
  })

  it('공통 형식이 아닌 500은 일반 오류와 다시 시도, 처음으로를 준다', async () => {
    const { error } = await failed(new Response('Internal Server Error', { status: 500 }))
    expect(error).toMatchObject({ status: 500, code: 'UNEXPECTED_RESPONSE' })
    expect(recoveryFor(error, ALL)).toEqual({ type: 'notice', reason: 'failed', actions: ['retry', 'home'] })
  })

  it('표에 없는 retryable: false 오류는 다시 시도 없이 직접 선택과 처음으로를 준다', async () => {
    const { error } = await failed(errorResponse(422, 'ROUTE_NOT_FOUND'))
    expect(recoveryFor(error, ALL)).toEqual({ type: 'notice', reason: 'failed', actions: ['manual', 'home'] })
  })

  it('ApiError가 아닌 예외도 처음으로는 준다', () => {
    expect(recoveryFor(new Error('예상하지 못한 오류'), NO_MANUAL)).toEqual({ type: 'notice', reason: 'failed', actions: ['home'] })
  })
})

// backend/app/errors.py ErrorCode 전체와 클라이언트 코드
const SERVER_CODES: ServerErrorCode[] = [
  'BAD_REQUEST', 'INVALID_INPUT', 'IDEMPOTENCY_KEY_REUSED', 'SESSION_UNAUTHORIZED', 'SESSION_EXPIRED',
  'SESSION_FORBIDDEN', 'NOT_FOUND', 'MAP_NOT_FOUND', 'POI_NOT_FOUND', 'LOCALIZATION_NOT_FOUND', 'ROUTE_NOT_FOUND',
  'LOCALIZATION_EXPIRED', 'MAP_VERSION_MISMATCH', 'REVISION_CONFLICT', 'INVALID_STATE', 'LOCATION_NOT_CONFIRMED',
  'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE', 'AI_SERVICE_UNAVAILABLE', 'INTERNAL',
]
const ALL_CODES: ApiErrorCode[] = [...SERVER_CODES, 'NETWORK', 'TIMEOUT', 'UNEXPECTED_RESPONSE']
const AVAILABILITY: AvailableActions[] = [
  { retry: true, manual: true },
  { retry: true, manual: false },
  { retry: false, manual: true },
  { retry: false, manual: false },
]

describe('recoveryFor: 모든 오류에 탈출구 (제품 원칙 4)', () => {
  for (const code of ALL_CODES)
    for (const available of AVAILABILITY)
      it(`${code} · 재시도 ${available.retry ? '있음' : '없음'} · 직접 선택 ${available.manual ? '있음' : '없음'}`, () => {
        const retryable = code === 'REVISION_CONFLICT' || code === 'AI_SERVICE_UNAVAILABLE' || code === 'NETWORK' || code === 'TIMEOUT'
        const recovery = recoveryFor(new ApiError(0, code, code, null, { retryable }), available)
        // 세션 종료는 '다시 시작', 위치 확인 이동은 그 화면의 다시 찍기·목록에서 고르기가 탈출구다.
        if (recovery.type === 'sessionEnded' || recovery.type === 'relocate') return
        expect(recovery.actions.length).toBeGreaterThan(0)
        // 오류가 난 곳이 줄 수 없는 버튼은 내놓지 않는다.
        if (!available.retry) expect(recovery.actions).not.toContain('retry')
        if (!available.manual) expect(recovery.actions).not.toContain('manual')
      })
})
