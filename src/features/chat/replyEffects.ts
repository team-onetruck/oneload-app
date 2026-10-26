/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: /messages 응답과 navigation-state를 store가 반영할 값(세션, 목적지, 열차, 화면)으로 바꾸는 순수 함수
 */
import type { MessageOut, NavigationStateOut, SendMessageIn, SessionStatus } from '../../api'
import type { TrainType } from '../../data'
import type { DestinationView } from '../map/destinations'
import type { ActiveRoute } from '../route/guide'
import { toViewModel } from './toViewModel'
import type { ChatAction, ReplyView, StandingAt } from './toViewModel'

export interface ReplyEffects {
  view: ReplyView
  // 세션 state·revision은 응답 값을 그대로 쓴다
  session: SessionStatus
  // 서버가 목적지를 정했을 때만 있다. 서버 poi_id 그대로다
  destination: string | null
  // 서버가 기억하는 열차 종류. 아직 모르면 null
  train: TrainType | null
  // relocalize: 서버가 확정 위치를 지웠으므로 화면의 현재 위치도 지운다
  clearLocation: boolean
}

export function replyEffects(res: MessageOut): ReplyEffects {
  const poiId = res.destination?.poi_id
  return {
    view: toViewModel(res),
    session: res.session,
    destination: poiId ?? null,
    train: res.slots.train_type === 'unknown' ? null : res.slots.train_type,
    clearLocation: res.status === 'relocalize',
  }
}

export interface Whereabouts {
  // 서버가 확정한 현재 위치 node_id
  here: string | null
  // 서버 목적지 목록. 받기 전이면 null
  destinations: Pick<DestinationView, 'poiId' | 'nodeId' | 'tickets'>[] | null
  // 마지막 서버 경로. 도착한 뒤에도 다음 목적지가 정해질 때까지 남아 있다
  route: Pick<ActiveRoute, 'destinationPoiId' | 'stops'> | null
}

// 서버가 정한 목적지가 지금 서 있는 곳인지. 표 사는 곳에 도착한 뒤 "승차권은 어떻게 사요?"라고 물으면
// 서버가 같은 표 사는 곳을 목적지로 다시 정하고 길안내를 권한다. 그 경로는 출발점 하나, 단계 0개라 다시 안내하지 않는다.
// 장소의 노드는 목적지 목록에서 찾고, 목록이 없으면 방금 도착한 경로의 끝 노드로 본다
export function standingAt(poiId: string, { here, destinations, route }: Whereabouts): StandingAt | null {
  if (here === null) return null
  const poi = destinations?.find((d) => d.poiId === poiId)
  const node = poi?.nodeId ?? (route?.destinationPoiId === poiId ? route.stops[route.stops.length - 1]?.nodeId : undefined)
  if (node !== here) return null
  return poi?.tickets ? 'tickets' : 'place'
}

// 지금 서 있는 곳을 목적지로 받은 답. 서버 문장은 고치지 않고 길안내 버튼만 뺀다.
// 표 사는 곳이면 표를 산 뒤 승강장으로 넘어가는 버튼을 앞에 둔다
export function standingView(view: ReplyView, at: StandingAt): ReplyView {
  const actions = view.actions.filter((a) => a !== 'startRoute')
  return { ...view, standingAt: at, actions: at === 'tickets' ? ['boughtTicket', ...actions] : actions }
}

// 사용자가 보낸 한 번의 말을 /messages 본문으로 만든다. 칩·목록에서 고른 목적지는 selected_poi_id를 함께 보낸다.
export function messageBody(text: string, selectedPoiId: string | null = null, image?: Blob): SendMessageIn {
  return {
    message: text,
    ...(selectedPoiId ? { selected_poi_id: selectedPoiId } : {}),
    ...(image ? { image } : {}),
  }
}

export type ResyncScreen = 'chat' | 'locate' | 'manual' | 'route'

// 409 INVALID_STATE 뒤 다시 읽은 서버 상태로 갈 화면과 오류 말풍선에 붙일 버튼을 정한다.
// navigate는 채팅에 '길안내 시작'을 보여 주고, 진행 중인 안내는 화면에 경로가 있을 때만 경로 화면으로 돌아간다.
export function resyncPlan(next: NavigationStateOut['next_action'], hasRoute: boolean): { screen: ResyncScreen; actions: ChatAction[] } {
  switch (next) {
    case 'locate':
      return { screen: 'locate', actions: ['restart'] }
    case 'confirm_location':
      return { screen: 'manual', actions: ['restart'] }
    case 'navigate':
      return { screen: 'chat', actions: ['startRoute', 'restart'] }
    case 'continue_navigation':
      return { screen: hasRoute ? 'route' : 'chat', actions: ['restart'] }
    case 'reply':
    case 'none':
      return { screen: 'chat', actions: ['restart'] }
  }
}
