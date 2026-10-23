/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 오류 시나리오(타임아웃, 네트워크 끊김 등)마다 알맞은 탈출구가 나오는지 가짜 fetch로 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from '../../api/client'
import { errorResponse, fakeFetch } from '../../api/fakeFetch'
import type { FakeReply } from '../../api/fakeFetch'
import { recoveryFor } from './recovery'

const ALL = { retry: true, manual: true }

// 메시지 하나를 보내고 난 오류를 돌려준다.
async function failedSend(reply: FakeReply) {
  const server = fakeFetch([reply])
  const client = createApiClient({ fetch: server.fetch, storage: null, timeoutMs: 5 })
  client.setSession({ sessionId: 'ses_1', token: 'tok_1' })
  return client.request('/sessions/ses_1/messages', { method: 'POST', json: { message: '돈은 어떻게 내요?' } }).then(
    () => {
      throw new Error('실패해야 하는 요청이 성공했다')
    },
    (error: unknown) => error,
  )
}

describe('recoveryFor: 타임아웃과 네트워크 끊김', () => {
  it('타임아웃이면 재시도를 먼저, 직접 선택을 함께 준다', async () => {
    const error = await failedSend('timeout')
    expect(error).toMatchObject({ code: 'TIMEOUT', retryable: true })
    expect(recoveryFor(error, ALL)).toEqual({ reason: 'timeout', actions: ['retry', 'manual'] })
  })

  it('네트워크가 끊기면 재시도를 먼저, 직접 선택을 함께 준다', async () => {
    const error = await failedSend('network')
    expect(error).toMatchObject({ code: 'NETWORK', retryable: true })
    expect(recoveryFor(error, ALL)).toEqual({ reason: 'network', actions: ['retry', 'manual'] })
  })

  it('직접 선택이 없는 곳의 타임아웃은 재시도만 준다', async () => {
    expect(recoveryFor(await failedSend('timeout'), { retry: true, manual: false }).actions).toEqual(['retry'])
  })

  it('재시도도 직접 선택도 없는 곳이면 처음으로를 남긴다', async () => {
    expect(recoveryFor(await failedSend('network'), { retry: false, manual: false }).actions).toEqual(['home'])
  })
})

describe('recoveryFor: 재시도할 수 없는 오류', () => {
  it('서버가 retryable: false로 답하면 재시도 없이 직접 선택과 처음으로를 준다', async () => {
    const error = await failedSend(errorResponse(422, 'ROUTE_NOT_FOUND'))
    expect(error).toMatchObject({ code: 'ROUTE_NOT_FOUND', retryable: false })
    expect(recoveryFor(error, ALL)).toEqual({ reason: 'failed', actions: ['manual', 'home'] })
  })

  it('ApiError가 아닌 예외도 처음으로는 준다', () => {
    expect(recoveryFor(new Error('예상하지 못한 오류'), { retry: true, manual: false })).toEqual({
      reason: 'failed',
      actions: ['home'],
    })
  })
})
