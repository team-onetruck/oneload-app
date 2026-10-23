/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 409 REVISION_CONFLICT 재동기화 래퍼를 가짜 fetch로 검증하는 단위 테스트
 */
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import type { ApiError } from './errors'
import { errorResponse, fakeFetch, jsonResponse } from './fakeFetch'
import type { FakeReply } from './fakeFetch'
import { withRevisionResync } from './revision'

const SESSION = '/sessions/ses_1'

const navigationState = (revision: number) => ({
  session: { state: 'ready_to_navigate', revision },
  destination_poi_id: 'arex-express-ticket',
  confirmed_node_id: 'line4-gates',
  active_route_id: null,
  route_revision: null,
  map_version: 'v1',
  next_action: 'navigate',
})

const routeOut = (revision: number) => ({ route_id: 'route_1', session: { state: 'ready_to_navigate', revision } })

// POST /routes 하나를 재동기화 래퍼로 감싸 보낸다.
function setup(replies: FakeReply[]) {
  const server = fakeFetch(replies)
  const client = createApiClient({ fetch: server.fetch, storage: null })
  client.setSession({ sessionId: 'ses_1', token: 'tok_1' })
  const onResync = vi.fn()
  const createRoute = (revision: number) =>
    withRevisionResync(
      (expected) =>
        client.request<ReturnType<typeof routeOut>>(`${SESSION}/routes`, {
          method: 'POST',
          json: { expected_revision: expected, destination_poi_id: 'arex-express-ticket', map_version: 'v1' },
        }),
      {
        revision,
        resync: () => client.request<ReturnType<typeof navigationState>>(`${SESSION}/navigation-state`),
        onResync,
      },
    )
  return { calls: server.calls, createRoute, onResync }
}

describe('withRevisionResync', () => {
  it('충돌이 없으면 한 번만 보낸다', async () => {
    const { calls, createRoute, onResync } = setup([jsonResponse(200, routeOut(4))])

    await expect(createRoute(3)).resolves.toEqual(routeOut(4))
    expect(calls).toHaveLength(1)
    expect(onResync).not.toHaveBeenCalled()
  })

  it('409 REVISION_CONFLICT면 navigation-state를 읽고 최신 revision으로 한 번 다시 보낸다', async () => {
    const { calls, createRoute, onResync } = setup([
      errorResponse(409, 'REVISION_CONFLICT', { revision: 5 }),
      jsonResponse(200, navigationState(5)),
      jsonResponse(200, routeOut(6)),
    ])

    await expect(createRoute(3)).resolves.toEqual(routeOut(6))
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${SESSION}/routes`,
      `GET ${SESSION}/navigation-state`,
      `POST ${SESSION}/routes`,
    ])
    expect(calls.map((c) => (c.json as { expected_revision?: number } | undefined)?.expected_revision)).toEqual([3, undefined, 5])
    // 다시 읽은 서버 상태를 화면 쪽에 넘긴 뒤 재시도한다.
    expect(onResync).toHaveBeenCalledWith(navigationState(5))
    // 재동기화 요청에도 세션 토큰을 붙인다.
    expect(calls[1].headers.get('Authorization')).toBe('Bearer tok_1')
    // 본문이 다른 두 요청이므로 같은 Idempotency-Key를 쓰지 않는다.
    expect(calls[0].headers.get('Idempotency-Key')).not.toBe(calls[2].headers.get('Idempotency-Key'))
  })

  it('다시 보낸 요청도 409면 더 재시도하지 않고 오류를 던진다', async () => {
    const { calls, createRoute } = setup([
      errorResponse(409, 'REVISION_CONFLICT', { revision: 5 }),
      jsonResponse(200, navigationState(5)),
      errorResponse(409, 'REVISION_CONFLICT', { revision: 6 }),
    ])

    await expect(createRoute(3)).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' })
    expect(calls).toHaveLength(3)
  })

  it('REVISION_CONFLICT가 아닌 409는 재동기화하지 않는다', async () => {
    const { calls, createRoute, onResync } = setup([errorResponse(409, 'INVALID_STATE', { state: 'navigating' })])

    await expect(createRoute(3)).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' })
    expect(calls).toHaveLength(1)
    expect(onResync).not.toHaveBeenCalled()
  })

  it('재동기화 중 세션이 만료되면 재시도하지 않고 그 오류를 던진다', async () => {
    const { calls, createRoute } = setup([
      errorResponse(409, 'REVISION_CONFLICT', { revision: 5 }),
      errorResponse(401, 'SESSION_EXPIRED'),
    ])

    const error: ApiError = await createRoute(3).catch((e) => e)
    expect(error).toMatchObject({ status: 401, code: 'SESSION_EXPIRED' })
    expect(calls).toHaveLength(2)
  })
})
