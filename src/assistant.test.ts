/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: mock 대화 규칙(classify)의 분류 결과를 표로 고정한다. 영어 단어 경계 수정 뒤에도 다른 문장의 분류가 바뀌지 않았는지 본다
 */
import { describe, expect, it } from 'vitest'
import { classify } from './assistant'
import type { Intent } from './assistant'

// 칩 라벨(en·ko)과 README 시나리오 문장. 값은 단어 경계 수정 전 결과와 같고, express 세 줄만 buy에서 바뀌었다.
// 라벨만으로 분류되지 않는 칩(교통카드 있어요·없어요, How do I top it up? 등)은 mock 어댑터가 칩의 intent를 기억해서 처리한다.
const TABLE: Array<[string, Intent]> = [
  ['Incheon Airport', 'airport'],
  ['인천공항', 'airport'],
  ['How do I pay?', 'pay'],
  ['돈은 어떻게 내요?', 'pay'],
  ['Card deposit refund', 'deposit'],
  ['교통카드 보증금 환급', 'deposit'],
  ['Express', 'express'],
  ['직통열차', 'express'],
  ['All-stop', 'allstop'],
  ['일반열차', 'allstop'],
  ['Not sure', 'notSure'],
  ['잘 모르겠어요', 'notSure'],
  ['I have a transit card', 'whatCard'],
  ['교통카드 있어요', 'whatCard'],
  ['I don’t have one', 'unknown'],
  ['없어요', 'unknown'],
  ['What’s a transit card?', 'whatCard'],
  ['교통카드가 뭐예요?', 'whatCard'],
  ['How do I top it up?', 'unknown'],
  ['충전은 어떻게 해요?', 'recharge'],
  ['How do I buy a ticket?', 'buy'],
  ['승차권은 어떻게 사요?', 'buy'],
  ['Go to the platform', 'platform'],
  ['승강장으로 가기', 'platform'],
  ['Can I pay with a credit card?', 'pay'],
  ['How much is the fare?', 'fare'],
  ['요금이 얼마예요?', 'fare'],
  ['I think I’m lost', 'lost'],
  ['길을 잃은 것 같아요', 'lost'],
  ['What should I press?', 'buy'],
  ['Where do I buy tickets?', 'buy'],
  ['Which platforms?', 'platform'],
  ['express train please', 'express'],
  ['I want the express', 'express'],
  ['AREX to ICN', 'airport'],
  ['regular train', 'allstop'],
  ['hello', 'unknown'],
]

describe('classify', () => {
  it.each(TABLE)('%s → %s', (text, intent) => {
    expect(classify(text)).toBe(intent)
  })

  it('"express" 안의 "press"는 표 사기로 보지 않지만, 단어로 쓴 press는 표 사기다', () => {
    expect(classify('Express')).toBe('express')
    expect(classify('Which button do I press?')).toBe('buy')
  })
})
