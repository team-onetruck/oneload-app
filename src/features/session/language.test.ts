/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: MSW 가짜 백엔드로 언어 전환 PATCH와 409 REVISION_CONFLICT 재동기화(한 번만 재시도)를 검증한다
 */
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../../api/client'
import { createHttpAdapter } from '../../api/httpAdapter'
import { MAP_ID } from '../../test/fixtures/seoulStation'
import { mockBackend } from '../../test/handlers'
import { patchLanguage } from './language'

const BASE = 'http://api.test/api/v1'

// /sessions/{id}로 나간 PATCH 본문을 기록한다
async function start() {
  const patches: { expected_revision: number; language: string }[] = []
  const client = createApiClient({
    baseUrl: BASE,
    storage: null,
    fetch: (url, init) => {
      if (init.method === 'PATCH') patches.push(JSON.parse(String(init.body)))
      return globalThis.fetch(url, init)
    },
  })
  const api = createHttpAdapter(client)
  const created = await api.createSession({ language: 'en', map_id: MAP_ID, client: { platform: 'web', app_version: 'test', ar_capable: false } })
  return { api, sessionId: created.session_id, revision: created.session.revision, patches }
}

describe('patchLanguage', () => {
  it('직전 revision으로 PATCH하고, 응답의 language와 session을 돌려준다', async () => {
    const { api, sessionId, revision, patches } = await start()
    const out = await patchLanguage({ api, sessionId, language: 'ko', revision })
    expect(patches).toEqual([{ expected_revision: 1, language: 'ko' }])
    expect(out.language).toBe('ko')
    expect(out.session.revision).toBe(2)
    expect(mockBackend.session(sessionId)?.language).toBe('ko')
  })

  it('409 REVISION_CONFLICT면 navigation-state를 다시 읽어 반영하고, 새 revision으로 한 번만 다시 보낸다', async () => {
    const { api, sessionId, revision, patches } = await start()
    mockBackend.conflictNext(1)
    const onResync = vi.fn()
    const out = await patchLanguage({ api, sessionId, language: 'ko', revision, onResync })

    expect(onResync).toHaveBeenCalledTimes(1)
    const synced = onResync.mock.calls[0][0].session.revision
    expect(synced).toBeGreaterThan(revision)
    expect(patches).toEqual([
      { expected_revision: revision, language: 'ko' },
      { expected_revision: synced, language: 'ko' },
    ])
    expect(out.language).toBe('ko')
    expect(out.session.revision).toBe(synced + 1)
  })

  it('다시 보낸 요청도 409면 더 보내지 않고 오류를 던진다', async () => {
    const { api, sessionId, revision, patches } = await start()
    mockBackend.conflictNext(2)
    await expect(patchLanguage({ api, sessionId, language: 'ko', revision })).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' })
    expect(patches).toHaveLength(2)
    expect(mockBackend.session(sessionId)?.language).toBe('en')
  })
})
