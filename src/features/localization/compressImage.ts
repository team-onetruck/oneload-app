/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 위치 인식용 사진을 서버 업로드 조건(JPEG, 2MB 이하) 안으로 줄이는 리사이즈·JPEG 압축 유틸
 */

// 서버 조건 (backend/app/api/deps.py read_jpeg, app/config.py max_image_bytes)
// - 2 * 1024 * 1024 바이트를 넘으면 413 IMAGE_TOO_LARGE
// - JPEG 시그니처(FF D8 FF)로 시작하지 않으면 415 UNSUPPORTED_IMAGE
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

// 아래 값은 서버가 정하지 않은 클라이언트 쪽 기준이다. 비전 모델 입력 크기가 정해지면 맞춘다.
export const DEFAULT_MAX_EDGE = 1600
export const MIN_EDGE = 480
const EDGE_STEP = 0.75
const QUALITIES = [0.85, 0.75, 0.65, 0.55]

export interface Size {
  width: number
  height: number
}

export interface DecodedImage extends Size {
  /** 지정한 크기와 품질로 JPEG를 만든다. */
  encode: (size: Size, quality: number) => Promise<Blob>
  close: () => void
}

export type ImageDecoder = (file: Blob) => Promise<DecodedImage>

export interface CompressOptions {
  maxBytes?: number
  maxEdge?: number
}

export class ImageTooLargeError extends Error {
  readonly maxBytes: number

  constructor(maxBytes: number) {
    super(`사진을 ${maxBytes}바이트 이하로 줄이지 못했습니다`)
    this.name = 'ImageTooLargeError'
    this.maxBytes = maxBytes
  }
}

/** 비율을 유지한 채 긴 변이 maxEdge를 넘지 않게 줄인다. 원본보다 키우지 않는다. */
export function fitWithin(size: Size, maxEdge: number): Size {
  const longest = Math.max(size.width, size.height)
  if (longest <= maxEdge) return size
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

/** 시도할 긴 변 길이 목록. maxEdge(원본이 더 작으면 원본)부터 EDGE_STEP 비율로 MIN_EDGE까지 줄인다. */
export function edgeSteps(longest: number, maxEdge: number): number[] {
  const steps = [Math.min(longest, maxEdge)]
  for (let edge = Math.round(steps[0] * EDGE_STEP); edge >= MIN_EDGE; edge = Math.round(edge * EDGE_STEP)) steps.push(edge)
  return steps
}

// 원본이 이미 작은 JPEG여도 항상 다시 인코딩한다. 위치 정보(GPS) 같은 EXIF 메타데이터가 함께 지워진다.
export async function compressImage(file: Blob, options: CompressOptions = {}, decode: ImageDecoder = decodeInBrowser): Promise<Blob> {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES
  const image = await decode(file)
  try {
    for (const edge of edgeSteps(Math.max(image.width, image.height), options.maxEdge ?? DEFAULT_MAX_EDGE)) {
      const size = fitWithin(image, edge)
      for (const quality of QUALITIES) {
        const blob = await image.encode(size, quality)
        // 브라우저는 JPEG 인코딩을 못 하면 PNG로 대신 만든다. 서버가 415로 거절하므로 여기서 막는다.
        if (blob.type !== 'image/jpeg') throw new Error(`JPEG가 아닌 ${blob.type || '알 수 없는 형식'}으로 인코딩됐습니다`)
        if (blob.size <= maxBytes) return blob
      }
    }
  } finally {
    image.close()
  }
  throw new ImageTooLargeError(maxBytes)
}

export const decodeInBrowser: ImageDecoder = async (file) => {
  // EXIF 회전을 픽셀에 반영해 세로로 찍은 사진이 눕지 않게 한다.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  return {
    width: bitmap.width,
    height: bitmap.height,
    encode: (size, quality) =>
      new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas 2D를 쓸 수 없습니다'))
        ctx.drawImage(bitmap, 0, 0, size.width, size.height)
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('JPEG 인코딩에 실패했습니다'))), 'image/jpeg', quality)
      }),
    close: () => bitmap.close(),
  }
}
