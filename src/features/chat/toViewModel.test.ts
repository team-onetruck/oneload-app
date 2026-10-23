/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 메시지 응답·호출 오류를 말풍선 모델로 바꾸는 toViewModel / toErrorView 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api'
import type { MessageOut } from '../../api'
import { toErrorView, toViewModel } from './toViewModel'

// 로컬 백엔드(RuleAgent)가 "Incheon Airport"에 실제로 돌려준 응답
const trainTypes: MessageOut = {
  status: 'needs_clarification',
  intent: 'ticket_purchase_and_navigation',
  assistant_message: 'Two Airport Railroad (AREX) trains go to Incheon Airport. They are paid for differently. Which one do you want?',
  items: [
    'Express: non-stop, every seat reserved. You buy a ticket.',
    'All-stop: stops at every station. You tap a transit card, like the subway.',
  ],
  tip: null,
  unverified_notes: [],
  slots: { train_type: 'unknown', has_transit_card: 'unknown' },
  destination: null,
  suggested_replies: [
    { label: 'Express', selected_poi_id: null },
    { label: 'All-stop', selected_poi_id: null },
    { label: 'Not sure', selected_poi_id: null },
  ],
  sources: [{ document_id: 'doc-arex-train-types', title: 'AREX train types (demo doc)', source_url: null, verified_at: '2026-10-15' }],
  next_action: 'reply',
  message_id: 'msg_ef0b7433b98247ac',
  session: { state: 'needs_clarification', revision: 2 },
}

// 같은 서버가 "Express"에 돌려준 응답 (위치가 아직 없음)
const expressDesk: MessageOut = {
  status: 'destination_set',
  intent: 'ticket_purchase_and_navigation',
  assistant_message: "I'll take you to the Express ticket counter, on B2. First, take a photo of a nearby sign and confirm where you are.",
  items: [],
  tip: 'You can pay by card or cash at the counter.',
  unverified_notes: [],
  slots: { train_type: 'express', has_transit_card: 'unknown' },
  destination: { poi_id: 'poi-express-tickets' },
  suggested_replies: [],
  sources: [
    {
      document_id: 'arex-official-seoul-floors',
      title: 'AREX official guide: Seoul Station',
      source_url: 'https://www.airportrailroad.com/co/steUsfGud.do',
      verified_at: '2026-10-22',
    },
  ],
  next_action: 'locate',
  message_id: 'msg_7514d99e97ae8967',
  session: { state: 'needs_location', revision: 3 },
}

const reply = (patch: Partial<MessageOut>): MessageOut => ({ ...trainTypes, suggested_replies: [], sources: [], items: [], ...patch })

describe('toViewModel', () => {
  it('needs_clarification: 본문, 번호 목록, 출처, 칩을 그대로 옮기고 버튼은 만들지 않는다', () => {
    const v = toViewModel(trainTypes)
    expect(v.kind).toBe('reply')
    expect(v.status).toBe('needs_clarification')
    expect(v.body).toBe(trainTypes.assistant_message)
    expect(v.items).toEqual(trainTypes.items)
    expect(v.sources).toEqual([{ id: 'doc-arex-train-types', title: 'AREX train types (demo doc)', url: null, verifiedAt: '2026-10-15' }])
    expect(v.chips).toEqual([
      { label: 'Express', selectedPoiId: null },
      { label: 'All-stop', selectedPoiId: null },
      { label: 'Not sure', selectedPoiId: null },
    ])
    expect(v.actions).toEqual([])
    expect(v.refused).toBe(false)
  })

  it('destination_set + locate: 팁 콜아웃, 목적지 id, 위치 찾기 버튼을 만든다', () => {
    const v = toViewModel(expressDesk)
    expect(v.status).toBe('destination_set')
    expect(v.tip).toBe('You can pay by card or cash at the counter.')
    expect(v.destinationPoiId).toBe('poi-express-tickets')
    expect(v.actions).toEqual(['findMe'])
    expect(v.sources[0].url).toBe('https://www.airportrailroad.com/co/steUsfGud.do')
  })

  it('destination_set + navigate: 길안내 시작 버튼을 만든다', () => {
    expect(toViewModel({ ...expressDesk, next_action: 'navigate' }).actions).toEqual(['startRoute'])
  })

  it('relocalize: 위치를 다시 찾는 버튼을 만든다', () => {
    const v = toViewModel(reply({ status: 'relocalize', intent: 'report_off_route', next_action: 'locate' }))
    expect(v.status).toBe('relocalize')
    expect(v.actions).toEqual(['findMe'])
  })

  it('recapture는 위치 찾기 버튼, confirm_location·reply·none은 버튼 없음', () => {
    expect(toViewModel(reply({ next_action: 'recapture' })).actions).toEqual(['findMe'])
    expect(toViewModel(reply({ next_action: 'confirm_location' })).actions).toEqual([])
    expect(toViewModel(reply({ next_action: 'reply' })).actions).toEqual([])
    expect(toViewModel(reply({ next_action: 'none' })).actions).toEqual([])
  })

  it('cannot_answer: 추측하지 않았다는 표시(refused)를 켠다', () => {
    const v = toViewModel(reply({ status: 'cannot_answer', intent: 'usage_question', next_action: 'none' }))
    expect(v.refused).toBe(true)
  })

  it('out_of_scope: 목적지 목록 버튼을 탈출구로 붙인다', () => {
    const v = toViewModel(reply({ status: 'out_of_scope', intent: 'out_of_scope', next_action: 'none' }))
    expect(v.actions).toEqual(['pickDest'])
  })

  it('answered: unverified_notes는 문장을 바꾸지 않고 순서대로 옮긴다', () => {
    const notes = ['Which machines here accept credit cards is not confirmed yet.', '두 번째 미확인 문장']
    const v = toViewModel(reply({ status: 'answered', next_action: 'none', unverified_notes: notes }))
    expect(v.unverified).toEqual(notes)
    expect(v.refused).toBe(false)
  })

  it('selected_poi_id가 있는 추천 답변은 그 id를 칩에 남긴다', () => {
    const v = toViewModel(reply({ suggested_replies: [{ label: '직통열차 승강장', selected_poi_id: 'poi-express-platform' }, { label: '없어요' }] }))
    expect(v.chips).toEqual([
      { label: '직통열차 승강장', selectedPoiId: 'poi-express-platform' },
      { label: '없어요', selectedPoiId: null },
    ])
  })

  it('없어도 되는 필드(tip, destination, source_url)가 빠져 있으면 null로 채운다', () => {
    const { tip: _tip, destination: _destination, ...rest } = trainTypes
    const v = toViewModel({ ...rest, sources: [{ document_id: 'd', title: 't', verified_at: '2026-10-01' }] })
    expect(v.tip).toBeNull()
    expect(v.destinationPoiId).toBeNull()
    expect(v.sources[0].url).toBeNull()
  })
})

describe('toErrorView', () => {
  it('타임아웃과 네트워크 오류는 다시 시도와 목록 선택을 준다', () => {
    const timeout = toErrorView(new ApiError(0, 'TIMEOUT', 'timeout', null, { retryable: true }))
    expect(timeout).toMatchObject({ kind: 'error', reason: 'timeout', retryable: true, actions: ['retry', 'pickDest'] })
    const network = toErrorView(new ApiError(0, 'NETWORK', 'offline', null, { retryable: true }))
    expect(network).toMatchObject({ reason: 'network', actions: ['retry', 'pickDest'] })
  })

  it('세션 토큰 오류는 다시 시도 대신 처음부터 시작하게 한다', () => {
    const v = toErrorView(new ApiError(401, 'SESSION_EXPIRED', 'expired', 'req_1'))
    expect(v).toMatchObject({ reason: 'session', retryable: false, requestId: 'req_1', actions: ['restart'] })
  })

  it('서버가 retryable=false로 준 오류에는 다시 시도 버튼을 만들지 않는다', () => {
    const v = toErrorView(new ApiError(422, 'INVALID_INPUT', 'bad', 'req_2'))
    expect(v).toMatchObject({ reason: 'server', retryable: false, actions: ['pickDest'] })
  })

  it('서버가 retryable=true로 준 오류에는 다시 시도 버튼을 만든다', () => {
    const v = toErrorView(new ApiError(503, 'AI_SERVICE_UNAVAILABLE', 'down', null, { retryable: true }))
    expect(v).toMatchObject({ reason: 'server', actions: ['retry', 'pickDest'] })
  })

  it('ApiError가 아닌 예외는 다시 시도 없이 목록 선택만 준다', () => {
    expect(toErrorView(new Error('boom'))).toMatchObject({ reason: 'server', retryable: false, requestId: null, actions: ['pickDest'] })
  })
})
