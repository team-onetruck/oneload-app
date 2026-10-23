/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: http 모드(실서버 연결)에서는 상단 필·설정 패널·시작 화면 문구가 데모가 아니라 실서버 연결로 보이는지 확인한다
 */
import { expect, test } from '@playwright/test'
import { interceptApi } from '../support/mockApi'

test('http 모드: 상단 필은 Live, 패널은 Dev controls, 시작 화면은 서버 연결 문구를 보여 준다', async ({ page }) => {
  await interceptApi(page)
  await page.goto('/?demo')

  await expect(page.getByText('Connected to the Hangil server.', { exact: false })).toBeVisible()
  await expect(page.getByText('Prototype.', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Demo', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Live', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Dev controls' })
  await expect(panel.getByRole('heading', { name: 'Dev controls' })).toBeVisible()
  // 패널 상태 줄의 모드 이름은 그대로 보인다
  await expect(panel.getByText(/· http/)).toBeVisible()
})
