/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 라이브 뷰 방향 계산(센서 값 → 방위, 믿을 수 있는지 판정, 화살표 각도와 방향 힌트) 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_SPREAD_DEG, MIN_SAMPLES, WINDOW_MS, assessHeading, circularMean, circularSpread, compassHeading, normalizeDegrees, turnDeg, turnHint, unwrapAngle,
} from './heading'
import type { HeadingSample } from './heading'

const near = (actual: number | null, expected: number) => {
  expect(actual).not.toBeNull()
  expect(actual!).toBeCloseTo(expected, 6)
}

describe('compassHeading', () => {
  it('폰을 세워 들고 북쪽을 보면 0°, 서쪽을 보면 270°, 동쪽을 보면 90°다', () => {
    near(compassHeading(0, 90, 0), 0)
    near(compassHeading(90, 90, 0), 270)
    near(compassHeading(270, 90, 0), 90)
  })

  it('폰을 수평으로 눕히면 뒷면이 땅을 향해 방위를 정할 수 없어 null이다', () => {
    expect(compassHeading(0, 0, 0)).toBeNull()
  })

  it('값이 하나라도 없으면 null이다', () => {
    expect(compassHeading(null, 90, 0)).toBeNull()
    expect(compassHeading(0, null, 0)).toBeNull()
    expect(compassHeading(0, 90, null)).toBeNull()
  })

  it('세워 들고 좌우로 조금 기울여도 보는 방위가 크게 바뀌지 않는다', () => {
    const level = compassHeading(30, 90, 0)!
    const tilted = compassHeading(30, 90, 10)!
    expect(Math.abs(turnDeg(tilted, level))).toBeLessThan(15)
  })
})

describe('각도 도우미', () => {
  it('normalizeDegrees는 [0, 360)으로 맞춘다', () => {
    expect(normalizeDegrees(-10)).toBe(350)
    expect(normalizeDegrees(370)).toBe(10)
    expect(normalizeDegrees(360)).toBe(0)
  })

  it('원형 평균은 0° 경계를 넘나드는 값을 바르게 합친다', () => {
    expect(Math.abs(turnDeg(circularMean([350, 10]), 0))).toBeLessThan(1e-6)
    near(circularMean([90, 90, 90]), 90)
  })

  it('원형 표준편차는 모여 있으면 작고 흩어지면 크다', () => {
    expect(circularSpread([359, 1, 0, 2, 358])).toBeLessThan(3)
    expect(circularSpread([0, 90, 180, 270])).toBeGreaterThan(90)
    expect(circularSpread([])).toBe(0)
  })

  it('turnDeg는 오른쪽이 양수이고 -180~180 안에서 짧은 쪽으로 돈다', () => {
    expect(turnDeg(90, 0)).toBe(90)
    expect(turnDeg(0, 90)).toBe(-90)
    expect(turnDeg(10, 350)).toBe(20)
    expect(turnDeg(350, 10)).toBe(-20)
    expect(turnDeg(180, 0)).toBe(180)
  })

  it('unwrapAngle은 화살표가 경계에서 한 바퀴 되돌아 돌지 않게 이어서 센다', () => {
    expect(unwrapAngle(170, -170)).toBe(190)
    expect(unwrapAngle(190, 175)).toBe(175)
    expect(unwrapAngle(0, 20)).toBe(20)
  })
})

describe('assessHeading', () => {
  // 오래된 것부터 시간순으로 쌓인 샘플
  const stream = (deg: number, count: number, now: number, accuracy: number | null = null): HeadingSample[] =>
    Array.from({ length: count }, (_, i) => ({ deg, accuracy, at: now - (count - 1 - i) * 50 }))

  it('샘플이 모자라면 아직 읽는 중이다', () => {
    const r = assessHeading(stream(90, MIN_SAMPLES - 1, 10_000), 10_000)
    expect(r).toMatchObject({ quality: 'waiting', deg: null, samples: MIN_SAMPLES - 1 })
  })

  it('오래된 샘플은 세지 않는다', () => {
    const old = stream(90, 20, 10_000 - WINDOW_MS - 500)
    expect(assessHeading(old, 10_000).quality).toBe('waiting')
  })

  it('한곳에 모인 샘플은 평균 방향을 믿는다', () => {
    const r = assessHeading(stream(120, 20, 10_000), 10_000)
    expect(r.quality).toBe('ok')
    near(r.deg, 120)
  })

  it('0° 경계를 넘나드는 샘플도 안정으로 본다', () => {
    const samples = [358, 1, 359, 2, 0, 357, 3].map((deg, i) => ({ deg, accuracy: null, at: 9_700 + i * 50 }))
    const r = assessHeading(samples, 10_000)
    expect(r.quality).toBe('ok')
    expect(Math.abs(turnDeg(r.deg!, 0))).toBeLessThan(3)
  })

  it('흔들림이 한계를 넘으면 믿지 않고 방향을 비운다', () => {
    const samples = [0, 90, 180, 270, 45, 135, 225, 315].map((deg, i) => ({ deg, accuracy: null, at: 9_650 + i * 50 }))
    const r = assessHeading(samples, 10_000)
    expect(r).toMatchObject({ quality: 'unstable', deg: null })
    expect(r.spreadDeg).toBeGreaterThan(MAX_SPREAD_DEG)
  })

  it('기기가 정확도를 나쁘다고(30° 초과) 하거나 무효(음수)라고 하면 믿지 않는다', () => {
    expect(assessHeading(stream(90, 10, 10_000, 45), 10_000).quality).toBe('unstable')
    expect(assessHeading(stream(90, 10, 10_000, -1), 10_000).quality).toBe('unstable')
    expect(assessHeading(stream(90, 10, 10_000, 12), 10_000).quality).toBe('ok')
  })
})

describe('turnHint', () => {
  it('정면, 오른쪽, 왼쪽, 뒤로 나눈다', () => {
    expect(turnHint(0)).toBe('ahead')
    expect(turnHint(-20)).toBe('ahead')
    expect(turnHint(60)).toBe('right')
    expect(turnHint(-100)).toBe('left')
    expect(turnHint(170)).toBe('behind')
    expect(turnHint(-180)).toBe('behind')
  })
})
