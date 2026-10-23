/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 위치 확정 요청(confirmChosenLocation)이 선택 방식별로 서버 ConfirmationIn 본문을 맞게 만드는지 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createApiClient } from '../../api/client'
import type { FetchLike } from '../../api/client'
import { createHttpAdapter } from '../../api/httpAdapter'
import type { ConfirmationOut } from '../../api/types'
import { confirmChosenLocation, confirmationBody } from './confirm'
import type { LocationCandidate } from './locate'

const CANDIDATE: LocationCandidate = {
  node_id: 'line4-gates',
  floor_id: 'B1',
  rank_score: 0.75,
  heading_deg: 90,
  landmark_id: 'lm-line4-transfer',
  evidence: ['“4호선” 안내판'],
}

// 서버 ConfirmationOut 모양의 가짜 응답 (backend/app/api/location.py confirm_location)
const CONFIRMED: ConfirmationOut = {
  status: 'confirmed',
  location: { map_id: 'seoul-station', floor_id: '2F', node_id: 'ktx-hall', heading_deg: null, method: 'manual' },
  session: { state: 'ready_to_navigate', revision: 5 },
}

describe('confirmationBody', () => {
  it('사진 후보를 고르면 localization_id와 후보의 노드·방향을 보낸다', () => {
    expect(confirmationBody({ method: 'photo_candidate', localizationId: 'loc_1', candidate: CANDIDATE }, 4)).toEqual({
      expected_revision: 4,
      method: 'photo_candidate',
      localization_id: 'loc_1',
      selected_node_id: 'line4-gates',
      selected_heading_deg: 90,
    })
  })

  it('후보에 방향이 없으면 selected_heading_deg를 null로 보낸다', () => {
    const body = confirmationBody({ method: 'photo_candidate', localizationId: 'loc_1', candidate: { ...CANDIDATE, heading_deg: null } }, 4)
    expect(body.selected_heading_deg).toBeNull()
  })

  it('목록에서 직접 고르면 localization_id 없이 manual로 보낸다', () => {
    expect(confirmationBody({ method: 'manual', nodeId: 'ktx-hall' }, 3)).toEqual({
      expected_revision: 3,
      method: 'manual',
      selected_node_id: 'ktx-hall',
    })
  })
})

describe('confirmChosenLocation', () => {
  it('location-confirmations로 JSON 본문을 보내고 서버 session이 담긴 응답을 돌려준다', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(CONFIRMED), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const client = createApiClient({ baseUrl: '/api/v1', fetch, storage: null, newIdempotencyKey: () => 'key-1' })
    client.setSession({ sessionId: 'ses_1', token: 'tok_1' })

    const out = await confirmChosenLocation(createHttpAdapter(client), 'ses_1', { method: 'manual', nodeId: 'ktx-hall' }, 3)

    expect(calls[0].url).toBe('/api/v1/sessions/ses_1/location-confirmations')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ expected_revision: 3, method: 'manual', selected_node_id: 'ktx-hall' })
    expect(out.session).toEqual({ state: 'ready_to_navigate', revision: 5 })
  })
})
