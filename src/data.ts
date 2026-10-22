// PROTOTYPE data for the Seoul Station scenario.
// Floors of AREX ticket points and platforms follow the AREX official guide
// (airportrailroad.com, checked 2026-10-22). Passages, distances and sign
// wording are placeholders until the team's field survey.
// Shapes mirror the backend contracts (nodes/edges/POIs, KnowledgeHit,
// LocationEstimate) so screens can move to /api/v1 without reshaping props.

export type Lang = 'en' | 'ko'
export type Text = Record<Lang, string>
export type Floor = '2F' | 'B1' | 'B2' | 'B3' | 'B7'

export type NodeId =
  | 'ktxHall'
  | 'l1gate'
  | 'l4gate'
  | 'concourse'
  | 'expressDesk'
  | 'machines'
  | 'expressGate'
  | 'allstopGate'
  | 'expressPlatform'
  | 'allstopPlatform'

export interface MapNode {
  id: NodeId
  floor: Floor
  name: Text
}

export type EdgeKind = 'walk' | 'escalator_down' | 'gate'

export interface Edge {
  from: NodeId
  to: NodeId
  kind: EdgeKind
  meters: number
  /** Map bearing of the leg, 0 = north, clockwise (v0.3 heading convention). Placeholder until survey. */
  heading: number
  text: Text
}

export const NODES: Record<NodeId, MapNode> = {
  ktxHall: { id: 'ktxHall', floor: '2F', name: { en: 'KTX hall (Seoul Station)', ko: '서울역 KTX 맞이방' } },
  l1gate: { id: 'l1gate', floor: 'B1', name: { en: 'Line 1 Seoul Station gates', ko: '1호선 서울역 개찰구' } },
  l4gate: { id: 'l4gate', floor: 'B1', name: { en: 'Line 4 Seoul Station gates', ko: '4호선 서울역 개찰구' } },
  concourse: { id: 'concourse', floor: 'B2', name: { en: 'AREX Seoul Station concourse', ko: '공항철도 서울역 대합실' } },
  expressDesk: { id: 'expressDesk', floor: 'B2', name: { en: 'Express ticket counter', ko: '직통열차 표 사는 곳' } },
  machines: { id: 'machines', floor: 'B3', name: { en: 'All-stop ticket machines', ko: '일반열차 표 사는 곳' } },
  expressGate: { id: 'expressGate', floor: 'B2', name: { en: 'Express train gates', ko: '직통열차 개찰구' } },
  allstopGate: { id: 'allstopGate', floor: 'B3', name: { en: 'All-stop train gates', ko: '일반열차 개찰구' } },
  expressPlatform: { id: 'expressPlatform', floor: 'B7', name: { en: 'Express train platform', ko: '직통열차 승강장' } },
  allstopPlatform: { id: 'allstopPlatform', floor: 'B7', name: { en: 'All-stop train platform', ko: '일반열차 승강장' } },
}

export const EDGES: Edge[] = [
  { from: 'ktxHall', to: 'concourse', kind: 'escalator_down', meters: 120, heading: 0, text: { en: 'Follow the blue “Airport Railroad” signs and take the escalators down to B2.', ko: '파란색 “공항철도” 표지를 따라 에스컬레이터로 B2까지 내려가세요.' } },
  { from: 'l1gate', to: 'concourse', kind: 'escalator_down', meters: 90, heading: 0, text: { en: 'Follow the “Airport Railroad” transfer signs, then go down to B2.', ko: '“공항철도” 환승 표지를 따라 B2로 내려가세요.' } },
  { from: 'l4gate', to: 'concourse', kind: 'escalator_down', meters: 110, heading: 0, text: { en: 'Follow the “Airport Railroad” transfer signs, then go down to B2.', ko: '“공항철도” 환승 표지를 따라 B2로 내려가세요.' } },
  { from: 'concourse', to: 'expressDesk', kind: 'walk', meters: 30, heading: 90, text: { en: 'Look for the “Express Train” ticket counter on this floor.', ko: '이 층에서 “직통열차” 표 사는 곳을 찾으세요.' } },
  { from: 'concourse', to: 'machines', kind: 'escalator_down', meters: 40, heading: 270, text: { en: 'Go down one more floor to B3 for all-stop tickets.', ko: '일반열차 표는 한 층 더 내려가 B3에서 사요.' } },
  { from: 'expressDesk', to: 'expressGate', kind: 'gate', meters: 25, heading: 90, text: { en: 'Go through the express train gates with your ticket.', ko: '승차권으로 직통열차 개찰구를 통과하세요.' } },
  { from: 'machines', to: 'allstopGate', kind: 'gate', meters: 15, heading: 270, text: { en: 'Tap your card at the all-stop train gates.', ko: '일반열차 개찰구에 교통카드를 찍으세요.' } },
  { from: 'expressGate', to: 'expressPlatform', kind: 'escalator_down', meters: 60, heading: 180, text: { en: 'Take the long escalators down to the platform on B7.', ko: '긴 에스컬레이터를 타고 B7 승강장으로 내려가세요.' } },
  { from: 'allstopGate', to: 'allstopPlatform', kind: 'escalator_down', meters: 60, heading: 180, text: { en: 'Take the long escalators down to the platform on B7.', ko: '긴 에스컬레이터를 타고 B7 승강장으로 내려가세요.' } },
]

// Street-view panoramas per node. Real ones come from the field shoot; until
// then these are CC0 sample photos of other stations (Poly Haven), labelled
// as examples on screen. northYaw = where map north sits in the photo, so the
// arrow for any leg is northYaw + leg heading; no per-route arrow data is stored.
export interface Pano {
  src: string
  northYaw: number
  example: Text
}

const EXAMPLE = (place: string): Text => ({ en: `Example photo · ${place}, not Seoul Station`, ko: `예시 사진 · ${place}, 서울역 아님` })

export const PANOS: Partial<Record<NodeId, Pano>> = {
  ktxHall: { src: '/panos/hamburg_hbf.jpg', northYaw: -100, example: EXAMPLE('Hamburg Hbf') },
  l1gate: { src: '/panos/subway_entrance.jpg', northYaw: -80, example: EXAMPLE('subway passage') },
  l4gate: { src: '/panos/subway_entrance.jpg', northYaw: -80, example: EXAMPLE('subway passage') },
  concourse: { src: '/panos/metro_noord.jpg', northYaw: 162, example: EXAMPLE('Amsterdam Noord') },
  expressGate: { src: '/panos/metro_vijzelgracht.jpg', northYaw: -156, example: EXAMPLE('Amsterdam Vijzelgracht') },
  allstopGate: { src: '/panos/metro_vijzelgracht.jpg', northYaw: -156, example: EXAMPLE('Amsterdam Vijzelgracht') },
}

export type PoiId = 'expressDesk' | 'machines' | 'expressPlatform' | 'allstopPlatform'

export type TrainType = 'express' | 'allstop'

export interface Poi {
  id: PoiId
  node: NodeId
  train: TrainType
  category: Text
}

export const POIS: Poi[] = [
  { id: 'expressDesk', node: 'expressDesk', train: 'express', category: { en: 'Tickets', ko: '승차권' } },
  { id: 'machines', node: 'machines', train: 'allstop', category: { en: 'Tickets', ko: '승차권' } },
  { id: 'expressPlatform', node: 'expressPlatform', train: 'express', category: { en: 'Platform', ko: '승강장' } },
  { id: 'allstopPlatform', node: 'allstopPlatform', train: 'allstop', category: { en: 'Platform', ko: '승강장' } },
]

export const TRAIN_NAME: Record<TrainType, Text> = {
  express: { en: 'Express', ko: '직통열차' },
  allstop: { en: 'All-stop', ko: '일반열차' },
}

export interface Source {
  id: string
  title: Text
  verifiedAt: string
  url?: string
}

export const SOURCES = {
  arexFloors: {
    id: 'arex-official-seoul-floors',
    title: { en: 'AREX official guide: Seoul Station', ko: 'AREX 공식 안내: 서울역' },
    verifiedAt: '2026-10-22',
    url: 'https://www.airportrailroad.com/co/steUsfGud.do',
  },
  trainTypes: { id: 'doc-arex-train-types', title: { en: 'AREX train types (demo doc)', ko: '공항철도 열차 종류 (데모 문서)' }, verifiedAt: '2026-10-15' },
  expressTicket: { id: 'doc-express-ticket', title: { en: 'Buying an express ticket (demo doc)', ko: '직통열차 승차권 구매 (데모 문서)' }, verifiedAt: '2026-10-15' },
  allstopTicket: { id: 'doc-allstop-ticket', title: { en: 'Riding the all-stop train (demo doc)', ko: '일반열차 이용 (데모 문서)' }, verifiedAt: '2026-10-15' },
  deposit: { id: 'doc-deposit-refund', title: { en: 'Single-journey card refund (demo doc)', ko: '1회용 교통카드 보증금 환급 (데모 문서)' }, verifiedAt: '2026-10-12' },
} satisfies Record<string, Source>

export interface Candidate {
  node: NodeId
  evidence: Text[]
}

export type PhotoScenario = 'arexSign' | 'ktxSign' | 'blurry'

// What the vision step would return per demo photo. An uploaded photo uses
// whichever scenario the demo panel selects, since nothing is analysed for real.
export const SCENARIOS: Record<PhotoScenario, Candidate[]> = {
  arexSign: [
    { node: 'l4gate', evidence: [{ en: '“공항철도 Airport Railroad” transfer arrow', ko: '“공항철도 Airport Railroad” 환승 화살표' }, { en: 'Line 4 colour badge on the same sign', ko: '같은 안내판의 4호선 색 표시' }] },
    { node: 'l1gate', evidence: [{ en: 'Similar transfer sign layout', ko: '비슷한 환승 안내판 배치' }] },
  ],
  ktxSign: [
    { node: 'ktxHall', evidence: [{ en: '“KTX 맞이방” departure hall sign', ko: '“KTX 맞이방” 안내판' }, { en: 'Train departure board in view', ko: '열차 출발 안내 전광판이 보임' }] },
  ],
  blurry: [],
}

// Where each destination's floor fact comes from, shown when the destination is set.
export const FLOOR_FACT: Record<PoiId, Text> = {
  expressDesk: { en: 'Express tickets are sold on B2.', ko: '직통열차 표는 B2에서 사요.' },
  machines: { en: 'All-stop tickets are sold on B3.', ko: '일반열차 표는 B3에서 사요.' },
  expressPlatform: { en: 'AREX trains leave from B7.', ko: '공항철도 열차는 B7에서 타요.' },
  allstopPlatform: { en: 'AREX trains leave from B7.', ko: '공항철도 열차는 B7에서 타요.' },
}
