/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: MSW 가짜 백엔드로 사진 업로드(multipart)를 같은 Idempotency-Key로 다시 보낼 때 서버가 저장된 응답을 재생하는지, 다른 사진이면 422로 막는지 검증한다
 */
import { describe, expect, it } from 'vitest'
import { MAP_ID, MAP_VERSION } from '../test/fixtures/seoulStation'
import { mockBackend } from '../test/handlers'
import { createApiClient } from './client'
import { createHttpAdapter } from './httpAdapter'
import type { ApiAdapter } from './types'

const BASE = 'http://api.test/api/v1'
// 앞 3바이트만 JPEG이면 서버가 받는다. fill이 다르면 다른 사진이다
const jpeg = (fill: number) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, fill, fill, fill, fill])], { type: 'image/jpeg' })

// 목적지까지 정해 두어 사진 위치 인식이 허용되는 needs_location 상태로 만든다
async function start() {
  const api = createHttpAdapter(createApiClient({ baseUrl: BASE, storage: null }))
  const created = await api.createSession({ language: 'en', map_id: MAP_ID, client: { platform: 'web', app_version: 'test', ar_capable: false } })
  await api.sendMessage(created.session_id, { message: 'Express' })
  return { api, sessionId: created.session_id }
}

type Upload = (api: ApiAdapter, sessionId: string, image: Blob, idempotencyKey: string) => Promise<unknown>

const uploads: Array<{ endpoint: 'localizations' | 'messages'; upload: Upload }> = [
  {
    endpoint: 'localizations',
    upload: (api, sessionId, image, idempotencyKey) =>
      api.postLocalization(sessionId, { image, map_version: MAP_VERSION }, { idempotencyKey }),
  },
  {
    endpoint: 'messages',
    upload: (api, sessionId, image, idempotencyKey) =>
      api.sendMessage(sessionId, { message: 'What should I press?', image }, { idempotencyKey }),
  },
]

describe.each(uploads)('$endpoint 사진 업로드를 같은 Idempotency-Key로 다시 보내기', ({ endpoint, upload }) => {
  it('같은 사진이면 저장된 200을 그대로 받고, 핸들러는 한 번만 처리한다', async () => {
    const { api, sessionId } = await start()
    const before = mockBackend.handled(endpoint)
    const photo = jpeg(1)

    const first = await upload(api, sessionId, photo, 'retry-key-1')
    const revision = mockBackend.session(sessionId)!.revision
    const again = await upload(api, sessionId, photo, 'retry-key-1')

    expect(again).toEqual(first)
    expect(mockBackend.handled(endpoint) - before).toBe(1)
    expect(mockBackend.session(sessionId)!.revision).toBe(revision)
  })

  it('다른 사진이면 422 IDEMPOTENCY_KEY_REUSED로 막고, 핸들러는 다시 처리하지 않는다', async () => {
    const { api, sessionId } = await start()
    const before = mockBackend.handled(endpoint)

    await upload(api, sessionId, jpeg(1), 'retry-key-1')
    const revision = mockBackend.session(sessionId)!.revision
    const error = await upload(api, sessionId, jpeg(2), 'retry-key-1').catch((e: unknown) => e)

    expect(error).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED', idempotencyKey: 'retry-key-1' })
    expect(mockBackend.handled(endpoint) - before).toBe(1)
    expect(mockBackend.session(sessionId)!.revision).toBe(revision)
  })
})
