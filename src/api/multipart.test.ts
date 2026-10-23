/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 직접 만든 multipart 본문이 fetch의 FormData 직렬화와 경계값만 다르고, 같은 키면 같은 경계값이 나오는지 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { boundaryFor, encodeMultipart } from './multipart'

const jpeg = (...bytes: number[]) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, ...bytes])], { type: 'image/jpeg' })

const cases: Array<[string, (form: FormData) => void]> = [
  [
    '한국어 메시지와 사진',
    (f) => {
      f.append('message', '뭘 눌러요?')
      f.append('image', jpeg(0, 13, 10))
    },
  ],
  [
    '줄바꿈이 섞인 값과 빈 값',
    (f) => {
      f.append('message', 'a\nb\rc\r\nd')
      f.append('floor_hint', '')
    },
  ],
  ['type이 없는 Blob', (f) => f.append('image', new Blob([new Uint8Array([1, 2, 3])]))],
  ['이름에 따옴표·줄바꿈이 있는 File', (f) => f.append('image', new File([new Uint8Array([9])], 'my "photo"\n.jpg', { type: 'image/jpeg' }))],
  ['따옴표·줄바꿈이 있는 필드 이름', (f) => f.append('we"ird\nname', 'v')],
]

describe('encodeMultipart', () => {
  it.each(cases)('fetch의 FormData 직렬화와 경계값만 다르고 바이트가 같다: %s', async (_label, fill) => {
    const form = new FormData()
    fill(form)
    const platform = new Response(form)
    const boundary = (platform.headers.get('Content-Type') ?? '').split('boundary=')[1]

    const { body, contentType } = encodeMultipart(form, boundary)
    expect(contentType).toBe(`multipart/form-data; boundary=${boundary}`)
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(new Uint8Array(await platform.arrayBuffer()))
  })

  it('서버처럼 다시 파싱하면 필드와 사진(filename=blob)이 그대로다', async () => {
    const form = new FormData()
    form.append('map_version', 'v1')
    form.append('image', jpeg(1, 2))
    const { body, contentType } = encodeMultipart(form, boundaryFor('key-1'))

    const parsed = await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
    expect(parsed.get('map_version')).toBe('v1')
    const image = parsed.get('image') as File
    expect(image.name).toBe('blob')
    expect(image.type).toBe('image/jpeg')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1, 2]))
  })
})

describe('boundaryFor', () => {
  it('같은 키는 같은 경계값, 다른 키는 다른 경계값이다', () => {
    const key = crypto.randomUUID()
    expect(boundaryFor(key)).toBe(`oneload-${key}`)
    expect(boundaryFor(key)).toBe(boundaryFor(key))
    expect(boundaryFor(crypto.randomUUID())).not.toBe(boundaryFor(key))
  })

  it('영숫자와 하이픈 밖의 문자는 지우고 70자를 넘기지 않는다', () => {
    expect(boundaryFor(`a b"c;d:e/f=g?h(i)j,k_l.m+n'o-p`)).toBe('oneload-abcdefghijklmno-p')
    expect(boundaryFor('한글 키')).toBe('oneload-')
    expect(boundaryFor('x'.repeat(64))).toHaveLength(70)
    for (const key of ['a b"c', '한글 키', 'x'.repeat(64), crypto.randomUUID()]) expect(boundaryFor(key)).toMatch(/^[0-9A-Za-z-]{1,70}$/)
  })
})
