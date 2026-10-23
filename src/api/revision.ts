/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 409 REVISION_CONFLICT가 오면 navigation-state로 최신 revision을 읽고 한 번만 다시 보내는 래퍼
 */
import { isRevisionConflict } from './errors'

// navigation-state 응답(NavigationStateOut)에서 재시도에 필요한 부분만 요구한다.
export interface RevisionSnapshot {
  session: { revision: number }
}

export interface RevisionResyncOptions<S extends RevisionSnapshot> {
  // 직전 서버 응답의 session.revision
  revision: number
  // GET /sessions/{id}/navigation-state
  resync: () => Promise<S>
  // 다시 읽은 서버 상태. 재시도 전에 session.state·revision을 서버 값으로 맞출 때 쓴다
  onResync?: (state: S) => void
}

// expected_revision을 쓰는 요청(PATCH /sessions/{id}, /location-confirmations, /routes)을 감싼다 (backend/app/api/deps.py check_revision).
// 409 중 REVISION_CONFLICT만 다시 맞추고, MAP_VERSION_MISMATCH·INVALID_STATE 같은 다른 409와 두 번째 실패는 그대로 던진다.
// send는 매번 새 본문을 만들므로, 첫 시도와 재시도는 서로 다른 요청(다른 Idempotency-Key)이 된다.
export async function withRevisionResync<T, S extends RevisionSnapshot>(
  send: (expectedRevision: number) => Promise<T>,
  { revision, resync, onResync }: RevisionResyncOptions<S>,
): Promise<T> {
  try {
    return await send(revision)
  } catch (error) {
    if (!isRevisionConflict(error)) throw error
  }
  const state = await resync()
  onResync?.(state)
  return send(state.session.revision)
}
