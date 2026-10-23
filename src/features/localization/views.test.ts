/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 후보·직접 선택 화면 모델이 서버 순서와 그래프 이름을 지키고, 모르는 노드 이름을 지어내지 않는지 검증한다
 */
import { describe, expect, it } from 'vitest'
import { GRAPH } from '../../test/fixtures/seoulStation'
import type { LocationCandidate } from './locate'
import { candidateViews, manualPlaces } from './views'

const CANDIDATES: LocationCandidate[] = [
  { node_id: 'line4-gates', floor_id: 'B1', rank_score: 0.8, heading_deg: null, landmark_id: 'lm-line4-transfer', evidence: ['Sign reads “4호선”'] },
  { node_id: 'line1-gates', floor_id: 'B1', rank_score: 0.5, heading_deg: null, landmark_id: 'lm-line1-transfer', evidence: ['Sign reads “공항철도”'] },
]

describe('candidateViews', () => {
  it('서버 순서 그대로 그래프 이름·층·근거를 붙이고 rank_score는 넣지 않는다', () => {
    const views = candidateViews(CANDIDATES, GRAPH)
    expect(views).toEqual([
      { nodeId: 'line4-gates', floor: 'B1', name: { en: 'Line 4 Seoul Station gates', ko: '4호선 서울역 개찰구' }, evidence: ['Sign reads “4호선”'] },
      { nodeId: 'line1-gates', floor: 'B1', name: { en: 'Line 1 Seoul Station gates', ko: '1호선 서울역 개찰구' }, evidence: ['Sign reads “공항철도”'] },
    ])
    expect(JSON.stringify(views)).not.toContain('rank')
  })

  it('그래프를 아직 받지 못했거나 그래프에 없는 노드면 이름을 지어내지 않고 null로 둔다', () => {
    expect(candidateViews(CANDIDATES, null).map((v) => v.name)).toEqual([null, null])
    const unknown = candidateViews([{ ...CANDIDATES[0], node_id: 'node-unknown' }], GRAPH)
    expect(unknown[0]).toMatchObject({ nodeId: 'node-unknown', name: null, floor: 'B1' })
  })
})

describe('manualPlaces', () => {
  it('그래프 노드 전체를 서버 순서 그대로 보여 준다', () => {
    expect(manualPlaces(GRAPH).map((p) => p.nodeId)).toEqual(GRAPH.nodes.map((n) => n.id))
  })
})
