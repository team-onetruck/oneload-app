/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: http 모드 E2E에서 /api/v1 요청을 page.route로 가로채 MSW 핸들러(src/test/handlers.ts)로 답하고, 보낸 요청을 기록한다
 */
import type { Page } from '@playwright/test'
import { getResponse } from 'msw'
import { handlers, mockBackend } from '../../src/test/handlers'

export interface ApiCall {
  method: string
  // /api/v1 뒤 경로. 세션 id는 {id}로 바꿔 둔다
  path: string
  status: number
  // JSON 본문 또는 multipart 필드. 사진 같은 파일은 { type, size }로 줄여 둔다
  body: Record<string, unknown> | null
  response: unknown
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get('Content-Type') ?? ''
  if (type.startsWith('application/json')) return (await request.json()) as Record<string, unknown>
  if (!type.startsWith('multipart/form-data')) return null
  const fields: Record<string, unknown> = {}
  for (const [key, value] of (await request.formData()).entries())
    fields[key] = typeof value === 'string' ? value : { type: value.type, size: value.size }
  return fields
}

// 서버(백엔드) 대신 MSW 핸들러가 답한다. 브라우저 Service Worker 없이 테스트 프로세스에서 응답을 만든다.
// 핸들러 상태와 스위치(mockBackend)는 테스트 프로세스에 있으므로 테스트마다 처음 상태로 시작한다.
export async function interceptApi(page: Page) {
  mockBackend.reset()
  const calls: ApiCall[] = []

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const method = req.method()
    const raw = method === 'GET' || method === 'HEAD' ? null : req.postDataBuffer()
    const request = new Request(req.url(), { method, headers: await req.allHeaders(), body: raw ? new Uint8Array(raw) : undefined })
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '').replace(/ses_[0-9a-f]+/, '{id}')
    const body = await readBody(request.clone())

    const res = await getResponse(handlers, request)
    // 핸들러가 없는 요청은 실제 서버로 보내지 않고 501로 실패시킨다. 테스트는 calls에서 이 값을 찾아 실패로 본다
    const status = res?.status ?? 501
    const text = res ? await res.text() : JSON.stringify({ error: { code: 'NOT_MOCKED', message: `${method} ${path}` } })
    await route.fulfill({ status, headers: res ? Object.fromEntries(res.headers) : { 'Content-Type': 'application/json' }, body: text })
    calls.push({ method, path, status, body, response: JSON.parse(text) })
  })

  return {
    calls,
    backend: mockBackend,
    // 서버 상태를 바꾸는 요청만 (지도 GET 같은 조회는 화면 사정에 따라 횟수가 달라서 뺀다)
    mutations: () => calls.filter((c) => c.method !== 'GET'),
    // 보낸 길안내 이벤트를 처음 보낸 순서대로. 실패해 다시 보낸 이벤트는 event_id로 한 번만 센다
    eventTypes: () => {
      const seen = new Map<string, string>()
      for (const c of calls.filter((c) => c.path.endsWith('/navigation-events')))
        for (const e of (c.body?.events ?? []) as Array<{ event_id: string; type: string }>) if (!seen.has(e.event_id)) seen.set(e.event_id, e.type)
      return [...seen.values()]
    },
  }
}

export type InterceptedApi = Awaited<ReturnType<typeof interceptApi>>

// 사진 찍기 대신 넣을 안내판 사진. 앱이 브라우저에서 실제로 디코딩·압축하므로 진짜 JPEG가 필요해서 페이지의 canvas로 만든다
export async function signPhoto(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const g = canvas.getContext('2d')!
    g.fillStyle = '#1d4ed8'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.fillStyle = '#ffffff'
    g.font = 'bold 40px sans-serif'
    g.fillText('공항철도 Airport Railroad', 32, 220)
    g.fillText('4호선 Line 4', 32, 280)
    return canvas.toDataURL('image/jpeg', 0.85)
  })
  return { name: 'sign.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }
}
