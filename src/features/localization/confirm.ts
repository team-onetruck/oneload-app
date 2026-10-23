/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 사용자가 고른 위치(사진 후보 또는 목록 직접 선택)를 서버 location-confirmations 요청으로 보낸다
 */
import type { ApiAdapter, ConfirmationIn, ConfirmationOut, MutationOptions } from '../../api/types'
import type { LocationCandidate } from './locate'

// 위치는 사용자가 누른 선택으로만 확정한다. 첫 번째 후보를 자동으로 고르는 경로는 두지 않는다.
export type LocationChoice =
  | { method: 'photo_candidate'; localizationId: string; candidate: LocationCandidate }
  | { method: 'manual'; nodeId: string }

export function confirmationBody(choice: LocationChoice, expectedRevision: number): ConfirmationIn {
  if (choice.method === 'photo_candidate') {
    return {
      expected_revision: expectedRevision,
      method: 'photo_candidate',
      localization_id: choice.localizationId,
      selected_node_id: choice.candidate.node_id,
      // 후보에 방향이 있으면 그 값을 보낸다 (ConfirmationIn.selected_heading_deg 설명)
      selected_heading_deg: choice.candidate.heading_deg ?? null,
    }
  }
  return { expected_revision: expectedRevision, method: 'manual', selected_node_id: choice.nodeId }
}

// 성공하면 서버가 ready_to_navigate로 바꾼 session을 돌려준다. 호출한 쪽은 그 session으로 상태를 갱신한다.
// 다시 시도할 때는 처음 요청의 키를 options로 넘긴다 (본문도 처음과 같은 expected_revision이어야 한다).
export function confirmChosenLocation(
  api: Pick<ApiAdapter, 'confirmLocation'>,
  sessionId: string,
  choice: LocationChoice,
  expectedRevision: number,
  options: MutationOptions = {},
): Promise<ConfirmationOut> {
  return api.confirmLocation(sessionId, confirmationBody(choice, expectedRevision), options)
}
