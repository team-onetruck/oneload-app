/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 세션 언어를 PATCH /sessions/{id}로 바꾸고, 409 REVISION_CONFLICT면 navigation-state로 맞춰 한 번만 다시 보낸다
 */
import type { ApiAdapter, MutationOptions, NavigationStateOut, PatchSessionOut } from '../../api'
import { withRevisionResync } from '../../api/revision'
import type { Lang } from '../../data'

export interface LanguageChange {
  api: Pick<ApiAdapter, 'patchSession' | 'getNavigationState'>
  sessionId: string
  language: Lang
  // 직전 서버 응답의 session.revision
  revision: number
  // 409 뒤 다시 읽은 서버 상태. store가 session을 서버 값으로 맞출 때 쓴다
  onResync?: (state: NavigationStateOut) => void
}

export function patchLanguage({ api, sessionId, language, revision, onResync }: LanguageChange, options: MutationOptions = {}): Promise<PatchSessionOut> {
  return withRevisionResync((expected) => api.patchSession(sessionId, { expected_revision: expected, language }, options), {
    revision,
    resync: () => api.getNavigationState(sessionId),
    onResync,
  })
}
