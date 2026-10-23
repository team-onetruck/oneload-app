/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 POI id ↔ 데모 PoiId 다리가 같은 장소끼리 이어졌는지 이름으로 검사한다
 */
import { describe, expect, it } from 'vitest'
import { NODES, POIS as LOCAL_POIS } from '../../data'
import { POIS as SERVER_POIS } from '../../test/fixtures/seoulStation'
import { localPoiOf, serverPoiOf } from './poiBridge'

describe('poiBridge', () => {
  it('서버 POI마다 이름(en·ko)이 같은 데모 목적지로 이어진다', () => {
    for (const poi of SERVER_POIS) {
      const local = localPoiOf(poi.poi_id)
      expect(local, poi.poi_id).not.toBeNull()
      const node = NODES[LOCAL_POIS.find((p) => p.id === local)!.node]
      expect(node.name).toEqual({ en: poi.name_en, ko: poi.name_ko })
    }
  })

  it('데모 목적지에서 서버 id로 되돌아가면 처음 id가 나온다', () => {
    for (const poi of SERVER_POIS) expect(serverPoiOf(localPoiOf(poi.poi_id)!)).toBe(poi.poi_id)
    for (const local of LOCAL_POIS) expect(localPoiOf(serverPoiOf(local.id))).toBe(local.id)
  })

  it('모르는 서버 id는 다른 목적지로 짐작하지 않고 null을 돌려준다', () => {
    expect(localPoiOf('poi-unknown')).toBeNull()
  })
})
