/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 앱이 빌드·실행되어 시작 화면이 뜨는지만 확인하는 E2E 스모크 테스트
 */
import { expect, test } from '@playwright/test'

test('시작 화면이 뜨고 페이지 오류가 없다', async ({ page }) => {
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))

  await page.goto('/')

  await expect(page.getByRole('heading', { name: '한길 Hangil' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()
  expect(errors).toEqual([])
})
