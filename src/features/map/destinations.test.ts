/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 목적지 목록 응답(GET /maps/{map_id}/pois)을 화면 모델로 바꾸는 destinationViews와 지도별 캐시를 검증한다
 */
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../../api/client'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { PoisOut } from '../../api/types'
import { MAP_ID, MAP_VERSION, POIS } from '../../test/fixtures/seoulStation'
import { mockBackend } from '../../test/handlers'
import { messageBody, replyEffects } from '../chat/replyEffects'
import { sendChat } from '../chat/sendChat'
import type { ChatHooks } from '../chat/sendChat'
import { categoryText, destinationViews } from './destinations'
import { createMapCache } from './graphCache'

describe('destinationViews', () => {
  it('서버 POI의 노드, 이름(ko·en), 층, 열차, 확인 여부를 그대로 옮기고 표 사는 곳을 표시한다', async () => {
    // MSW가 백엔드처럼 확인된 POI만 돌려준다
    const api = createHttpAdapter(createApiClient({ baseUrl: 'http://api.test/api/v1', storage: null }))
    const views = destinationViews(await api.searchPois(MAP_ID))
    expect(views.map((v) => v.poiId)).toEqual(POIS.map((p) => p.poi_id))
    expect(views[0]).toEqual({
      poiId: 'poi-express-tickets',
      nodeId: 'express-tickets',
      name: { en: 'Express ticket counter', ko: '직통열차 표 사는 곳' },
      floor: 'B2',
      category: { en: 'Tickets', ko: '승차권' },
      train: 'express',
      verified: true,
      tickets: true,
    })
    expect(views.filter((v) => v.tickets).map((v) => v.poiId)).toEqual(['poi-express-tickets', 'poi-allstop-tickets'])
  })

  it('확인되지 않은 POI와 열차가 없는 POI도 그대로 옮긴다', () => {
    const out: PoisOut = {
      map_id: MAP_ID,
      map_version: MAP_VERSION,
      pois: [{ ...POIS[0], poi_id: 'poi-lockers', category: 'lockers', train_type: null, verified: false }],
    }
    expect(destinationViews(out)[0]).toMatchObject({ poiId: 'poi-lockers', train: null, verified: false, tickets: false, category: { en: 'lockers', ko: 'lockers' } })
  })

  it('모르는 category는 id를 그대로 보여 준다', () => {
    expect(categoryText('platform')).toEqual({ en: 'Platform', ko: '승강장' })
    expect(categoryText('exit')).toEqual({ en: 'exit', ko: 'exit' })
  })
})

describe('createMapCache', () => {
  it('목적지 목록도 지도마다 한 번만 받는다', async () => {
    const load = vi.fn(async (mapId: string) => ({ map_id: mapId, map_version: MAP_VERSION, pois: [] }) satisfies PoisOut)
    const cache = createMapCache(load)
    await Promise.all([cache.get(MAP_ID), cache.get(MAP_ID)])
    expect(load).toHaveBeenCalledTimes(1)
    await cache.get('other-map')
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('목적지 목록에서 고르기 (MSW)', () => {
  it('목록을 받고 고른 POI를 selected_poi_id 그대로 /messages에 보내면 서버가 목적지로 정한다', async () => {
    const bodies: unknown[] = []
    const client = createApiClient({
      baseUrl: 'http://api.test/api/v1',
      storage: null,
      fetch: (url, init) => {
        if (url.endsWith('/messages')) bodies.push(JSON.parse(String(init.body)))
        return globalThis.fetch(url, init)
      },
    })
    const api = createHttpAdapter(client)
    const created = await api.createSession({ language: 'ko', map_id: MAP_ID, client: { platform: 'web', app_version: 'test', ar_capable: false } })
    const list = destinationViews(await createMapCache((mapId) => api.searchPois(mapId)).get(created.map_id))
    const picked = list.find((d) => d.poiId === 'poi-allstop-platform')!

    const replies: Parameters<ChatHooks['onReply']>[0][] = []
    const hooks: ChatHooks = { fail: vi.fn(), onReply: (r) => replies.push(r), onError: vi.fn(), onRetry: vi.fn(), onResync: vi.fn(), manual: vi.fn() }
    await sendChat({ api, sessionId: created.session_id, body: messageBody(picked.name.ko, picked.poiId), hooks })

    expect(bodies).toEqual([{ message: '일반열차 승강장', selected_poi_id: 'poi-allstop-platform' }])
    const effects = replyEffects(replies[0])
    expect(effects.view.status).toBe('destination_set')
    expect(effects.destination).toBe('poi-allstop-platform')
    expect(effects.train).toBe('allstop')
    expect(mockBackend.session(created.session_id)?.destinationPoiId).toBe('poi-allstop-platform')
  })
})
