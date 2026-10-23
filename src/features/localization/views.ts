/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 후보·직접 선택 화면이 보는 장소 모델. 서버 후보(그래프 이름)와 데모 후보(data.ts)를 같은 모양으로 바꾼다
 */
import type { GraphOut } from '../../api/types'
import { NODES } from '../../data'
import type { Candidate, NodeId, Text } from '../../data'
import type { LocationCandidate } from './locate'
import { toManualNodes } from './manualNodes'

export interface PlaceView {
  // 확정할 때 쓰는 id. http 모드는 서버 node_id, mock 모드는 data.ts NodeId
  nodeId: string
  floor: string
  // 그래프에 없는 노드면 null. 화면은 이름을 지어내지 않고 nodeId를 그대로 보여 준다
  name: Text | null
}

export interface CandidateView extends PlaceView {
  // 서버 근거는 세션 언어로 된 문자열, 데모 근거는 두 언어 Text
  evidence: Array<string | Text>
}

// 서버 후보. 순서는 서버 순서 그대로이고 rank_score는 넣지 않는다 (확률처럼 보이지 않게)
export function candidateViews(candidates: LocationCandidate[], graph: GraphOut | null): CandidateView[] {
  const names = new Map(graph?.nodes.map((n) => [n.id, n.name]))
  return candidates.map((c) => ({ nodeId: c.node_id, floor: c.floor_id, name: names.get(c.node_id) ?? null, evidence: c.evidence }))
}

// 서버 그래프의 노드 전체. 그래프에 출발점 표시가 없어 거르지 않는다
export function manualPlaces(graph: GraphOut): PlaceView[] {
  return toManualNodes(graph).map((n) => ({ nodeId: n.id, floor: n.floorId, name: n.name }))
}

// --- 데모(mock) 모드: data.ts의 노드와 SCENARIOS를 같은 모양으로 ---

const MOCK_START_NODES: NodeId[] = ['ktxHall', 'l1gate', 'l4gate', 'concourse', 'expressDesk', 'machines']

export function mockCandidateViews(found: Candidate[]): CandidateView[] {
  return found.map((c) => ({ nodeId: c.node, floor: NODES[c.node].floor, name: NODES[c.node].name, evidence: c.evidence }))
}

export function mockManualPlaces(): PlaceView[] {
  return MOCK_START_NODES.map((n) => ({ nodeId: n, floor: NODES[n].floor, name: NODES[n].name }))
}
