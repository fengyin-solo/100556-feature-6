import { assignOwnership, findOwnership, listOwnership } from '@/data/ownership'
import { isKnownProcessStep } from '@/data/process-catalog'
import { listRows, saveRows } from '@/data/local-store'
import { filterRows } from '@/api/local-service'
import type { UserRole } from '@/data/directory'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

// 批生产记录的归属与流转规则全部收在这里，页面只负责渲染和转发。
// 口径：批号挂在哪个车间以归属台账为准；状态按 待编制→编制中→已复核→已归档 依次流转。

export type SessionContext = {
  userName: string
  role: UserRole
  workshop: string
}

const KEY = 'batchrecord'
const ENTITY = '批生产记录'
const LAST_STATUS = '已归档'

// 每个动作只允许从紧邻的前一个状态发起，越级的一律拦下。
const ACTION_FLOW: Record<string, { from: string; to: string }> = {
  提交编制: { from: '待编制', to: '编制中' },
  送交复核: { from: '编制中', to: '已复核' },
  归档批记录: { from: '已复核', to: '已归档' },
}
const FLOW_TEXT = '待编制→编制中→已复核→已归档'

function deny(message: string): ActionResult {
  return { ok: false, message }
}

function findRow(id: number): { rows: EntryRow[]; index: number } | undefined {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? undefined : { rows, index }
}

// 车间与批号不一致时按台账口径统一：返回统一后的所属车间，并把行数据改过来。
function reconcileWorkshop(row: EntryRow): string {
  const ownership = findOwnership(String(row['批号'] ?? ''))
  if (ownership && row['所属车间'] !== ownership.车间) {
    row['所属车间'] = ownership.车间
  }
  return String(row['所属车间'] ?? '')
}

// 归属检查：批号没上台账、或当前登录不是归属车间的人，都拒绝并写明原因。
function checkOwnership(session: SessionContext, row: EntryRow, action: string): ActionResult | undefined {
  const 批号 = String(row['批号'] ?? '')
  const ownership = findOwnership(批号)
  if (!ownership) {
    return deny(`拒绝${action}：批号 ${批号} 尚未由车间主任按月分配归属，请先在归属台账登记`)
  }
  if (ownership.车间 !== session.workshop) {
    return deny(
      `越权拒绝${action}：批号 ${批号} 归属${ownership.车间}，当前登录 ${session.userName}（${session.workshop}·${session.role}）对别班组的批记录一律只读`,
    )
  }
  return undefined
}

function persist(rows: EntryRow[]): void {
  saveRows(KEY, rows)
}

export function listBatchRecords(filters: Record<string, string> = {}): PageResult {
  const rows = listRows(KEY)
  // 列表出口统一按台账口径校准所属车间，不一致的当场改过来再落库。
  let changed = false
  for (const row of rows) {
    const before = String(row['所属车间'] ?? '')
    if (reconcileWorkshop(row) !== before) {
      changed = true
    }
  }
  if (changed) {
    persist(rows)
  }
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 车间主任按月分配批记录归属；分配后行上的所属车间立即按台账统一。
export function assignBatchOwnership(
  session: SessionContext,
  批号: string,
  车间: string,
  归属月份: string,
): ActionResult {
  if (session.role !== '车间主任') {
    return deny(`越权拒绝分配归属：只有车间主任能分配批记录归属，当前登录 ${session.userName} 是${session.role}`)
  }
  if (!批号.trim() || !车间.trim() || !归属月份.trim()) {
    return deny('批号、归属车间、归属月份都要填全才能分配')
  }
  assignOwnership(批号.trim(), 车间.trim(), 归属月份.trim(), session.userName)
  const rows = listRows(KEY)
  let touched = 0
  for (const row of rows) {
    if (String(row['批号']) === 批号.trim() && row['所属车间'] !== 车间.trim()) {
      row['所属车间'] = 车间.trim()
      touched += 1
    }
  }
  if (touched > 0) {
    persist(rows)
  }
  return {
    ok: true,
    message: `批号 ${批号.trim()} 已划归${车间.trim()}（${归属月份.trim()}），台账口径已统一${touched > 0 ? `，同步校正 ${touched} 条在册记录` : ''}`,
  }
}

export function createBatchRecord(
  session: SessionContext,
  payload: { 批号: string; 产品名称: string; 生产工序: string; 投料量: string; 起始时间: string },
): ActionResult {
  if (session.role === '复核人') {
    return deny(`越权拒绝登记：复核人岗位不登记批记录，当前登录 ${session.userName}`)
  }
  if (!payload.批号.trim()) {
    return deny('批号不能为空')
  }
  if (!isKnownProcessStep(payload.生产工序)) {
    return deny(`生产工序「${payload.生产工序}」越界，不在统一工序目录内，打回重填`)
  }
  const rows = listRows(KEY)
  if (rows.some((row) => String(row['批号']) === payload.批号.trim())) {
    return deny(`批号 ${payload.批号.trim()} 已在台账内，同一批号只登记一次`)
  }
  const ownership = findOwnership(payload.批号.trim())
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  rows.push({
    id,
    status: '待编制',
    pending: true,
    abnormal: false,
    批号: payload.批号.trim(),
    产品名称: payload.产品名称.trim(),
    生产工序: payload.生产工序.trim(),
    投料量: payload.投料量.trim(),
    所属车间: ownership ? ownership.车间 : session.workshop,
    操作人: '',
    复核人: '',
    起始时间: payload.起始时间 || new Date().toISOString().slice(0, 10),
    批记录状态: '待编制',
  })
  persist(rows)
  return {
    ok: true,
    message: ownership
      ? `批号 ${payload.批号.trim()} 已登记，归属按台账口径挂到${ownership.车间}`
      : `批号 ${payload.批号.trim()} 已登记，尚未分配归属，需车间主任按月分配后才能提交编制`,
  }
}

// 操作人只填自己批号下的投料量；工序越界被打回的也在这里按目录重填。
export function updateBatchRecord(
  session: SessionContext,
  id: number,
  patch: { 投料量?: string; 生产工序?: string },
): ActionResult {
  const found = findRow(id)
  if (!found) {
    return deny(`没有找到编号为 ${id} 的${ENTITY}`)
  }
  const { rows, index } = found
  const row = rows[index]
  const denied = checkOwnership(session, row, '填写')
  if (denied) {
    return denied
  }
  if (session.role !== '操作人') {
    return deny(`越权拒绝填写：只有归属车间的操作人能填写投料量，当前登录 ${session.userName} 是${session.role}`)
  }
  if (row.status === LAST_STATUS) {
    return deny(`批号 ${row['批号']} 已归档过账，投料量不能再改`)
  }
  if (patch.生产工序 !== undefined && !isKnownProcessStep(patch.生产工序)) {
    return deny(`生产工序「${patch.生产工序}」越界，不在统一工序目录内，打回重填`)
  }
  const next: EntryRow = { ...row }
  if (patch.投料量 !== undefined) {
    next['投料量'] = patch.投料量.trim()
  }
  if (patch.生产工序 !== undefined) {
    next['生产工序'] = patch.生产工序.trim()
    next.abnormal = false
  }
  rows[index] = next
  persist(rows)
  return { ok: true, message: `批号 ${row['批号']} 已更新，投料量 ${next['投料量'] || '未填'}` }
}

export function runBatchAction(session: SessionContext, id: number, action: string): ActionResult {
  const flow = ACTION_FLOW[action]
  if (!flow) {
    return deny(`${ENTITY}没有登记「${action}」这个动作`)
  }
  const found = findRow(id)
  if (!found) {
    return deny(`没有找到编号为 ${id} 的${ENTITY}`)
  }
  const { rows, index } = found
  const row = rows[index]
  const 批号 = String(row['批号'] ?? '')

  const denied = checkOwnership(session, row, action)
  if (denied) {
    return denied
  }
  if (row.status === flow.to) {
    return deny(
      action === '归档批记录'
        ? `批号 ${批号} 的批记录已归档，同一批号重复归档只算一次，不再过账`
        : `${ENTITY}已经是「${flow.to}」，不用重复操作`,
    )
  }
  if (row.status !== flow.from) {
    return deny(`越级拦下：状态须按 ${FLOW_TEXT} 依次流转，当前「${row.status}」不能执行「${action}」`)
  }

  if (action === '提交编制') {
    return submitCompile(session, rows, index, flow.to)
  }
  if (action === '送交复核') {
    return submitReview(session, rows, index, flow.to)
  }
  return archiveRecord(session, rows, index, flow.to)
}

function submitCompile(session: SessionContext, rows: EntryRow[], index: number, target: string): ActionResult {
  const row = rows[index]
  if (session.role !== '操作人') {
    return deny(`越权拒绝提交编制：只有归属车间的操作人推得动，当前登录 ${session.userName} 是${session.role}`)
  }
  if (!isKnownProcessStep(String(row['生产工序'] ?? ''))) {
    row.abnormal = true
    persist(rows)
    return deny(`生产工序「${row['生产工序']}」越界，不在统一工序目录内，打回重填后再提交编制`)
  }
  rows[index] = {
    ...row,
    status: target,
    批记录状态: target,
    操作人: session.userName,
    pending: true,
    abnormal: false,
  }
  persist(rows)
  return { ok: true, message: `批号 ${row['批号']} 已提交编制，操作人 ${session.userName}，当前状态「${target}」` }
}

function submitReview(session: SessionContext, rows: EntryRow[], index: number, target: string): ActionResult {
  const row = rows[index]
  if (session.role !== '复核人') {
    return deny(`越权拒绝送交复核：只有复核人岗位能复核，当前登录 ${session.userName} 是${session.role}`)
  }
  if (String(row['操作人']) === session.userName) {
    return deny(`复核必须换人：${session.userName} 是本批操作人，不能自己复核自己`)
  }
  rows[index] = {
    ...row,
    status: target,
    批记录状态: target,
    复核人: session.userName,
    pending: true,
    abnormal: false,
  }
  persist(rows)
  return { ok: true, message: `批号 ${row['批号']} 已由复核人 ${session.userName} 签字，当前状态「${target}」` }
}

function archiveRecord(session: SessionContext, rows: EntryRow[], index: number, target: string): ActionResult {
  const row = rows[index]
  const 批号 = String(row['批号'] ?? '')
  if (!String(row['复核人'] ?? '').trim()) {
    return deny(`复核人尚未签字，批号 ${批号} 不算过账，不能归档`)
  }
  const duplicated = rows.some((item, i) => i !== index && String(item['批号']) === 批号 && item.status === LAST_STATUS)
  if (duplicated) {
    return deny(`批号 ${批号} 已有归档记录，同一批号重复归档只算一次`)
  }
  rows[index] = {
    ...row,
    status: target,
    批记录状态: target,
    归档时间: new Date().toISOString().slice(0, 10),
    pending: false,
    abnormal: false,
  }
  persist(rows)
  syncFinishedQc(row)
  return {
    ok: true,
    message: `批号 ${批号} 复核人 ${row['复核人']} 已签字，过账归档，状态同步落到成品检验台账（待检验）`,
  }
}

// 过账后状态落到成品检验台账：同一批号只落一条，已存在的批号不重复登记。
function syncFinishedQc(row: EntryRow): void {
  const qcRows = listRows('finishedqc')
  const 批号 = String(row['批号'] ?? '')
  if (qcRows.some((item) => String(item['产品批号']) === 批号)) {
    return
  }
  const id = qcRows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  qcRows.push({
    id,
    status: '待检验',
    pending: true,
    abnormal: false,
    检验编号: `FINI-${String(id).padStart(4, '0')}`,
    产品批号: 批号,
    检验项目: '成品全项检验',
    标准规定: '符合企业内控标准',
    检验结果: '',
    判定结论: '',
    检验人: '',
    检验状态: '待检验',
  })
  saveRows('finishedqc', qcRows)
}

export { listOwnership }
