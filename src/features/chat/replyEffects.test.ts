/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: /messages 응답 → store 반영값, 메시지 본문, INVALID_STATE 재동기화 화면 매핑 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import type { MessageOut } from '../../api'
import { messageBody, replyEffects, resyncPlan, standingAt, standingView } from './replyEffects'
import type { Whereabouts } from './replyEffects'
import { toViewModel } from './toViewModel'

const base: MessageOut = {
  status: 'answered',
  intent: 'payment_question',
  assistant_message: 'It depends on the train:',
  items: [],
  tip: null,
  unverified_notes: [],
  slots: { train_type: 'unknown', has_transit_card: 'unknown' },
  destination: null,
  suggested_replies: [],
  sources: [],
  next_action: 'none',
  message_id: 'msg_1',
  session: { state: 'idle', revision: 2 },
}

describe('replyEffects', () => {
  it('세션은 응답 값을 그대로 쓰고, 목적지가 없으면 null, 모르는 열차는 null이다', () => {
    const e = replyEffects(base)
    expect(e.session).toEqual({ state: 'idle', revision: 2 })
    expect(e.destination).toBeNull()
    expect(e.train).toBeNull()
    expect(e.clearLocation).toBe(false)
    expect(e.view.body).toBe('It depends on the train:')
  })

  it('destination_set: 서버 POI id를 그대로 넘기고, 열차 종류는 slots를 따른다', () => {
    const e = replyEffects({
      ...base,
      status: 'destination_set',
      destination: { poi_id: 'poi-allstop-tickets' },
      slots: { train_type: 'allstop', has_transit_card: 'no' },
      next_action: 'locate',
      session: { state: 'needs_location', revision: 5 },
    })
    expect(e.destination).toBe('poi-allstop-tickets')
    expect(e.train).toBe('allstop')
    expect(e.session.state).toBe('needs_location')
    expect(e.view.actions).toEqual(['findMe'])
  })

  it('데모 데이터에 없는 서버 목적지도 바꾸지 않고 그대로 넘긴다', () => {
    expect(replyEffects({ ...base, destination: { poi_id: 'poi-new-exit' } }).destination).toBe('poi-new-exit')
  })

  it('relocalize면 화면의 현재 위치를 지우게 한다', () => {
    expect(replyEffects({ ...base, status: 'relocalize', next_action: 'locate' }).clearLocation).toBe(true)
  })
})

describe('messageBody', () => {
  it('문장만 있으면 message만 보낸다', () => {
    expect(messageBody('돈은 어떻게 내요?')).toEqual({ message: '돈은 어떻게 내요?' })
  })

  it('칩·목록에서 고른 목적지는 selected_poi_id를 함께 보내고, 사진은 image로 넣는다', () => {
    const image = new Blob(['x'], { type: 'image/jpeg' })
    expect(messageBody('직통열차 승강장', 'poi-express-platform')).toEqual({ message: '직통열차 승강장', selected_poi_id: 'poi-express-platform' })
    expect(messageBody('뭘 눌러요?', null, image)).toEqual({ message: '뭘 눌러요?', image })
  })
})

describe('resyncPlan (409 INVALID_STATE 뒤 navigation-state의 next_action)', () => {
  it('reply·none은 채팅, locate는 위치 찾기, confirm_location은 직접 선택 화면으로 간다', () => {
    expect(resyncPlan('reply', false)).toEqual({ screen: 'chat', actions: ['restart'] })
    expect(resyncPlan('none', true)).toEqual({ screen: 'chat', actions: ['restart'] })
    expect(resyncPlan('locate', false).screen).toBe('locate')
    expect(resyncPlan('confirm_location', false).screen).toBe('manual')
  })

  it('navigate는 채팅에 길안내 시작 버튼을 붙인다', () => {
    expect(resyncPlan('navigate', false)).toEqual({ screen: 'chat', actions: ['startRoute', 'restart'] })
  })

  it('continue_navigation은 화면에 경로가 있을 때만 경로 화면으로 돌아간다', () => {
    expect(resyncPlan('continue_navigation', true).screen).toBe('route')
    expect(resyncPlan('continue_navigation', false).screen).toBe('chat')
  })
})

describe('standingAt (서버 목적지가 지금 서 있는 곳인지)', () => {
  const destinations = [
    { poiId: 'poi-express-tickets', nodeId: 'express-tickets', tickets: true },
    { poiId: 'poi-express-platform', nodeId: 'express-platform', tickets: false },
  ]
  // 4호선 개찰구에서 표 사는 곳까지 간 경로. 도착한 뒤에도 다음 목적지가 정해질 때까지 남아 있다
  const route = {
    destinationPoiId: 'poi-express-tickets',
    stops: [
      { nodeId: 'line4-gates', floorId: 'B1' },
      { nodeId: 'express-tickets', floorId: 'B2' },
    ],
  }
  const at = (where: Partial<Whereabouts>) => ({ here: 'express-tickets', destinations, route, ...where })

  it('표 사는 곳에 서 있는데 같은 표 사는 곳을 다시 받으면 tickets다', () => {
    expect(standingAt('poi-express-tickets', at({}))).toBe('tickets')
  })

  it('표 사는 곳이 아닌 장소에 서 있으면 place다', () => {
    expect(standingAt('poi-express-platform', at({ here: 'express-platform' }))).toBe('place')
  })

  it('다른 곳이 목적지이거나 위치가 없으면 null이다', () => {
    expect(standingAt('poi-express-platform', at({}))).toBeNull()
    expect(standingAt('poi-express-tickets', at({ here: 'line4-gates' }))).toBeNull()
    expect(standingAt('poi-express-tickets', at({ here: null }))).toBeNull()
  })

  it('목적지 목록이 없으면 방금 도착한 경로의 끝 노드로 본다', () => {
    expect(standingAt('poi-express-tickets', at({ destinations: null }))).toBe('place')
    expect(standingAt('poi-express-platform', at({ destinations: null }))).toBeNull()
    expect(standingAt('poi-express-tickets', at({ destinations: null, route: null }))).toBeNull()
  })
})

describe('standingView', () => {
  // 운영 서버가 표 사는 곳에서 "승차권은 어떻게 사요?"에 준 답의 모양 (2026-10-26)
  const again = toViewModel({
    ...base,
    status: 'destination_set',
    intent: 'ticket_purchase_and_navigation',
    assistant_message: '…직통열차 표 사는 곳(으)로 안내할게요. B2에 있어요. 위치가 확인돼 있어 바로 출발할 수 있어요.',
    destination: { poi_id: 'poi-express-tickets' },
    next_action: 'navigate',
    session: { state: 'ready_to_navigate', revision: 8 },
  })

  it('표 사는 곳이면 길안내 버튼 대신 표를 샀다고 알리는 버튼을 두고, 서버 문장은 그대로 둔다', () => {
    expect(again.actions).toEqual(['startRoute'])
    const v = standingView(again, 'tickets')
    expect(v.actions).toEqual(['boughtTicket'])
    expect(v.standingAt).toBe('tickets')
    expect(v.body).toBe(again.body)
    expect(v.destinationPoiId).toBe('poi-express-tickets')
  })

  it('다른 장소면 길안내 버튼만 빼고 나머지 버튼은 남긴다', () => {
    const v = standingView({ ...again, actions: ['startRoute', 'pickDest'] }, 'place')
    expect(v.actions).toEqual(['pickDest'])
    expect(v.standingAt).toBe('place')
  })
})
