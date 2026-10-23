/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 지도 그래프 캐시가 지도마다 한 번만 요청하고, 실패와 초기화 뒤에는 다시 받는지 검증한다
 */
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../../api/client'
import { createHttpAdapter } from '../../api/httpAdapter'
import { GRAPH, MAP_ID, MAP_VERSION } from '../../test/fixtures/seoulStation'
import { createGraphCache } from './graphCache'

describe('createGraphCache', () => {
  it('같은 지도를 여러 곳에서 동시에 불러도 요청은 한 번만 보낸다', async () => {
    const load = vi.fn(async () => GRAPH)
    const cache = createGraphCache(load)
    const [a, b] = await Promise.all([cache.get(MAP_ID), cache.get(MAP_ID)])
    expect(a).toBe(b)
    expect(await cache.get(MAP_ID)).toBe(a)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('실패한 요청은 남기지 않아 다음 get에서 다시 받는다', async () => {
    const load = vi.fn<(mapId: string) => Promise<typeof GRAPH>>().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(GRAPH)
    const cache = createGraphCache(load)
    await expect(cache.get(MAP_ID)).rejects.toThrow('network')
    expect(await cache.get(MAP_ID)).toBe(GRAPH)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('clear 뒤와 다른 지도는 새로 받는다', async () => {
    const load = vi.fn(async (_mapId: string) => GRAPH)
    const cache = createGraphCache(load)
    await cache.get(MAP_ID)
    cache.clear()
    await cache.get(MAP_ID)
    await cache.get('other-map')
    expect(load.mock.calls.map(([id]) => id)).toEqual([MAP_ID, MAP_ID, 'other-map'])
  })

  it('MSW 가짜 백엔드의 그래프를 map_version과 함께 받는다', async () => {
    const api = createHttpAdapter(createApiClient({ baseUrl: 'http://api.test/api/v1', storage: null }))
    const graph = await createGraphCache((id) => api.getMapGraph(id)).get(MAP_ID)
    expect(graph.map_version).toBe(MAP_VERSION)
    expect(graph.nodes.map((n) => n.id)).toContain('line4-gates')
  })
})
