/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 목적지 목록(GET /maps/{map_id}/pois)을 목적지 선택 화면과 도착 화면이 쓰는 모델로 바꾼다
 */
import type { PoisOut } from '../../api/types'
import { TRAIN_NAME } from '../../data'
import type { Lang, Text, TrainType } from '../../data'

export interface DestinationView {
  // 고르면 이 값을 그대로 selected_poi_id로 보낸다 (http: 서버 poi_id)
  poiId: string
  // 이 장소가 붙은 지도 노드 (서버 nearest_node_id). 지금 서 있는 곳과 같은지 볼 때 쓴다
  nodeId: string
  name: Text
  floor: string
  // 모르는 category면 null. 목록에 분류 id를 그대로 보이지 않게 한다
  category: Text | null
  train: TrainType | null
  // false면 "확인되지 않음"을 붙인다. 지금 서버는 확인된 장소만 돌려준다 (backend/app/domain/mapdata.py search_pois)
  verified: boolean
  // 표 사는 곳이면 도착 화면에서 표 사는 법을 이어서 묻게 한다
  tickets: boolean
  // 공항철도 승강장이면 도착 화면에서 전광판을 확인하게 한다. 열차별 타는 곳은 데이터에 없다
  platform: boolean
}

// 서버 category(oneload-data 지도의 POI category) → 화면 이름. 2026-10-26 운영 지도(2026-10-25.2)의 11종
const CATEGORY_TEXT: Record<string, Text> = {
  tickets: { en: 'Tickets', ko: '승차권' },
  platform: { en: 'Platform', ko: '승강장' },
  metro_tickets: { en: 'Subway tickets', ko: '지하철 승차권' },
  metro_platform: { en: 'Subway platform', ko: '지하철 승강장' },
  card_refund: { en: 'Card refund', ko: '교통카드 환급' },
  help: { en: 'Information', ko: '안내센터' },
  service: { en: 'Services', ko: '이용 시설' },
  transfer: { en: 'Transfer', ko: '갈아타는 곳' },
  train: { en: 'KTX · rail', ko: 'KTX·국철' },
  toilet: { en: 'Toilets', ko: '화장실' },
  exit: { en: 'Exit', ko: '출구' },
}

// 지도에 새 category가 생겨도 id(예: card_refund)를 화면에 보이지 않는다. 이름표가 없으면 분류를 생략한다
export const categoryText = (category: string): Text | null => CATEGORY_TEXT[category] ?? null

// 목록 이름 아래 작은 줄: "분류 · 열차". 둘 중 없는 것은 빼고 구분점도 남기지 않는다
export const destinationDetail = (d: Pick<DestinationView, 'category' | 'train'>, lang: Lang): string =>
  [d.category?.[lang], d.train && TRAIN_NAME[d.train][lang]].filter(Boolean).join(' · ')

export function destinationViews(out: PoisOut): DestinationView[] {
  return out.pois.map((p) => ({
    poiId: p.poi_id,
    nodeId: p.nearest_node_id,
    name: { en: p.name_en, ko: p.name_ko },
    floor: p.floor_id,
    category: categoryText(p.category),
    train: p.train_type ?? null,
    verified: p.verified,
    tickets: p.category === 'tickets',
    platform: p.category === 'platform',
  }))
}
