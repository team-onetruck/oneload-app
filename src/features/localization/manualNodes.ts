/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 위치 직접 선택 화면의 노드 목록을 서버 지도 그래프(GET /maps/{map_id}/graph)에서 만든다
 */
import type { ApiAdapter, GraphOut } from '../../api/types'

export interface ManualNode {
  id: string
  floorId: string
  name: GraphOut['nodes'][number]['name']
}

// 그래프에는 고를 수 있는 출발점 표시가 없어서 모든 노드를 서버 순서 그대로 보여 준다.
export function toManualNodes(graph: GraphOut): ManualNode[] {
  return graph.nodes.map((node) => ({ id: node.id, floorId: node.floor_id, name: node.name }))
}

export async function loadManualNodes(api: Pick<ApiAdapter, 'getMapGraph'>, mapId: string): Promise<ManualNode[]> {
  return toManualNodes(await api.getMapGraph(mapId))
}
