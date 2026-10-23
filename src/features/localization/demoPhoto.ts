/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 데모 사진 버튼(파일 없음)도 실제 사진과 같은 압축·업로드 경로를 타도록 canvas로 작은 JPEG를 만든다
 */
import type { PhotoScenario } from '../../data'

// 데모 안내판 모양을 대충 그린다. 결과(후보 / 못 찾음)는 사진 내용이 아니라 mock 어댑터의 사진 결과 스위치가 정한다
const DRAW: Record<PhotoScenario, { background: string; lines: string[] }> = {
  arexSign: { background: '#0067b3', lines: ['공항철도 →', 'Airport Railroad', '4'] },
  ktxSign: { background: '#1f2937', lines: ['KTX 맞이방', 'Departure Hall'] },
  blurry: { background: '#94a3b8', lines: [] },
}

export function demoPhotoFile(scenario: PhotoScenario): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const g = canvas.getContext('2d')
  if (!g) return Promise.reject(new Error('canvas 2d를 쓸 수 없습니다'))
  const { background, lines } = DRAW[scenario]
  g.fillStyle = background
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#ffffff'
  g.font = 'bold 48px sans-serif'
  lines.forEach((line, i) => g.fillText(line, 40, 160 + i * 80))
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('데모 사진을 만들지 못했습니다'))), 'image/jpeg', 0.85),
  )
}
