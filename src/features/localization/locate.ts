/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 사진 위치 인식을 서버에 요청하고 응답을 화면이 쓰는 결과(후보 / 재촬영)로 바꾼다
 */
import type { ApiAdapter, LocalizationOut, SessionStatus } from '../../api/types'
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

// 후보 순서는 서버가 정한 그대로 쓴다. rank_score는 순서용이라 화면에 확률처럼 보여 주지 않는다.
export function toLocateResult(out: LocalizationOut): LocateResult {
  if (out.status === 'needs_confirmation') {
    return { kind: 'candidates', localizationId: out.localization_id, candidates: out.candidates, session: out.session }
  }
  return { kind: 'no_match', retakeHint: out.retake_hint, session: out.session }
}

export async function locateFromPhoto(
  api: Pick<ApiAdapter, 'postLocalization'>,
  req: LocateRequest,
  photo: Blob,
  compress: (photo: Blob) => Promise<Blob> = compressImage,
): Promise<LocateResult> {
  const image = await compress(photo)
  const out = await api.postLocalization(req.sessionId, {
    image,
    map_version: req.mapVersion,
    last_node_id: req.lastNodeId ?? null,
  })
  return toLocateResult(out)
}
