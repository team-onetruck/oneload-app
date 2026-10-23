/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: mock 모드 기준선 E2E. 직통열차 데모 흐름(칩 → 데모 사진 후보 → 경로·거리뷰 → 도착 → 표 사는 법 → 승강장)이 서버 없이 지금처럼 동작하는지 고정한다
 */
import { expect, test } from '@playwright/test'
import { startDemo, watchServerCalls } from './support'

test('mock 직통열차: 데모 사진 후보로 위치를 고르고 표 사는 곳을 거쳐 승강장까지 안내한다', async ({ page }) => {
  const serverCalls = watchServerCalls(page)
  await startDemo(page)

  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await expect(page.getByText('Two Airport Railroad (AREX) trains go to Incheon Airport.', { exact: false })).toBeVisible()
  await expect(page.getByText('Which one do you want?')).toBeVisible()
  await expect(page.getByText('AREX train types (demo doc)')).toBeVisible()

  await page.getByRole('button', { name: 'Express', exact: true }).click()
  await expect(page.getByText('I’ll take you to the Express ticket counter.', { exact: false })).toBeVisible()
  await expect(page.getByText('You can pay by card or cash at the counter.')).toBeVisible()

  await page.getByRole('button', { name: 'Find where I am' }).click()
  await page.getByRole('button', { name: 'Transfer sign' }).click()
  await expect(page.getByRole('heading', { name: 'Is this where you are?' })).toBeVisible()
  const line4 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /Line 4 Seoul Station gates/ }) })
  await expect(line4.getByText('“공항철도 Airport Railroad” transfer arrow')).toBeVisible()
  await line4.getByRole('button', { name: 'I’m here' }).click()

  await expect(page.getByRole('heading', { name: 'Express ticket counter' })).toBeVisible()
  await expect(page.getByText('Follow the “Airport Railroad” transfer signs, then go down to B2.')).toBeVisible()
  // CC0 예시 사진은 서울역 사진이 아니라는 표시가 늘 보여야 한다
  await page.getByRole('tab', { name: 'Street view' }).click()
  await expect(page.getByText(/^Example photo · .*not Seoul Station$/)).toBeVisible()
  await page.getByRole('tab', { name: 'Line' }).click()

  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'I’m here' }).click()
  await expect(page.getByRole('heading', { name: 'You’ve arrived' })).toBeVisible()
  await expect(page.getByText('Express ticket counter')).toBeVisible()

  await page.getByRole('button', { name: 'How do I buy a ticket?' }).click()
  await expect(page.getByText('To buy an Express ticket:')).toBeVisible()
  await expect(page.getByText('Exact button names and positions aren’t verified.', { exact: false })).toBeVisible()

  // 표 사는 곳에 도착했으므로 사진 없이 바로 승강장으로 갈 수 있다
  await page.getByRole('button', { name: 'Go to the platform' }).click()
  await expect(page.getByText('Got it: Express train platform.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Start directions' }).click()
  await expect(page.getByRole('heading', { name: 'Express train platform' })).toBeVisible()
  await expect(page.getByText('Go through the express train gates with your ticket.')).toBeVisible()

  expect(serverCalls).toEqual([])
})
