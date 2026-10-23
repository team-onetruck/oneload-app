/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 사진 리사이즈·압축 유틸(compressImage)이 서버 업로드 조건을 지키는지 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_EDGE, ImageTooLargeError, MAX_UPLOAD_BYTES, MIN_EDGE, compressImage, edgeSteps, fitWithin } from './compressImage'
import type { ImageDecoder, Size } from './compressImage'

// 브라우저 디코더 대신 쓰는 가짜. 인코딩할 때마다 크기와 품질을 기록하고, bytesFor가 정한 크기의 Blob을 돌려준다.
function fakeDecoder(width: number, height: number, bytesFor: (size: Size, quality: number) => number, type = 'image/jpeg') {
  const calls: Array<Size & { quality: number }> = []
  const state = { closed: false }
  const decode: ImageDecoder = async () => ({
    width,
    height,
    encode: async (size, quality) => {
      calls.push({ ...size, quality })
      return new Blob([new Uint8Array(bytesFor(size, quality))], { type })
    },
    close: () => {
      state.closed = true
    },
  })
  return { decode, calls, state }
}

const PHOTO = new Blob([new Uint8Array(8)], { type: 'image/heic' })

describe('fitWithin', () => {
  it('가로 사진은 긴 변을 기준으로 비율을 유지해 줄인다', () => {
    expect(fitWithin({ width: 4032, height: 3024 }, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('세로 사진도 긴 변(세로)을 기준으로 줄인다', () => {
    expect(fitWithin({ width: 3024, height: 4032 }, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('이미 작은 사진은 키우지 않는다', () => {
    expect(fitWithin({ width: 800, height: 600 }, 1600)).toEqual({ width: 800, height: 600 })
  })
})

describe('edgeSteps', () => {
  it('maxEdge부터 줄여 가며 MIN_EDGE 아래로는 내려가지 않는다', () => {
    const steps = edgeSteps(4032, DEFAULT_MAX_EDGE)
    expect(steps[0]).toBe(DEFAULT_MAX_EDGE)
    expect(steps.every((e, i) => i === 0 || e < steps[i - 1])).toBe(true)
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(MIN_EDGE)
  })

  it('원본이 MIN_EDGE보다 작으면 원본 크기 한 번만 시도한다', () => {
    expect(edgeSteps(300, DEFAULT_MAX_EDGE)).toEqual([300])
  })
})

describe('compressImage', () => {
  it('기본 제한은 서버 max_image_bytes(2MB)와 같다', () => {
    expect(MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024)
  })

  it('첫 시도(최대 크기, 가장 높은 품질)가 제한 안이면 그 결과를 바로 쓴다', async () => {
    const fake = fakeDecoder(4032, 3024, () => 500)
    const blob = await compressImage(PHOTO, { maxBytes: 1000 }, fake.decode)
    expect(blob.size).toBe(500)
    expect(blob.type).toBe('image/jpeg')
    expect(fake.calls).toEqual([{ width: 1600, height: 1200, quality: 0.85 }])
    expect(fake.state.closed).toBe(true)
  })

  it('제한을 넘으면 품질을 먼저 낮추고, 그래도 넘으면 크기를 줄인다', async () => {
    // 품질 0.55에서도 1600px는 제한을 넘고, 한 단계 줄인 1200px에서 처음으로 들어온다.
    const fake = fakeDecoder(4032, 3024, (size, quality) => (size.width >= 1600 ? 5000 : quality > 0.8 ? 1500 : 900))
    const blob = await compressImage(PHOTO, { maxBytes: 1000 }, fake.decode)
    expect(blob.size).toBe(900)
    expect(fake.calls.map((c) => [c.width, c.quality])).toEqual([
      [1600, 0.85],
      [1600, 0.75],
      [1600, 0.65],
      [1600, 0.55],
      [1200, 0.85],
      [1200, 0.75],
    ])
  })

  it('어떤 조합으로도 제한 안에 들지 않으면 ImageTooLargeError를 던지고 디코딩한 이미지를 해제한다', async () => {
    const fake = fakeDecoder(4032, 3024, () => 5000)
    await expect(compressImage(PHOTO, { maxBytes: 1000 }, fake.decode)).rejects.toBeInstanceOf(ImageTooLargeError)
    expect(fake.state.closed).toBe(true)
    expect(Math.min(...fake.calls.map((c) => Math.max(c.width, c.height)))).toBeGreaterThanOrEqual(MIN_EDGE)
  })

  it('브라우저가 JPEG 대신 다른 형식을 만들면 업로드하지 않고 오류를 낸다', async () => {
    const fake = fakeDecoder(1000, 800, () => 10, 'image/png')
    await expect(compressImage(PHOTO, { maxBytes: 1000 }, fake.decode)).rejects.toThrow('JPEG가 아닌 image/png')
    expect(fake.state.closed).toBe(true)
  })
})
