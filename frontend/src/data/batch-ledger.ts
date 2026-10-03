// 批记录归属台账：车间主任按月把批号分到车间，并圈定该批号允许的生产工序范围。
// 批号归哪个车间、能走哪些工序，一律以这份台账为准（台账口径），记录上的车间字段只是台账的镜像。
export type BatchAssignment = {
  batchNo: string
  workshop: string
  month: string
  processes: string[]
  assignedBy: string
}

const LEDGER_KEY = 'pharma-cleanroom:batch-ledger'

// 示例台账：首次打开时播种，之后以浏览器里的改动为准。
const SEED_ASSIGNMENTS: BatchAssignment[] = [
  { batchNo: 'FD2026-0901', workshop: '冻干车间', month: '2026-09', processes: ['配料', '灌装', '冻干', '包装'], assignedBy: '王主任' },
  { batchNo: 'FD2026-0902', workshop: '冻干车间', month: '2026-09', processes: ['配料', '灌装', '冻干', '包装'], assignedBy: '王主任' },
  { batchNo: 'FD2026-0903', workshop: '冻干车间', month: '2026-09', processes: ['配料', '灌装', '冻干', '包装'], assignedBy: '王主任' },
  { batchNo: 'GY2026-0901', workshop: '灌装车间', month: '2026-09', processes: ['配料', '灌装', '灯检', '包装'], assignedBy: '王主任' },
  { batchNo: 'GZ2026-0901', workshop: '固体制剂车间', month: '2026-09', processes: ['配料', '制粒', '压片', '包衣', '包装'], assignedBy: '王主任' },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readLedger(): BatchAssignment[] {
  const fallback = clone(SEED_ASSIGNMENTS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(LEDGER_KEY)
  if (!raw) {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as BatchAssignment[]
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: BatchAssignment[] | null = null

export function allAssignments(): BatchAssignment[] {
  if (cache === null) {
    cache = readLedger()
  }
  return cache
}

// 查批号归属：同一批号可能有多次按月分配，取月份最新的一条。
export function assignmentOf(batchNo: string): BatchAssignment | undefined {
  const matched = allAssignments()
    .filter((item) => item.batchNo === batchNo)
    .sort((a, b) => b.month.localeCompare(a.month))
  return matched[0]
}

// 主任分配：同批号同月份覆盖，不同月份各留一条。
export function saveAssignment(entry: BatchAssignment): void {
  const rest = allAssignments().filter(
    (item) => !(item.batchNo === entry.batchNo && item.month === entry.month),
  )
  const next = [...rest, entry]
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next))
  }
}
