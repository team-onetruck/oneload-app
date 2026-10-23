/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 노드 id ↔ 데모 NodeId 다리가 같은 장소끼리 이어졌는지 이름으로 검사한다
 */
import { describe, expect, it } from 'vitest'
import { NODES } from '../../data'
import type { NodeId } from '../../data'
import { GRAPH } from '../../test/fixtures/seoulStation'
import { localNodeOf, serverNodeOf } from './nodeBridge'

describe('nodeBridge', () => {
  it('서버 노드마다 이름(en·ko)과 층이 같은 데모 노드로 이어진다', () => {
    for (const node of GRAPH.nodes) {
      const local = localNodeOf(node.id)
      expect(local, node.id).not.toBeNull()
      expect(NODES[local!].name).toEqual(node.name)
      expect(NODES[local!].floor).toBe(node.floor_id)
    }
  })

  it('데모 노드에서 서버 id로 되돌아가면 처음 id가 나온다', () => {
    for (const node of GRAPH.nodes) expect(serverNodeOf(localNodeOf(node.id)!)).toBe(node.id)
    for (const local of Object.keys(NODES) as NodeId[]) expect(localNodeOf(serverNodeOf(local))).toBe(local)
  })

  it('모르는 서버 id는 다른 장소로 짐작하지 않고 null을 돌려준다', () => {
    expect(localNodeOf('node-unknown')).toBeNull()
  })
})
