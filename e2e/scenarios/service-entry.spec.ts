/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 예전 데모 주소에서도 모드 표시 없이 HTTP 요청으로 시작하고 데모 도구가 나타나지 않는지 검증한다
 */
import { expect, test } from '@playwright/test'
import { interceptApi } from '../support/mockApi'

for (const lang of ['en', 'ko'] as const) {
  test.describe(lang, () => {
    test.use({ locale: lang })

    for (const url of ['/', '/?demo', '/?demo&mode=mock']) {
      test(`${url}: 데모 진입 없이 서버 세션으로 시작한다`, async ({ page }, testInfo) => {
        const api = await interceptApi(page)
        await page.goto(url)

        await expect(page.getByRole('heading', { name: '한길 Hangil' })).toBeVisible()
        await expect(page.getByText(/Demo|Live|데모|라이브|실서버|Dev controls|개발자 설정/)).toHaveCount(0)
        await expect(page.locator('.demo-pill')).toHaveCount(0)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        if (lang === 'ko' && url === '/?demo') await page.screenshot({ path: testInfo.outputPath('start-screen.png') })

        await page.getByRole('button', { name: lang === 'ko' ? '시작하기' : 'Start', exact: true }).click()
        await expect(page.getByRole('textbox')).toBeVisible()
        await expect.poll(() => api.mutations().filter((call) => call.path === '/sessions').length).toBe(1)
        expect(api.mutations()[0]).toMatchObject({ method: 'POST', path: '/sessions', status: 201, body: { language: lang } })

        await page.getByRole('button', { name: lang === 'ko' ? '인천공항' : 'Incheon Airport', exact: true }).click()
        await page.getByRole('button', { name: lang === 'ko' ? '직통열차' : 'Express', exact: true }).click()
        await page.getByRole('button', { name: lang === 'ko' ? '현재 위치 찾기' : 'Find where I am', exact: true }).click()
        await expect(page.getByRole('heading', { name: lang === 'ko' ? '주변 안내판을 찍어주세요' : 'Show me a nearby sign' })).toBeVisible()
        await expect(page.getByText(/demo photo|데모 사진/i)).toHaveCount(0)
        await expect(page.locator('input[type=file]')).toHaveCount(1)
      })
    }
  })
}
