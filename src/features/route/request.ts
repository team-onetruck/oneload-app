/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: POST /routes 요청 본문을 만든다. 처음 경로와 길을 잃은 뒤의 재탐색(reroute=true)을 함께 다룬다
 */
import type { NavigationStateOut, RouteIn } from '../../api/types'

export interface RouteRequestInput {
  // 직전 서버 응답의 session.revision. 다르면 409 REVISION_CONFLICT
  revision: number
  // /messages에서 정해진 목적지와 같아야 한다. 다르면 422 INVALID_INPUT (backend/app/api/routes.py)
  destinationPoiId: string
  // 앱이 가진 지도 버전. 서버와 다르면 409 MAP_VERSION_MISMATCH
  mapVersion: string
  // 비우면 서버가 세션에 저장된 선호를 쓴다
  preferences?: RouteIn['preferences']
}

// 출발지는 서버가 확정한 위치(confirmed_node)뿐이다. 클라이언트가 출발 노드를 보내지 않는다.
export function buildRouteRequest(input: RouteRequestInput, { reroute = false }: { reroute?: boolean } = {}): RouteIn {
  return {
    expected_revision: input.revision,
    destination_poi_id: input.destinationPoiId,
    map_version: input.mapVersion,
    start: { type: 'confirmed_node' },
    reroute,
    ...(input.preferences ? { preferences: input.preferences } : {}),
  }
}

// 같은 목적지로 다시 계산한다. 서버는 활성 경로가 있으면 route_id를 유지하고 route_revision만 올린다.
export const buildRerouteRequest = (input: RouteRequestInput): RouteIn => buildRouteRequest(input, { reroute: true })

export type ReroutePlan =
  // 위치가 다시 확정됐다. 이 본문으로 /routes를 부른다
  | { kind: 'ready'; request: RouteIn }
  // '길을 잃었어요' 뒤라 서버가 확정 위치를 지웠다 (backend/app/api/conversation.py relocalize). 위치부터 다시 확인한다
  | { kind: 'needs_location' }
  // 취소 등으로 목적지가 없다. 재탐색이 아니라 목적지부터 다시 정한다
  | { kind: 'no_destination' }

// navigation-state를 보고 재탐색을 보낼 수 있는지 정한다. 목적지와 revision은 서버 값을 쓰고, 지도 버전은 앱이 가진 값을 쓴다.
export function planReroute(
  state: Pick<NavigationStateOut, 'session' | 'destination_poi_id' | 'confirmed_node_id'>,
  mapVersion: string,
  preferences?: RouteIn['preferences'],
): ReroutePlan {
  if (!state.destination_poi_id) return { kind: 'no_destination' }
  if (!state.confirmed_node_id) return { kind: 'needs_location' }
  return {
    kind: 'ready',
    request: buildRerouteRequest({
      revision: state.session.revision,
      destinationPoiId: state.destination_poi_id,
      mapVersion,
      preferences,
    }),
  }
}
