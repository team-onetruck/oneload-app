/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 노드 id와 데모 경로(data.ts)의 NodeId를 잇는 임시 다리. 경로가 서버 steps로 바뀌면(작업 4) 지운다
 */
import type { NodeId } from '../../data'

// 서버 지도(backend tests/fixtures/maps/seoul-station.json, 버전 2026-10-22.1)의 노드와 data.ts NODES를
// 이름(en·ko)이 같은 것끼리 짝지었다. nodeBridge.test.ts가 src/test/fixtures의 노드 이름과 data.ts NODES 이름이 같은지 검사한다.
const SERVER_TO_LOCAL: Record<string, NodeId> = {
  'ktx-hall': 'ktxHall',
  'line1-gates': 'l1gate',
  'line4-gates': 'l4gate',
  'arex-concourse': 'concourse',
  'express-tickets': 'expressDesk',
  'allstop-tickets': 'machines',
  'express-gates': 'expressGate',
  'allstop-gates': 'allstopGate',
  'express-platform': 'expressPlatform',
  'allstop-platform': 'allstopPlatform',
}

const LOCAL_TO_SERVER = Object.fromEntries(Object.entries(SERVER_TO_LOCAL).map(([server, local]) => [local, server])) as Record<
  NodeId,
  string
>

// 모르는 id면 null. 짐작해서 다른 장소로 잇지 않는다.
export const localNodeOf = (serverNodeId: string): NodeId | null => SERVER_TO_LOCAL[serverNodeId] ?? null

export const serverNodeOf = (node: NodeId): string => LOCAL_TO_SERVER[node]
