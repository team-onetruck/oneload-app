/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 사진 위치 인식을 서버에 요청하고 응답을 화면이 쓰는 결과(후보 / 재촬영 / 직접 선택)로 바꾼다
 */
import { isAiServiceUnavailable } from '../../api/errors'
import type { ApiAdapter, LocalizationOut, MutationOptions, SessionStatus } from '../../api/types'
import { compressImage } from './compressImage'

export type LocationCandidate = LocalizationOut['candidates'][number]

export interface LocateRequest {
  sessionId: string
  // 앱이 가진 지도 버전. 서버와 다르면 409 MAP_VERSION_MISMATCH
  mapVersion: string
  // 마지막으로 확정했던 노드. 서버가 그 이웃 노드에 가산점을 준다 (backend/app/domain/localization.py)
  lastNodeId?: string | null
}

export type LocateResult =
  // 후보와 근거(evidence)를 보여 주고 사용자가 고르게 한다. 위치는 아직 확정되지 않았다.
  | { kind: 'candidates'; localizationId: string; candidates: LocationCandidate[]; session: SessionStatus }
  // 후보 없음. 서버가 준 재촬영 안내(retake_hint)를 그대로 보여 준다.
  | { kind: 'no_match'; retakeHint: string | null; session: SessionStatus }
  // 사진 인식을 쓸 수 없음(503 AI_SERVICE_UNAVAILABLE). 후보 없이 직접 선택으로 넘긴다.
  // 서버는 이때 세션을 바꾸지 않으므로(advance 전에 오류) 반영할 session이 없다.
  | { kind: 'manual'; reason: 'ai_unavailable' }

// 후보 순서는 서버가 정한 그대로 쓴다. rank_score는 순서용이라 화면에 확률처럼 보여 주지 않는다.
export function toLocateResult(out: LocalizationOut): LocateResult {
  if (out.status === 'needs_confirmation') {
    return { kind: 'candidates', localizationId: out.localization_id, candidates: out.candidates, session: out.session }
  }
  return { kind: 'no_match', retakeHint: out.retake_hint, session: out.session }
}

// 이미 압축한 JPEG로 위치 후보를 요청한다. 다시 시도할 때는 처음 요청의 키를 options로 넘긴다.
export async function requestLocalization(
  api: Pick<ApiAdapter, 'postLocalization'>,
  req: LocateRequest,
  image: Blob,
  options: MutationOptions = {},
): Promise<LocateResult> {
  let out: LocalizationOut
  try {
    out = await api.postLocalization(
      req.sessionId,
      { image, map_version: req.mapVersion, last_node_id: req.lastNodeId ?? null },
      options,
    )
  } catch (error) {
    // retryable이어도 다시 보내지 않는다. 위치를 추측하지 않고 사용자가 목록에서 고르게 한다.
    if (isAiServiceUnavailable(error)) return { kind: 'manual', reason: 'ai_unavailable' }
    throw error
  }
  return toLocateResult(out)
}

export async function locateFromPhoto(
  api: Pick<ApiAdapter, 'postLocalization'>,
  req: LocateRequest,
  photo: Blob,
  compress: (photo: Blob) => Promise<Blob> = compressImage,
): Promise<LocateResult> {
  return requestLocalization(api, req, await compress(photo))
}
