/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 POI id와 데모 경로(data.ts)의 PoiId를 잇는 임시 다리. 경로가 서버 steps로 바뀌면(작업 4) 지운다
 */
import type { PoiId } from '../../data'

// 서버 지도(backend tests/fixtures/maps/seoul-station.json, 버전 2026-10-22.1)의 POI와 data.ts의 목적지를
// 이름(en·ko)이 같은 것끼리 짝지었다. poiBridge.test.ts가 src/test/fixtures의 POI 이름과 data.ts NODES 이름이 같은지 검사한다.
const SERVER_TO_LOCAL: Record<string, PoiId> = {
  'poi-express-tickets': 'expressDesk',
  'poi-allstop-tickets': 'machines',
  'poi-express-platform': 'expressPlatform',
  'poi-allstop-platform': 'allstopPlatform',
}

const LOCAL_TO_SERVER = Object.fromEntries(Object.entries(SERVER_TO_LOCAL).map(([server, local]) => [local, server])) as Record<
  PoiId,
  string
>

// 모르는 id면 null. 짐작해서 다른 목적지로 잇지 않는다.
export const localPoiOf = (serverPoiId: string): PoiId | null => SERVER_TO_LOCAL[serverPoiId] ?? null

export const serverPoiOf = (poi: PoiId): string => LOCAL_TO_SERVER[poi]
