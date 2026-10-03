import { allAssignments, assignmentOf, saveAssignment } from '@/data/batch-ledger'
import type { BatchAssignment } from '@/data/batch-ledger'
import { listRows, saveRows } from '@/data/local-store'
import { WORKSHOPS, type OrgUser } from '@/data/org'
import { PRODUCTION_PROCESSES } from '@/data/processes'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'
import { filterRows } from './local-service'

// 批生产记录的归属与流转规则全部收在这一个文件里：
// 页面只负责渲染和调用，不做业务判断（与 local-service.ts 的约定一致）。
const KEY = 'batchrecord'
const QC_KEY = 'finishedqc'
const ENTITY = '批生产记录'
const STATUS_ORDER = ['待编制', '编制中', '已复核', '已归档']

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function currentMonth(): string {
  return today().slice(0, 7)
}

function reject(message: string): ActionResult {
  return { ok: false, message }
}

function findRow(id: number): { rows: EntryRow[]; row: EntryRow; index: number } | null {
  const rows = listRows(KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return null
  }
  return { rows, row: rows[index], index }
}

// 车间与批号不一致时按台账口径统一：记录上的车间字段以台账归属为准，顺带把镜像的批记录状态对齐。
function syncWithLedger(): void {
  const rows = listRows(KEY)
  let changed = false
  for (const row of rows) {
    const assignment = assignmentOf(String(row['批号'] ?? ''))
    if (assignment && row['车间'] !== assignment.workshop) {
      row['车间'] = assignment.workshop
      changed = true
    }
    if (row['批记录状态'] !== row.status) {
      row['批记录状态'] = row.status
      changed = true
    }
  }
  if (changed) {
    saveRows(KEY, rows)
  }
}

// 归属校验：批号必须在台账里，且当前用户就是归属车间的人；别的班组一律只读。
function guardOwnership(user: OrgUser, row: EntryRow): { assignment: BatchAssignment } | ActionResult {
  const batchNo = String(row['批号'] ?? '')
  const assignment = assignmentOf(batchNo)
  if (!assignment) {
    return reject(`批号 ${batchNo} 未在台账登记归属，请先由车间主任按月分配`)
  }
  if (user.workshop !== assignment.workshop) {
    return reject(
      `越权拒绝：批号 ${batchNo} 归属${assignment.workshop}，当前用户属${user.workshop}，别的班组一律只读`,
    )
  }
  return { assignment }
}

function isAssignment(value: { assignment: BatchAssignment } | ActionResult): value is { assignment: BatchAssignment } {
  return 'assignment' in value
}

export function listBatchEntries(filters: Record<string, string> = {}): PageResult {
  syncWithLedger()
  const matched = filterRows(listRows(KEY), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function ledgerEntries(): BatchAssignment[] {
  return [...allAssignments()].sort((a, b) => a.batchNo.localeCompare(b.batchNo))
}

// 这一行当前用户能点哪些动作；别的班组、未分配台账的批号都拿不到动作（只读）。
export function rowActions(user: OrgUser, row: EntryRow): string[] {
  const assignment = assignmentOf(String(row['批号'] ?? ''))
  if (!assignment || user.workshop !== assignment.workshop) {
    return []
  }
  const status = String(row.status)
  const actions: string[] = []
  if (user.role === 'operator' && status === '待编制') {
    actions.push('提交编制')
  }
  if (user.role === 'reviewer' && status === '编制中') {
    actions.push('送交复核')
  }
  if ((user.role === 'operator' || user.role === 'reviewer') && status === '已复核') {
    actions.push('归档批记录')
  }
  return actions
}

// 操作人只能在自己批号、且记录还没复核归档前填投料量/工序。
export function canEditEntry(user: OrgUser, row: EntryRow): boolean {
  if (user.role !== 'operator') {
    return false
  }
  const assignment = assignmentOf(String(row['批号'] ?? ''))
  if (!assignment || user.workshop !== assignment.workshop) {
    return false
  }
  return String(row.status) === '待编制' || String(row.status) === '编制中'
}

// 车间主任按月分配批记录归属；批号还没有记录时顺带登记一条待编制。
export function assignBatch(
  user: OrgUser,
  payload: { batchNo: string; workshop: string; month: string; processes: string[] },
): ActionResult {
  if (user.role !== 'director') {
    return reject(`越权拒绝：批记录归属只能由车间主任按月分配，当前身份是${user.roleLabel}`)
  }
  const batchNo = payload.batchNo.trim()
  if (!batchNo) {
    return reject('批号不能为空')
  }
  if (!(WORKSHOPS as readonly string[]).includes(payload.workshop)) {
    return reject(`车间「${payload.workshop}」不在组织名单里`)
  }
  if (!/^\d{4}-\d{2}$/.test(payload.month)) {
    return reject('归属月份格式应为 YYYY-MM')
  }
  const processes = payload.processes.filter((item) =>
    (PRODUCTION_PROCESSES as readonly string[]).includes(item),
  )
  if (processes.length === 0) {
    return reject('工序范围不能为空，且必须取自共用工序字典')
  }
  saveAssignment({
    batchNo,
    workshop: payload.workshop,
    month: payload.month,
    processes,
    assignedBy: user.name,
  })
  const rows = listRows(KEY)
  const existing = rows.find((item) => String(item['批号']) === batchNo)
  if (existing) {
    existing['车间'] = payload.workshop
    saveRows(KEY, rows)
    return { ok: true, message: `批号 ${batchNo} 已按 ${payload.month} 重新划归${payload.workshop}，记录车间已按台账口径统一` }
  }
  const nextId = rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  rows.push({
    id: nextId,
    status: '待编制',
    pending: true,
    abnormal: false,
    批号: batchNo,
    产品名称: '',
    车间: payload.workshop,
    生产工序: processes[0],
    投料量: '',
    操作人: '',
    复核人: '',
    起始时间: `${payload.month}-01`,
    批记录状态: '待编制',
  })
  saveRows(KEY, rows)
  return { ok: true, message: `批号 ${batchNo} 已划归${payload.workshop}（${payload.month}），工序范围：${processes.join('、')}` }
}

// 操作人填写本批号下的投料量（顺带可在工序范围内改工序）。
export function saveOperatorEntry(
  user: OrgUser,
  id: number,
  patch: { 投料量?: string; 生产工序?: string },
): ActionResult {
  const found = findRow(id)
  if (!found) {
    return reject(`没有找到编号为 ${id} 的${ENTITY}`)
  }
  const { rows, row } = found
  const guard = guardOwnership(user, row)
  if (!isAssignment(guard)) {
    return guard
  }
  if (user.role !== 'operator') {
    return reject(`越权拒绝：只有归属车间的操作人能填写投料量，当前身份是${user.roleLabel}`)
  }
  const status = String(row.status)
  if (status !== '待编制' && status !== '编制中') {
    return reject(`记录已流转到「${status}」，投料量与工序不能再改`)
  }
  if (patch.生产工序 !== undefined && !guard.assignment.processes.includes(patch.生产工序)) {
    return reject(
      `生产工序「${patch.生产工序}」越出本批号允许范围（${guard.assignment.processes.join('、')}），请按台账口径重填`,
    )
  }
  if (patch.生产工序 !== undefined) {
    row['生产工序'] = patch.生产工序
  }
  if (patch.投料量 !== undefined) {
    row['投料量'] = patch.投料量
  }
  row['操作人'] = user.name
  saveRows(KEY, rows)
  return { ok: true, message: `批号 ${String(row['批号'])} 的投料量已保存` }
}

// 提交编制：只有归属车间的操作人推得动；生产工序越界打回重填。
export function submitPrepare(user: OrgUser, id: number): ActionResult {
  const found = findRow(id)
  if (!found) {
    return reject(`没有找到编号为 ${id} 的${ENTITY}`)
  }
  const { rows, row } = found
  const guard = guardOwnership(user, row)
  if (!isAssignment(guard)) {
    return guard
  }
  if (user.role !== 'operator') {
    return reject(`越权拒绝：只有归属车间的操作人能提交编制，当前身份是${user.roleLabel}`)
  }
  const status = String(row.status)
  if (status === '编制中') {
    return reject('该记录已在编制中，不用重复提交')
  }
  if (status !== '待编制') {
    return reject(`该记录已流转到「${status}」，不能退回重新提交编制`)
  }
  const process = String(row['生产工序'] ?? '')
  if (!guard.assignment.processes.includes(process)) {
    row.abnormal = true
    row['批记录状态'] = '待编制（打回重填）'
    saveRows(KEY, rows)
    return reject(
      `生产工序「${process}」越出本批号允许范围（${guard.assignment.processes.join('、')}），已打回重填`,
    )
  }
  if (!String(row['投料量'] ?? '').trim()) {
    return reject('投料量未填写，操作人只能填写本批号下的投料量后再提交')
  }
  row.status = '编制中'
  row.pending = true
  row.abnormal = false
  row['操作人'] = user.name
  row['起始时间'] = today()
  row['批记录状态'] = '编制中'
  saveRows(KEY, rows)
  return { ok: true, message: `批号 ${String(row['批号'])} 已提交编制，当前状态「编制中」` }
}

// 送交复核：必须换复核人签署，签完才算过账；越级的一律拦下。
export function submitReview(user: OrgUser, id: number): ActionResult {
  const found = findRow(id)
  if (!found) {
    return reject(`没有找到编号为 ${id} 的${ENTITY}`)
  }
  const { rows, row } = found
  const guard = guardOwnership(user, row)
  if (!isAssignment(guard)) {
    return guard
  }
  if (user.role !== 'reviewer') {
    return reject(`越权拒绝：只有归属车间的复核人能送交复核，当前身份是${user.roleLabel}`)
  }
  const status = String(row.status)
  if (status === '待编制') {
    return reject('越级拦下：尚未提交编制，不能直接送交复核')
  }
  if (status === '已复核') {
    return reject('该记录已复核，不用重复签署')
  }
  if (status === '已归档') {
    return reject('该记录已归档，不能再复核')
  }
  if (String(row['操作人'] ?? '') === user.name) {
    return reject('复核必须换人：操作人与复核人不得为同一人')
  }
  const process = String(row['生产工序'] ?? '')
  if (!guard.assignment.processes.includes(process)) {
    row.status = '待编制'
    row.abnormal = true
    row['批记录状态'] = '待编制（打回重填）'
    saveRows(KEY, rows)
    return reject(
      `生产工序「${process}」越出本批号允许范围（${guard.assignment.processes.join('、')}），已打回重填`,
    )
  }
  row.status = '已复核'
  row['复核人'] = user.name
  row['批记录状态'] = '已复核'
  saveRows(KEY, rows)
  return { ok: true, message: `批号 ${String(row['批号'])} 复核人已签署，记录过账，当前状态「已复核」` }
}

// 归档批记录：复核人签完才算过账；同一批号重复归档只算一次；状态落到成品检验台账。
export function archiveBatch(user: OrgUser, id: number): ActionResult {
  const found = findRow(id)
  if (!found) {
    return reject(`没有找到编号为 ${id} 的${ENTITY}`)
  }
  const { rows, row } = found
  const guard = guardOwnership(user, row)
  if (!isAssignment(guard)) {
    return guard
  }
  if (user.role !== 'operator' && user.role !== 'reviewer') {
    return reject(`越权拒绝：只有归属车间的操作人或复核人能归档，当前身份是${user.roleLabel}`)
  }
  const status = String(row.status)
  if (status === '已归档') {
    return reject('该批号已归档，同一批号重复归档只算一次')
  }
  if (status !== '已复核') {
    return reject(`越级拦下：当前状态「${status}」，复核人尚未签署，不能归档过账`)
  }
  const batchNo = String(row['批号'] ?? '')
  if (!String(row['复核人'] ?? '').trim()) {
    return reject('复核人未签署，不能归档过账')
  }
  const duplicated = rows.find(
    (item) => Number(item.id) !== id && String(item['批号']) === batchNo && String(item.status) === '已归档',
  )
  if (duplicated) {
    return reject(`批号 ${batchNo} 已有归档记录（编号 ${String(duplicated.id)}），同一批号重复归档只算一次`)
  }
  row.status = '已归档'
  row.pending = false
  row['归档时间'] = today()
  row['批记录状态'] = '已归档'
  saveRows(KEY, rows)
  postToFinishedQc(row)
  return { ok: true, message: `批号 ${batchNo} 已归档，状态已落到成品检验台账` }
}

// 归档后状态落到成品检验台账：按批号去重，已有就更新，没有才补登。
function postToFinishedQc(row: EntryRow): void {
  const batchNo = String(row['批号'] ?? '')
  const qcRows = listRows(QC_KEY)
  const existing = qcRows.find((item) => String(item['产品批号']) === batchNo)
  if (existing) {
    existing['检验状态'] = '批记录已归档'
    existing['判定结论'] = '批记录已归档，待成品检验'
    saveRows(QC_KEY, qcRows)
    return
  }
  const nextId = qcRows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  const nextSerial = qcRows.reduce((max, item) => {
    const matched = /^FINI-(\d+)$/.exec(String(item['检验编号'] ?? ''))
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0) + 1
  qcRows.push({
    id: nextId,
    status: '待检验',
    pending: true,
    abnormal: false,
    检验编号: `FINI-${String(nextSerial).padStart(4, '0')}`,
    产品批号: batchNo,
    检验项目: '批记录审核',
    标准规定: '批记录已归档',
    检验结果: '—',
    判定结论: '批记录已归档，待成品检验',
    检验人: '',
    检验状态: '批记录已归档',
  })
  saveRows(QC_KEY, qcRows)
}

// 看板指标：本月归档数按批号去重，重复归档只算一次。
export function batchMetrics(): { label: string; value: number }[] {
  const rows = listRows(KEY)
  const archivedThisMonth = new Set(
    rows
      .filter(
        (item) =>
          String(item.status) === '已归档' &&
          String(item['归档时间'] ?? '').startsWith(currentMonth()),
      )
      .map((item) => String(item['批号'])),
  )
  return [
    { label: '待编制批记录', value: rows.filter((item) => String(item.status) === '待编制').length },
    { label: '编制中批记录', value: rows.filter((item) => String(item.status) === '编制中').length },
    { label: '本月归档数', value: archivedThisMonth.size },
  ]
}

export const BATCH_STATUS_ORDER = STATUS_ORDER
