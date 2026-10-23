/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: mock 모드 기준선 E2E의 공통 도우미. 서버로 나가는 요청이 없는지 지켜보고, 데모 패널을 연다
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// mock 모드는 서버 없이 돈다. /api로 나가는 요청을 모아 두었다가 테스트 끝에 비어 있는지 본다
export function watchServerCalls(page: Page) {
  const calls: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.pathname.startsWith('/api/')) calls.push(`${req.method()} ${url.pathname}`)
  })
  return calls
}

// 휴대폰 화면에서는 ?demo가 있어야 데모 탭이 보인다 (README의 Demo controls)
export async function startDemo(page: Page) {
  await page.goto('/?demo')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Welcome to Seoul Station. I’m Hangil.', { exact: false })).toBeVisible()
}

export async function openDemoPanel(page: Page) {
  await page.getByRole('button', { name: 'Demo', exact: true }).click()
  return page.getByRole('dialog', { name: 'Demo controls' })
}

// 안내판 사진 대신 올릴 실제 JPEG. 업로드 결과는 데모 패널의 스위치가 정한다
export async function uploadPhoto(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const g = canvas.getContext('2d')!
    g.fillStyle = '#64748b'
    g.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  })
  const file = { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }
  await page.locator('label', { hasText: 'Take a photo' }).locator('input[type=file]').setInputFiles(file)
}
