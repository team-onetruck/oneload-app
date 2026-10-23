/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: POST /sessions/{id}/messages 응답과 호출 오류를 채팅 말풍선용 모델로 바꾸는 순수 함수
 */
import { isApiError } from '../../api'
import type { MessageOut } from '../../api'
import { recoveryFor } from '../recovery/recovery'
import type { NoticeReason, RecoveryAction, RelocateReason } from '../recovery/recovery'

export type ReplyStatus = MessageOut['status']

// 말풍선 아래 버튼. findMe·retake·pickLocation·startRoute는 next_action에서, retry·pickDest·restart는 탈출구 규칙에서 온다.
export type ChatAction = 'findMe' | 'retake' | 'pickLocation' | 'startRoute' | 'retry' | 'pickDest' | 'restart'

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

// 오류 말풍선의 문구 종류. recoveryFor 결과를 그대로 따른다 (session: 세션 종료, resync: 409 INVALID_STATE)
export type ErrorReason = NoticeReason | RelocateReason | 'session' | 'resync'

export interface ErrorView {
  kind: 'error'
  reason: ErrorReason
  retryable: boolean
  requestId: string | null
  actions: ChatAction[]
}

export type ChatView = ReplyView | ErrorView

// next_action → 버튼. 화면을 저절로 넘기지 않고, 답을 읽은 뒤 사용자가 누르게 한다. reply·none은 다음 입력을 기다린다.
const NEXT_ACTION: Record<MessageOut['next_action'], ChatAction[]> = {
  locate: ['findMe'],
  recapture: ['retake'],
  navigate: ['startRoute'],
  confirm_location: ['pickLocation'],
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

// 탈출구 규칙은 features/recovery의 recoveryFor 하나로 정한다. 채팅에서 "직접 선택"은 목적지 목록이다.
const CHAT_ACTION: Record<RecoveryAction, ChatAction> = { retry: 'retry', manual: 'pickDest', home: 'restart' }

// 채팅에서는 다시 보내기와 목적지 목록을 모두 쓸 수 있다.
const CHAT_AVAILABLE = { retry: true, manual: true }

export function toErrorView(error: unknown): ErrorView {
  const recovery = recoveryFor(error, CHAT_AVAILABLE)
  const base = { kind: 'error' as const, retryable: isApiError(error) && error.retryable, requestId: isApiError(error) ? error.requestId : null }
  switch (recovery.type) {
    // 세션을 더 쓸 수 없다. 다시 보내지 않고 처음부터 시작하게 한다.
    case 'sessionEnded':
      return { ...base, reason: 'session', actions: ['restart'] }
    case 'notice':
      return { ...base, reason: recovery.reason, actions: recovery.actions.map((a) => CHAT_ACTION[a]) }
    // 409 INVALID_STATE: 다시 보내지 않는다. store가 navigation-state를 다시 읽어 맞는 화면으로 보낸다.
    case 'resync':
      return { ...base, reason: 'resync', actions: recovery.actions.map((a) => CHAT_ACTION[a]) }
    // 위치를 다시 확인해야 한다. /messages는 이 코드를 내지 않지만, 오면 위치 찾기로 보낸다.
    case 'relocate':
      return { ...base, reason: recovery.reason, actions: ['findMe'] }
  }
}
