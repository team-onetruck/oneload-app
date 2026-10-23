/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: mock 모드 기준선 E2E. 요금 질문 거절, 데모 패널의 AI 시간 초과·업로드 결과 스위치, KTX 데모 사진이 서버 없이 지금처럼 동작하는지 고정한다
 */
import { expect, test } from '@playwright/test'
import { openDemoPanel, startDemo, uploadPhoto, watchServerCalls } from './support'

const ask = async (page: import('@playwright/test').Page, text: string) => {
  await page.getByRole('textbox').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('mock 요금 질문: 확인된 요금이 없으면 추측하지 않고 확인되지 않음으로 표시한다', async ({ page }) => {
  const serverCalls = watchServerCalls(page)
  await startDemo(page)

  await ask(page, 'How much is the fare?')
  await expect(page.getByText('I don’t have a verified fare, so I won’t guess.', { exact: false })).toBeVisible()
  await expect(page.getByText('Not verified')).toBeVisible()
  expect(serverCalls).toEqual([])
})

test('mock 시간 초과 스위치: 다음 답이 실패하고 다시 시도하면 답한다', async ({ page }) => {
  const serverCalls = watchServerCalls(page)
  await startDemo(page)

  const panel = await openDemoPanel(page)
  await panel.getByRole('checkbox', { name: 'Next AI request times out' }).check()
  await panel.getByRole('button', { name: 'Close' }).click()

  await ask(page, 'How do I pay?')
  await page.getByRole('button', { name: 'Try again' }).first().click()
  await expect(page.getByText('It depends on the train:')).toBeVisible()
  expect(serverCalls).toEqual([])
})

test('mock 사진 결과: 업로드 결과 스위치가 흐린 사진이면 위치를 못 찾고, KTX 데모 사진은 KTX 맞이방 후보를 보여 준다', async ({ page }) => {
  const serverCalls = watchServerCalls(page)
  await startDemo(page)
  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await page.getByRole('button', { name: 'Express', exact: true }).click()
  await page.getByRole('button', { name: 'Find where I am' }).click()

  const panel = await openDemoPanel(page)
  await panel.getByRole('button', { name: 'Blurry photo' }).click()
  await panel.getByRole('button', { name: 'Close' }).click()
  await uploadPhoto(page)
  await expect(page.getByRole('heading', { name: 'I can’t tell where this is' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose on list' })).toBeVisible()

  await page.getByRole('button', { name: 'Retake photo' }).click()
  await page.getByRole('button', { name: 'KTX hall sign' }).click()
  await expect(page.getByRole('heading', { name: 'Is this where you are?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /KTX hall \(Seoul Station\)/ })).toBeVisible()
  await expect(page.getByText('“KTX 맞이방” departure hall sign')).toBeVisible()
  expect(serverCalls).toEqual([])
})
