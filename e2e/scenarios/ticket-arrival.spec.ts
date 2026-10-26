/**
 * Date: 2026-10-26
 * Author: Jung Minkyu
 * Purpose: 표 사는 곳 도착 뒤 시나리오 E2E. 서버가 지금 서 있는 표 사는 곳을 다시 목적지로 정해도 길안내를 권하지 않고,
 *          '표를 샀어요 · 승강장으로'를 누르면 승강장 경로를 받는지 확인한다
 */
import { expect, test } from '@playwright/test'
import { interceptApi, signPhoto } from '../support/mockApi'

test('표 사는 곳 도착: 같은 곳으로 다시 안내하지 않고, 표를 샀다고 알리면 승강장으로 간다', async ({ page }) => {
  const api = await interceptApi(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await page.getByRole('button', { name: 'Express', exact: true }).click()
  await page.getByRole('button', { name: 'Find where I am' }).click()
  await page.locator('label', { hasText: 'Take a photo' }).locator('input[type=file]').setInputFiles(await signPhoto(page))
  const line4 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /Line 4 Seoul Station gates/ }) })
  await line4.getByRole('button', { name: 'I’m here' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'I’m here' }).click()
  await expect(page.getByRole('heading', { name: 'You’ve arrived' })).toBeVisible()

  // 표 사는 곳에서는 표를 샀다고 알리는 버튼이 먼저, 사는 법 묻기가 다음이다
  const arrivedButtons = page.locator('.screen.arrived .btn')
  await expect(arrivedButtons).toHaveText(['I have my ticket · To the platform', 'How do I buy a ticket?'])
  await page.getByRole('button', { name: 'How do I buy a ticket?' }).click()
  await expect(page.getByText('To buy an Express ticket:')).toBeVisible()

  // 운영 서버의 에이전트는 표 사는 곳에 서 있어도 표 사는 곳을 다시 목적지로 정한다. 여기서는 "Express"로 같은 답을 받는다
  await page.locator('input.composer-input').fill('Express')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('You’re already at the ticket counter.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start directions' })).toHaveCount(0)

  await page.getByRole('button', { name: 'I have my ticket · To the platform' }).click()
  await page.getByRole('button', { name: 'Start directions' }).click()
  await expect(page.getByRole('heading', { name: 'Express train platform' })).toBeVisible()
  await expect(page.getByText('Go through the express train gates with your ticket.')).toBeVisible()

  const sent = api.mutations()
  const messages = sent.filter((c) => c.path === '/sessions/{id}/messages')
  expect(messages.map((c) => c.body)).toEqual([
    { message: 'Incheon Airport' },
    { message: 'Express' },
    { message: 'How do I buy a ticket?' },
    { message: 'Express' },
    { message: 'I’ve bought it. Take me to the platform.' },
  ])
  expect(messages[3].response).toMatchObject({ destination: { poi_id: 'poi-express-tickets' }, next_action: 'navigate' })
  expect(messages[4].response).toMatchObject({ destination: { poi_id: 'poi-express-platform' }, next_action: 'navigate' })

  // 표 사는 곳으로 가는 빈 경로는 만들지 않고, 승강장 경로만 새로 받는다
  const routes = sent.filter((c) => c.path === '/sessions/{id}/routes')
  expect(routes.map((c) => (c.body as { destination_poi_id: string }).destination_poi_id)).toEqual(['poi-express-tickets', 'poi-express-platform'])
  expect(routes[1].response).toMatchObject({ path_node_ids: ['express-tickets', 'express-gates', 'express-platform'] })
})
