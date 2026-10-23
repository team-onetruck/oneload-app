/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: mock 모드 기준선 E2E. 일반열차 + 교통카드 없음 → 발매기 목적지 → 목록에서 위치 직접 선택 → 경로 → 도착이 서버 없이 지금처럼 동작하는지 고정한다
 */
import { expect, test } from '@playwright/test'
import { startDemo, watchServerCalls } from './support'

test('mock 일반열차 + 카드 없음: 목록에서 고른 위치에서 발매기까지 안내한다', async ({ page }) => {
  const serverCalls = watchServerCalls(page)
  await startDemo(page)

  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await page.getByRole('button', { name: 'All-stop', exact: true }).click()
  await expect(page.getByText('Do you have one, like T-money?', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: /^I don.t have one$/ }).click()
  await expect(page.getByText('I’ll take you to the All-stop ticket machines.', { exact: false })).toBeVisible()
  await expect(page.getByText('At the machine, choose Single journey.', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Find where I am' }).click()
  await page.getByRole('button', { name: 'I know where I am, choose on list' }).click()
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  await page.getByRole('button', { name: /KTX hall \(Seoul Station\)/ }).click()

  await expect(page.getByRole('heading', { name: 'All-stop ticket machines' })).toBeVisible()
  await expect(page.getByText('Follow the blue “Airport Railroad” signs and take the escalators down to B2.')).toBeVisible()
  await expect(page.getByText('Go down one more floor to B3 for all-stop tickets.')).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'I’m here' }).click()

  await expect(page.getByRole('heading', { name: 'You’ve arrived' })).toBeVisible()
  await expect(page.getByText('All-stop ticket machines')).toBeVisible()
  await expect(page.getByRole('button', { name: 'How do I buy a ticket?' })).toBeVisible()

  expect(serverCalls).toEqual([])
})
