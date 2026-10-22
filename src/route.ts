import { EDGES, NODES } from './data'
import type { Edge, NodeId } from './data'

export interface Step {
  edge: Edge
  floorChange: boolean
}

// Dijkstra over registered edges only: a destination with no registered path
// returns null instead of an invented shortcut.
export function findRoute(start: NodeId, goal: NodeId): Step[] | null {
  if (start === goal) return []
  const dist = new Map<NodeId, number>([[start, 0]])
  const prev = new Map<NodeId, Edge>()
  const open = new Set<NodeId>([start])
  while (open.size) {
    let cur: NodeId | undefined
    for (const n of open) if (cur === undefined || dist.get(n)! < dist.get(cur)!) cur = n
    open.delete(cur!)
    if (cur === goal) break
    for (const e of EDGES) {
      if (e.from !== cur) continue
      const d = dist.get(cur)! + e.meters
      if (d < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, d)
        prev.set(e.to, e)
        open.add(e.to)
      }
    }
  }
  if (!prev.has(goal)) return null
  const edges: Edge[] = []
  for (let n: NodeId = goal; n !== start; ) {
    const e = prev.get(n)!
    edges.unshift(e)
    n = e.from
  }
  return edges.map((edge) => ({ edge, floorChange: NODES[edge.from].floor !== NODES[edge.to].floor }))
}

export const totalMeters = (steps: Step[]) => steps.reduce((m, s) => m + s.edge.meters, 0)
