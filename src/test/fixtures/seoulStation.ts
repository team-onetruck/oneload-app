/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: MSW 핸들러가 쓰는 서울역 지도 픽스처. 백엔드 테스트 픽스처(backend/tests/fixtures/maps/seoul-station.json)를 생성 타입 모양으로 옮긴 것
 */
import type { GraphOut, MapsOut, PoisOut } from '../../api/types'

type PoiOut = PoisOut['pois'][number]

// 원본: backend/tests/fixtures/maps/seoul-station.json (version 2026-10-22.1).
// 층 정보(직통 표 B2, 일반 표 B3, 승강장 B7)만 확인된 값이고 나머지는 현장 답사 전 임시값이다.
// 백엔드 픽스처가 바뀌면 이 파일도 같이 고친다.

export const MAP_ID = 'seoul-station'
export const MAP_VERSION = '2026-10-22.1'

export const MAP_SUMMARY: MapsOut['maps'][number] = {
  map_id: MAP_ID,
  name: { en: 'Seoul Station · Airport Railroad', ko: '서울역 · 공항철도' },
  version: MAP_VERSION,
  floors: [
    { floor_id: '2F', elevation_m: 10 },
    { floor_id: 'B1', elevation_m: -6 },
    { floor_id: 'B2', elevation_m: -12 },
    { floor_id: 'B3', elevation_m: -18 },
    { floor_id: 'B7', elevation_m: -40 },
  ],
  ar_supported: false,
}

export const GRAPH: GraphOut = {
  map_id: MAP_ID,
  map_version: MAP_VERSION,
  coordinate_system: {
    frame: 'map',
    unit: 'm',
    handedness: 'left',
    x_axis: 'east',
    y_axis: 'up',
    z_axis: 'north',
    heading_zero: '+z',
    heading_positive: 'clockwise_from_above',
  },
  floors: MAP_SUMMARY.floors,
  nodes: [
    { id: 'ktx-hall', floor_id: '2F', position: { x: 0, y: 10, z: 120 }, name: { en: 'KTX hall (Seoul Station)', ko: '서울역 KTX 맞이방' } },
    { id: 'line1-gates', floor_id: 'B1', position: { x: -60, y: -6, z: 40 }, name: { en: 'Line 1 Seoul Station gates', ko: '1호선 서울역 개찰구' } },
    { id: 'line4-gates', floor_id: 'B1', position: { x: 60, y: -6, z: 30 }, name: { en: 'Line 4 Seoul Station gates', ko: '4호선 서울역 개찰구' } },
    { id: 'arex-concourse', floor_id: 'B2', position: { x: 0, y: -12, z: 0 }, name: { en: 'AREX Seoul Station concourse', ko: '공항철도 서울역 대합실' } },
    { id: 'express-tickets', floor_id: 'B2', position: { x: 30, y: -12, z: 0 }, name: { en: 'Express ticket counter', ko: '직통열차 표 사는 곳' } },
    { id: 'express-gates', floor_id: 'B2', position: { x: 55, y: -12, z: 0 }, name: { en: 'Express train gates', ko: '직통열차 개찰구' } },
    { id: 'allstop-tickets', floor_id: 'B3', position: { x: -30, y: -18, z: 0 }, name: { en: 'All-stop ticket machines', ko: '일반열차 표 사는 곳' } },
    { id: 'allstop-gates', floor_id: 'B3', position: { x: -45, y: -18, z: 0 }, name: { en: 'All-stop train gates', ko: '일반열차 개찰구' } },
    { id: 'express-platform', floor_id: 'B7', position: { x: 55, y: -40, z: -60 }, name: { en: 'Express train platform', ko: '직통열차 승강장' } },
    { id: 'allstop-platform', floor_id: 'B7', position: { x: -45, y: -40, z: -60 }, name: { en: 'All-stop train platform', ko: '일반열차 승강장' } },
  ],
  edges: [
    { from: 'ktx-hall', to: 'arex-concourse', type: 'escalator', distance_m: 120, heading_deg: 180, instruction: { en: 'Follow the blue “Airport Railroad” signs and take the escalators down to B2.', ko: '파란색 “공항철도” 표지를 따라 에스컬레이터로 B2까지 내려가세요.' } },
    { from: 'line1-gates', to: 'arex-concourse', type: 'escalator', distance_m: 90, heading_deg: 120, instruction: { en: 'Follow the “Airport Railroad” transfer signs, then go down to B2.', ko: '“공항철도” 환승 표지를 따라 B2로 내려가세요.' } },
    { from: 'line4-gates', to: 'arex-concourse', type: 'escalator', distance_m: 110, heading_deg: 240, instruction: { en: 'Follow the “Airport Railroad” transfer signs, then go down to B2.', ko: '“공항철도” 환승 표지를 따라 B2로 내려가세요.' } },
    { from: 'arex-concourse', to: 'express-tickets', type: 'corridor', distance_m: 30, heading_deg: 90, instruction: { en: 'Look for the “Express Train” ticket counter on this floor.', ko: '이 층에서 “직통열차” 표 사는 곳을 찾으세요.' } },
    { from: 'arex-concourse', to: 'allstop-tickets', type: 'escalator', distance_m: 40, heading_deg: 270, instruction: { en: 'Go down one more floor to B3 for all-stop tickets.', ko: '일반열차 표는 한 층 더 내려가 B3에서 사요.' } },
    { from: 'express-tickets', to: 'express-gates', type: 'gate', distance_m: 25, heading_deg: 90, instruction: { en: 'Go through the express train gates with your ticket.', ko: '승차권으로 직통열차 개찰구를 통과하세요.' } },
    { from: 'allstop-tickets', to: 'allstop-gates', type: 'gate', distance_m: 15, heading_deg: 270, instruction: { en: 'Tap your card at the all-stop train gates.', ko: '일반열차 개찰구에 교통카드를 찍으세요.' } },
    { from: 'express-gates', to: 'express-platform', type: 'escalator', distance_m: 60, heading_deg: 180, instruction: { en: 'Take the long escalators down to the platform on B7.', ko: '긴 에스컬레이터를 타고 B7 승강장으로 내려가세요.' } },
    { from: 'allstop-gates', to: 'allstop-platform', type: 'escalator', distance_m: 60, heading_deg: 180, instruction: { en: 'Take the long escalators down to the platform on B7.', ko: '긴 에스컬레이터를 타고 B7 승강장으로 내려가세요.' } },
  ],
  landmarks: [
    { landmark_id: 'lm-ktx-hall', node_id: 'ktx-hall', sign_texts: ['KTX', '맞이방', 'Departure Hall'] },
    { landmark_id: 'lm-line1-transfer', node_id: 'line1-gates', sign_texts: ['공항철도', 'Airport Railroad', '1호선', 'Line 1'] },
    { landmark_id: 'lm-line4-transfer', node_id: 'line4-gates', sign_texts: ['공항철도', 'Airport Railroad', '4호선', 'Line 4'] },
    { landmark_id: 'lm-arex-concourse', node_id: 'arex-concourse', sign_texts: ['직통열차', 'Express Train', '일반열차', 'All Stop Train'] },
  ],
  panoramas: [
    { pano_id: 'pano-ktx-hall', node_id: 'ktx-hall', image_url: '/panos/hamburg_hbf.webp', north_yaw_deg: 80, captured_at: null, is_example: true },
    { pano_id: 'pano-line1-gates', node_id: 'line1-gates', image_url: '/panos/subway_entrance.webp', north_yaw_deg: -200, captured_at: null, is_example: true },
    { pano_id: 'pano-line4-gates', node_id: 'line4-gates', image_url: '/panos/subway_entrance.webp', north_yaw_deg: -320, captured_at: null, is_example: true },
    { pano_id: 'pano-arex-concourse', node_id: 'arex-concourse', image_url: '/panos/metro_noord.webp', north_yaw_deg: 162, captured_at: null, is_example: true },
    { pano_id: 'pano-express-gates', node_id: 'express-gates', image_url: '/panos/metro_vijzelgracht.webp', north_yaw_deg: -156, captured_at: null, is_example: true },
    { pano_id: 'pano-allstop-gates', node_id: 'allstop-gates', image_url: '/panos/metro_vijzelgracht.webp', north_yaw_deg: -156, captured_at: null, is_example: true },
  ],
}

// GraphOut에는 POI가 없어서 GET /maps/{id}/pois 응답 모양(PoiOut)으로 둔다.
export const POIS: PoiOut[] = [
  { poi_id: 'poi-express-tickets', name_ko: '직통열차 표 사는 곳', name_en: 'Express ticket counter', category: 'tickets', train_type: 'express', floor_id: 'B2', nearest_node_id: 'express-tickets', aliases: ['express ticket', 'AREX express', '직통열차 표', '공항 직통'], verified: true },
  { poi_id: 'poi-allstop-tickets', name_ko: '일반열차 표 사는 곳', name_en: 'All-stop ticket machines', category: 'tickets', train_type: 'allstop', floor_id: 'B3', nearest_node_id: 'allstop-tickets', aliases: ['single journey ticket', 'transit card machine', '일반열차 표', '1회용 교통카드'], verified: true },
  { poi_id: 'poi-express-platform', name_ko: '직통열차 승강장', name_en: 'Express train platform', category: 'platform', train_type: 'express', floor_id: 'B7', nearest_node_id: 'express-platform', aliases: ['express platform', '직통 승강장'], verified: true },
  { poi_id: 'poi-allstop-platform', name_ko: '일반열차 승강장', name_en: 'All-stop train platform', category: 'platform', train_type: 'allstop', floor_id: 'B7', nearest_node_id: 'allstop-platform', aliases: ['all-stop platform', '일반 승강장'], verified: true },
]
