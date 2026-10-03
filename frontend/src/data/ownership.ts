// 批记录归属台账：车间主任按月把批号分到车间，是「批号归谁」的唯一口径。
// 批生产记录行上的所属车间与台账不一致时，一律按台账统一。
const STORAGE_KEY = 'pharma-cleanroom:batch-ownership'

export type BatchOwnership = {
  批号: string
  车间: string
  归属月份: string
  分配人: string
  分配时间: string
}

const OWNERSHIP_SEED: BatchOwnership[] = [
  { 批号: 'PR2026-0901', 车间: '固体制剂一车间', 归属月份: '2026-09', 分配人: '王建国', 分配时间: '2026-09-01' },
  { 批号: 'PR2026-0902', 车间: '固体制剂一车间', 归属月份: '2026-09', 分配人: '王建国', 分配时间: '2026-09-01' },
  { 批号: 'PR2026-0903', 车间: '固体制剂二车间', 归属月份: '2026-09', 分配人: '刘志远', 分配时间: '2026-09-01' },
  { 批号: 'PR2026-0904', 车间: '固体制剂二车间', 归属月份: '2026-09', 分配人: '刘志远', 分配时间: '2026-09-01' },
  { 批号: 'PR2026-0905', 车间: '固体制剂一车间', 归属月份: '2026-09', 分配人: '王建国', 分配时间: '2026-09-01' },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: BatchOwnership[] | null = null

export function listOwnership(): BatchOwnership[] {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = clone(OWNERSHIP_SEED)
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = clone(OWNERSHIP_SEED)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    return cache
  }
  try {
    cache = JSON.parse(raw) as BatchOwnership[]
    return cache
  } catch {
    cache = clone(OWNERSHIP_SEED)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    return cache
  }
}

export function findOwnership(批号: string): BatchOwnership | undefined {
  return listOwnership().find((item) => item.批号 === 批号)
}

// 车间主任按月分配：同一批号重新分配时覆盖旧记录，台账里只留最新口径。
export function assignOwnership(批号: string, 车间: string, 归属月份: string, 分配人: string): BatchOwnership {
  const next = listOwnership().filter((item) => item.批号 !== 批号)
  const record: BatchOwnership = {
    批号,
    车间,
    归属月份,
    分配人,
    分配时间: new Date().toISOString().slice(0, 10),
  }
  next.push(record)
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  return record
}
