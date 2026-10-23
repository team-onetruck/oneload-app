/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: '다시 시도'가 처음 요청과 같은 Idempotency-Key로 다시 보내는지 가짜 fetch로 검증한다
 */
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../../api/client'
import { ApiError } from '../../api/errors'
import { errorResponse, fakeFetch, jsonResponse } from '../../api/fakeFetch'
import type { FakeReply } from '../../api/fakeFetch'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { FailHandlers } from './context'
import { retryOptions, retryWith, sendWithRecovery } from './retry'

const BODY = { message: '돈은 어떻게 내요?' }
const messageOut = { message_id: 'msg_1', session: { state: 'idle', revision: 2 } }

function setup(replies: FakeReply[]) {
  const server = fakeFetch(replies)
  const adapter = createHttpAdapter(createApiClient({ fetch: server.fetch, storage: null, timeoutMs: 5 }))
  const keys = () => server.calls.map((c) => c.headers.get('Idempotency-Key'))
  return { server, adapter, keys }
}

describe('retryOptions', () => {
  it('ApiError에 키가 있으면 그 키를 넣고, 다른 옵션은 그대로 둔다', () => {
    const error = new ApiError(0, 'TIMEOUT', 'timeout', null, { retryable: true, idempotencyKey: 'key-1' })
    expect(retryOptions(error, { timeoutMs: 30_000 })).toEqual({ timeoutMs: 30_000, idempotencyKey: 'key-1' })
  })

  it('키가 없던 오류나 ApiError가 아닌 예외는 옵션을 바꾸지 않는다', () => {
    expect(retryOptions(new ApiError(404, 'NOT_FOUND', 'not found'))).toEqual({})
    expect(retryOptions(new Error('예상하지 못한 오류'), { timeoutMs: 1 })).toEqual({ timeoutMs: 1 })
  })
})

describe('retryWith', () => {
  it('타임아웃 뒤 다시 보낼 때 처음 요청의 Idempotency-Key와 같은 본문을 쓴다', async () => {
    const { server, adapter, keys } = setup(['timeout', jsonResponse(200, messageOut)])
    const send = (options: Parameters<typeof adapter.sendMessage>[2]) => adapter.sendMessage('ses_1', BODY, options)

    const error = await send({}).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'TIMEOUT' })
    await expect(retryWith(error, send)).resolves.toEqual(messageOut)

    expect(keys()[0]).toBeTruthy()
    expect(keys()[1]).toBe(keys()[0])
    expect(server.calls[1].json).toEqual(server.calls[0].json)
  })
})

describe('sendWithRecovery', () => {
  it('실패하면 fail로 넘기고, 다시 시도는 같은 키로 보내 성공하면 onSuccess를 부른다', async () => {
    const { adapter, keys } = setup(['network', jsonResponse(200, messageOut)])
    const onSuccess = vi.fn()
    const manual = vi.fn()
    let handlers: FailHandlers = {}
    const fail = vi.fn((_error: unknown, h: FailHandlers = {}) => {
      handlers = h
    })

    await sendWithRecovery((options) => adapter.sendMessage('ses_1', BODY, options), { fail, onSuccess, manual })
    expect(fail).toHaveBeenCalledTimes(1)
    expect(fail.mock.calls[0][0]).toMatchObject({ code: 'NETWORK' })
    // 직접 선택은 호출한 곳이 준 것을 그대로 넘긴다.
    expect(handlers.manual).toBe(manual)
    expect(onSuccess).not.toHaveBeenCalled()

    handlers.retry?.()
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(messageOut))
    expect(keys()[1]).toBe(keys()[0])
  })

  it('다시 보낸 요청도 실패하면 다시 fail로 가고, 그다음 재시도도 처음 키를 쓴다', async () => {
    const { adapter, keys } = setup(['timeout', 'timeout', jsonResponse(200, messageOut)])
    const onSuccess = vi.fn()
    const retries: (() => void)[] = []
    const fail = vi.fn((_error: unknown, h: FailHandlers = {}) => {
      if (h.retry) retries.push(h.retry)
    })

    await sendWithRecovery((options) => adapter.sendMessage('ses_1', BODY, options), { fail, onSuccess })
    retries[0]()
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(2))
    retries[1]()
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(messageOut))
    expect(new Set(keys()).size).toBe(1)
  })

  it('세션이 끝난 오류도 그대로 fail로 넘긴다 (화면 전환은 RecoveryProvider가 정한다)', async () => {
    const { adapter, server } = setup([errorResponse(401, 'SESSION_EXPIRED')])
    const fail = vi.fn()

    await sendWithRecovery((options) => adapter.sendMessage('ses_1', BODY, options), { fail, onSuccess: vi.fn() })
    expect(fail.mock.calls[0][0]).toMatchObject({ status: 401, code: 'SESSION_EXPIRED' })
    expect(server.calls).toHaveLength(1)
  })
})
