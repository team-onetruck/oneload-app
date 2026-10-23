/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 목적지 목록(GET /maps/{map_id}/pois)을 목적지 선택 화면과 도착 화면이 쓰는 모델로 바꾼다
 */
import type { PoisOut } from '../../api/types'
import { NODES, POIS } from '../../data'
import type { Text, TrainType } from '../../data'

export interface DestinationView {
  // 고르면 이 값을 그대로 selected_poi_id로 보낸다 (http: 서버 poi_id)
  poiId: string
  name: Text
  floor: string
  category: Text
  train: TrainType | null
  // false면 "확인되지 않음"을 붙인다. 지금 서버는 확인된 장소만 돌려준다 (backend/app/domain/mapdata.py search_pois)
  verified: boolean
  // 표 사는 곳이면 도착 화면에서 표 사는 법을 이어서 묻게 한다
  tickets: boolean
}

// 서버 category(backend 지도 데이터의 POI category) → 화면 이름. 모르는 값은 id를 그대로 보여 준다
const CATEGORY_TEXT: Record<string, Text> = {
  tickets: { en: 'Tickets', ko: '승차권' },
  platform: { en: 'Platform', ko: '승강장' },
}

export const categoryText = (category: string): Text => CATEGORY_TEXT[category] ?? { en: category, ko: category }

export function destinationViews(out: PoisOut): DestinationView[] {
  return out.pois.map((p) => ({
    poiId: p.poi_id,
    name: { en: p.name_en, ko: p.name_ko },
    floor: p.floor_id,
    category: categoryText(p.category),
    train: p.train_type ?? null,
    verified: p.verified,
    tickets: p.category === 'tickets',
  }))
}

// mock 모드: data.ts의 데모 목적지. poiId는 data.ts PoiId다
export function mockDestinationViews(): DestinationView[] {
  return POIS.map((p) => ({
    poiId: p.id,
    name: NODES[p.node].name,
    floor: NODES[p.node].floor,
    category: categoryText(p.category),
    train: p.train,
    verified: true,
    tickets: p.category === 'tickets',
  }))
}
