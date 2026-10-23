/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 테스트용 가짜 fetch(noResponse, losingFirstResponse, fakeFetch의 'timeout')가 이미 끊긴 신호에서도 기다리지 않고 끝나는지 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from './client'
import type { FetchLike } from './client'
import { fakeFetch, jsonResponse, losingFirstResponse, noResponse } from './fakeFetch'

// 결과가 정해진 시간 안에 나지 않으면 'pending'. 영원히 기다리는 버그를 테스트 타임아웃 대신 바로 드러낸다
const settleWithin = <T>(promise: Promise<T>, ms = 200) =>
  Promise.race([promise.then(
    (value) => ({ kind: 'resolved' as const, value }),
    (error: unknown) => ({ kind: 'rejected' as const, error }),
  ), new Promise<{ kind: 'pending' }>((resolve) => setTimeout(() => resolve({ kind: 'pending' }), ms))])

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('noResponse', () => {
  it('이미 끊긴 신호면 바로 AbortError로 끝난다', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await settleWithin(noResponse(controller.signal))).toMatchObject({ kind: 'rejected', error: { name: 'AbortError' } })
  })

  it('나중에 끊기면 그때 AbortError로 끝난다', async () => {
    const controller = new AbortController()
    const pending = noResponse(controller.signal)
    setTimeout(() => controller.abort(), 10)
    expect(await settleWithin(pending)).toMatchObject({ kind: 'rejected', error: { name: 'AbortError' } })
  })
})

describe('losingFirstResponse', () => {
  it('서버 처리 중에 클라이언트가 이미 끊었어도 기다리지 않고 AbortError로 끝나며, 잃어버린 응답은 남긴다', async () => {
    const controller = new AbortController()
    // 서버가 처리를 마치기 전에 클라이언트 타임아웃이 먼저 난 상황
    const next: FetchLike = async () => {
      controller.abort()
      return jsonResponse(200, { message_id: 'msg_1' })
    }
    const lose = losingFirstResponse('/messages', next)

    const first = lose.fetch('http://api.test/api/v1/sessions/ses_1/messages', { method: 'POST', body: '{}', signal: controller.signal })
    expect(await settleWithin(first)).toMatchObject({ kind: 'rejected', error: { name: 'AbortError' } })
    expect(lose.lost).toEqual([{ message_id: 'msg_1' }])
  })

  it('클라이언트에서는 서버가 타임아웃보다 늦어도 TIMEOUT으로 끝난다', async () => {
    const next: FetchLike = async () => {
      await sleep(40)
      return jsonResponse(200, { message_id: 'msg_1' })
    }
    const lose = losingFirstResponse('/messages', next)
    const client = createApiClient({ baseUrl: 'http://api.test/api/v1', storage: null, timeoutMs: 5, fetch: lose.fetch })

    const result = await settleWithin(client.request('/sessions/ses_1/messages', { method: 'POST', json: { message: 'Express' } }))
    expect(result).toMatchObject({ kind: 'rejected', error: { code: 'TIMEOUT', retryable: true } })
    expect(lose.sent).toHaveLength(1)
  })

  it('두 번째 요청부터는 그대로 서버로 보낸다', async () => {
    const lose = losingFirstResponse('/messages', async () => jsonResponse(200, { ok: true }))
    const controller = new AbortController()
    const first = lose.fetch('http://api.test/api/v1/sessions/ses_1/messages', { method: 'POST', body: '{}', signal: controller.signal })
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })

    const second = await lose.fetch('http://api.test/api/v1/sessions/ses_1/messages', { method: 'POST', body: '{}' })
    expect(await second.json()).toEqual({ ok: true })
    expect(lose.sent).toHaveLength(2)
  })
})

describe("fakeFetch의 'timeout'", () => {
  it('이미 끊긴 신호로 보내도 기다리지 않고 AbortError로 끝난다', async () => {
    const { fetch } = fakeFetch(['timeout'])
    const controller = new AbortController()
    controller.abort()
    expect(await settleWithin(fetch('/api/v1/maps', { signal: controller.signal }))).toMatchObject({ kind: 'rejected', error: { name: 'AbortError' } })
  })
})
