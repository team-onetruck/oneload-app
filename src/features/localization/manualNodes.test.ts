/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 직접 선택 노드 목록(loadManualNodes)이 서버 지도 그래프의 노드를 그대로 옮기는지 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from '../../api/client'
import type { FetchLike } from '../../api/client'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { GraphOut } from '../../api/types'
import { loadManualNodes, toManualNodes } from './manualNodes'

// 서버 GraphOut 모양의 가짜 응답. 노드는 backend/tests/fixtures/maps/seoul-station.json 일부
const GRAPH: GraphOut = {
  map_id: 'seoul-station',
  map_version: '2026-10-22.1',
  coordinate_system: {},
  floors: [
    { floor_id: '2F', elevation_m: 8 },
    { floor_id: 'B1', elevation_m: -6 },
  ],
  nodes: [
    { id: 'ktx-hall', floor_id: '2F', position: { x: 0, y: 0, z: 8 }, name: { en: 'KTX hall (Seoul Station)', ko: '서울역 KTX 맞이방' } },
    { id: 'line4-gates', floor_id: 'B1', position: { x: 10, y: 0, z: -6 }, name: { en: 'Line 4 Seoul Station gates', ko: '4호선 서울역 개찰구' } },
  ],
  edges: [],
  landmarks: [],
  panoramas: [],
}

describe('toManualNodes', () => {
  it('그래프 노드를 서버 순서 그대로 id·층·이름으로 옮긴다', () => {
    expect(toManualNodes(GRAPH)).toEqual([
      { id: 'ktx-hall', floorId: '2F', name: { en: 'KTX hall (Seoul Station)', ko: '서울역 KTX 맞이방' } },
      { id: 'line4-gates', floorId: 'B1', name: { en: 'Line 4 Seoul Station gates', ko: '4호선 서울역 개찰구' } },
    ])
  })
})

describe('loadManualNodes', () => {
  it('GET /maps/{map_id}/graph를 불러 노드 목록을 만든다', async () => {
    const urls: string[] = []
    const fetch: FetchLike = async (url) => {
      urls.push(url)
      return new Response(JSON.stringify(GRAPH), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const api = createHttpAdapter(createApiClient({ baseUrl: '/api/v1', fetch, storage: null }))

    const nodes = await loadManualNodes(api, 'seoul-station')

    expect(urls).toEqual(['/api/v1/maps/seoul-station/graph'])
    expect(nodes.map((n) => n.id)).toEqual(['ktx-hall', 'line4-gates'])
  })
})
