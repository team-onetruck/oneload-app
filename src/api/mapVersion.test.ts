/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 409 MAP_VERSION_MISMATCH 지도 버전 갱신 래퍼를 가짜 fetch로 검증하는 단위 테스트
 */
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { errorResponse, fakeFetch, jsonResponse } from './fakeFetch'
import type { FakeReply } from './fakeFetch'
import { withMapVersionRefresh } from './mapVersion'
import type { MapsOut } from './types'

const SESSION = '/sessions/ses_1'
const MAP_ID = 'seoul-station'

const maps = (version: string): MapsOut => ({
  maps: [{ map_id: MAP_ID, name: { ko: '서울역', en: 'Seoul Station' }, version, floors: [], ar_supported: false }],
})

const routeOut = { route_id: 'route_1', session: { state: 'ready_to_navigate', revision: 4 } }

// 서버는 두 경우 모두 required_map_version에 서버의 현재 지도 버전을 담는다 (backend/app/api/deps.py).
const mismatch = (required: string) => errorResponse(409, 'MAP_VERSION_MISMATCH', { required_map_version: required })

// POST /routes 하나를 지도 버전 갱신 래퍼로 감싸 보낸다. 최신 버전은 GET /maps에서 읽는다.
function setup(replies: FakeReply[]) {
  const server = fakeFetch(replies)
  const client = createApiClient({ fetch: server.fetch, storage: null, timeoutMs: 5 })
  client.setSession({ sessionId: 'ses_1', token: 'tok_1' })
  const onRefresh = vi.fn()
  const createRoute = (mapVersion: string) =>
    withMapVersionRefresh(
      (version) =>
        client.request<typeof routeOut>(`${SESSION}/routes`, {
          method: 'POST',
          json: { expected_revision: 3, destination_poi_id: 'arex-express-ticket', map_version: version },
        }),
      {
        mapVersion,
        refresh: async () => {
          const found = (await client.request<MapsOut>('/maps')).maps.find((m) => m.map_id === MAP_ID)
          if (!found) throw new Error(`지도 목록에 ${MAP_ID}가 없다`)
          return found.version
        },
        onRefresh,
      },
    )
  const sentVersions = () => server.calls.map((c) => (c.json as { map_version?: string } | undefined)?.map_version)
  return { calls: server.calls, createRoute, onRefresh, sentVersions }
}

describe('withMapVersionRefresh', () => {
  it('버전이 맞으면 한 번만 보낸다', async () => {
    const { calls, createRoute, onRefresh } = setup([jsonResponse(200, routeOut)])

    await expect(createRoute('v1')).resolves.toEqual(routeOut)
    expect(calls).toHaveLength(1)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('앱의 지도 버전이 낡았으면 최신 버전을 받아 한 번 다시 보낸다', async () => {
    const { calls, createRoute, onRefresh, sentVersions } = setup([
      mismatch('v2'),
      jsonResponse(200, maps('v2')),
      jsonResponse(200, routeOut),
    ])

    await expect(createRoute('v1')).resolves.toEqual(routeOut)
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${SESSION}/routes`, 'GET /maps', `POST ${SESSION}/routes`])
    expect(sentVersions()).toEqual(['v1', undefined, 'v2'])
    expect(onRefresh).toHaveBeenCalledWith('v2')
  })

  it('새 버전으로 보내도 같은 코드면 더 재시도하지 않고 오류를 던진다', async () => {
    const { calls, createRoute } = setup([mismatch('v2'), jsonResponse(200, maps('v2')), mismatch('v3')])

    await expect(createRoute('v1')).rejects.toMatchObject({ status: 409, code: 'MAP_VERSION_MISMATCH' })
    expect(calls).toHaveLength(3)
  })

  it('받은 최신 버전이 보낸 버전과 같으면 세션의 지도가 바뀐 경우라 다시 보내지 않는다', async () => {
    const { calls, createRoute, onRefresh } = setup([mismatch('v2'), jsonResponse(200, maps('v1'))])

    await expect(createRoute('v1')).rejects.toMatchObject({ code: 'MAP_VERSION_MISMATCH' })
    expect(calls).toHaveLength(2)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('MAP_VERSION_MISMATCH가 아닌 409는 지도를 다시 읽지 않는다', async () => {
    const { calls, createRoute } = setup([errorResponse(409, 'REVISION_CONFLICT', { revision: 5 })])

    await expect(createRoute('v1')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(calls).toHaveLength(1)
  })

  it('지도 버전을 읽다가 네트워크가 끊기면 다시 보내지 않고 그 오류를 던진다', async () => {
    const { calls, createRoute } = setup([mismatch('v2'), 'network'])

    await expect(createRoute('v1')).rejects.toMatchObject({ code: 'NETWORK' })
    expect(calls).toHaveLength(2)
  })
})
