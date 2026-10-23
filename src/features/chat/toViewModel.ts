/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: POST /sessions/{id}/messages 응답과 호출 오류를 채팅 말풍선용 모델로 바꾸는 순수 함수
 */
import { isApiError } from '../../api'
import type { MessageOut } from '../../api'

export type ReplyStatus = MessageOut['status']

// 말풍선 아래 버튼. retry·pickDest·restart는 서버 값이 아니라 화면이 붙이는 탈출구다.
export type ChatAction = 'findMe' | 'startRoute' | 'retry' | 'pickDest' | 'restart'

export interface ChatSource {
  id: string
  title: string
  url: string | null
  verifiedAt: string
}

// 칩을 누르면 label을 사용자 문장으로, selectedPoiId가 있으면 selected_poi_id로 다시 보낸다.
export interface ChatChip {
  label: string
  selectedPoiId: string | null
}

export interface ReplyView {
  kind: 'reply'
  status: ReplyStatus
  body: string
  // 번호 목록으로 보여 준다 (AgentResponse.items)
  items: string[]
  tip: string | null
  // 화면에 "Not verified"로 구분해 보여 준다. 문장은 고치지 않는다.
  unverified: string[]
  // cannot_answer: 확인된 답이 없어서 추측하지 않았다는 표시를 붙인다.
  refused: boolean
  sources: ChatSource[]
  chips: ChatChip[]
  actions: ChatAction[]
  destinationPoiId: string | null
}

export type ErrorReason = 'timeout' | 'network' | 'session' | 'server'

export interface ErrorView {
  kind: 'error'
  reason: ErrorReason
  retryable: boolean
  requestId: string | null
  actions: ChatAction[]
}

export type ChatView = ReplyView | ErrorView

// next_action → 버튼. reply·none은 버튼 없이 다음 입력을 기다린다.
// confirm_location은 확인할 위치 후보(localization)가 있어야 해서 이 화면에서는 버튼을 만들지 않는다.
const NEXT_ACTION: Record<MessageOut['next_action'], ChatAction[]> = {
  locate: ['findMe'],
  recapture: ['findMe'],
  navigate: ['startRoute'],
  confirm_location: [],
  reply: [],
  none: [],
}

export function toViewModel(res: MessageOut): ReplyView {
  const actions = [...NEXT_ACTION[res.next_action]]
  // 범위 밖 질문에는 목적지 목록을 탈출구로 붙인다 (mock의 outOfScope와 같은 동작).
  if (res.status === 'out_of_scope') actions.push('pickDest')
  return {
    kind: 'reply',
    status: res.status,
    body: res.assistant_message,
    items: res.items ?? [],
    tip: res.tip || null,
    unverified: res.unverified_notes ?? [],
    refused: res.status === 'cannot_answer',
    sources: (res.sources ?? []).map((s) => ({
      id: s.document_id,
      title: s.title,
      url: s.source_url || null,
      verifiedAt: s.verified_at,
    })),
    chips: (res.suggested_replies ?? []).map((r) => ({ label: r.label, selectedPoiId: r.selected_poi_id || null })),
    actions,
    destinationPoiId: res.destination?.poi_id ?? null,
  }
}

// 세션 토큰 문제는 다시 보내도 같은 결과라서 처음부터 시작하게 한다.
const SESSION_CODES = new Set(['SESSION_UNAUTHORIZED', 'SESSION_EXPIRED', 'SESSION_FORBIDDEN'])

export function toErrorView(error: unknown): ErrorView {
  if (!isApiError(error)) return { kind: 'error', reason: 'server', retryable: false, requestId: null, actions: ['pickDest'] }
  const reason: ErrorReason =
    error.code === 'TIMEOUT' ? 'timeout' : error.code === 'NETWORK' ? 'network' : SESSION_CODES.has(error.code) ? 'session' : 'server'
  const actions: ChatAction[] = reason === 'session' ? ['restart'] : error.retryable ? ['retry', 'pickDest'] : ['pickDest']
  return { kind: 'error', reason, retryable: error.retryable, requestId: error.requestId, actions }
}
