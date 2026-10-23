/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로 탐색(findRoute)의 기본 동작을 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { findRoute, totalMeters } from './route'

describe('findRoute', () => {
  it('출발지와 도착지가 같으면 빈 경로를 돌려준다', () => {
    expect(findRoute('concourse', 'concourse')).toEqual([])
  })

  it('KTX 맞이방에서 직통열차 승강장까지 등록된 구간만 따라 이동한다', () => {
    const steps = findRoute('ktxHall', 'expressPlatform')
    expect(steps?.map((s) => s.edge.to)).toEqual(['concourse', 'expressDesk', 'expressGate', 'expressPlatform'])
    expect(steps?.some((s) => s.floorChange)).toBe(true)
    expect(totalMeters(steps ?? [])).toBe(120 + 30 + 25 + 60)
  })

  it('등록된 경로가 없으면 지름길을 만들지 않고 null을 돌려준다', () => {
    expect(findRoute('expressPlatform', 'ktxHall')).toBeNull()
  })
})
