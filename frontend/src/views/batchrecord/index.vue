<template>
  <section class="page" data-module="batchrecord">
    <header class="page-head">
      <div>
        <h2>批生产记录管理</h2>
        <p class="page-desc">批号归属以车间主任按月分配的台账为准：只有归属车间的操作人能提交编制，复核必须换人，复核人签字后才算过账归档。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = !showCreate">登记批生产记录</button>
        <button class="btn" type="button" @click="exportRows">导出批生产记录清单</button>
      </div>
    </header>

    <p class="session-line">
      当前登录：{{ store.operator }}（{{ store.role }} · {{ store.workshop || '未挂车间' }}），别班组的批记录一律只读。
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="panel">
      <h3 class="panel-title">批记录归属台账（按月分配）</h3>
      <p class="panel-desc">批号挂在哪个车间以这份台账为准，记录上的所属车间与台账不一致时按台账口径统一。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>批号</th>
            <th>归属车间</th>
            <th>归属月份</th>
            <th>分配人</th>
            <th>分配时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in ownershipRows" :key="item.批号">
            <td>{{ item.批号 }}</td>
            <td>{{ item.车间 }}</td>
            <td>{{ item.归属月份 }}</td>
            <td>{{ item.分配人 }}</td>
            <td>{{ item.分配时间 }}</td>
          </tr>
          <tr v-if="!ownershipRows.length">
            <td colspan="5" class="empty-state">台账为空，需车间主任按月分配批记录归属</td>
          </tr>
        </tbody>
      </table>
      <form v-if="store.role === '车间主任'" class="form-row" style="margin-top: 10px" @submit.prevent="submitAssign">
        <label class="form-item">
          <span>批号</span>
          <input v-model="assignForm.批号" list="batch-options" placeholder="输入或选择批号" />
          <datalist id="batch-options">
            <option v-for="row in rows" :key="String(row.id)" :value="String(row['批号'])" />
          </datalist>
        </label>
        <label class="form-item">
          <span>归属车间</span>
          <select v-model="assignForm.车间">
            <option v-for="ws in workshops" :key="ws" :value="ws">{{ ws }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>归属月份</span>
          <input v-model="assignForm.归属月份" type="month" />
        </label>
        <button class="btn primary" type="submit">分配归属</button>
      </form>
    </section>

    <section v-if="showCreate" class="panel">
      <h3 class="panel-title">登记批生产记录</h3>
      <form class="form-row" @submit.prevent="submitCreate">
        <label class="form-item">
          <span>批号</span>
          <input v-model="createForm.批号" placeholder="如 PR2026-0906" />
        </label>
        <label class="form-item">
          <span>产品名称</span>
          <input v-model="createForm.产品名称" placeholder="产品名称" />
        </label>
        <label class="form-item">
          <span>生产工序</span>
          <select v-model="createForm.生产工序">
            <option v-for="step in processSteps" :key="step" :value="step">{{ step }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>投料量</span>
          <input v-model="createForm.投料量" placeholder="如 120kg" />
        </label>
        <label class="form-item">
          <span>起始时间</span>
          <input v-model="createForm.起始时间" type="date" />
        </label>
        <button class="btn primary" type="submit">保存登记</button>
      </form>
    </section>

    <section v-if="editingId !== null" class="panel">
      <h3 class="panel-title">填写投料量（批号 {{ editingBatch }}）</h3>
      <p class="panel-desc">只有归属车间的操作人能填；生产工序越界被打回的，按统一工序目录重填。</p>
      <form class="form-row" @submit.prevent="submitEdit">
        <label class="form-item">
          <span>投料量</span>
          <input v-model="editForm.投料量" placeholder="如 120kg" />
        </label>
        <label class="form-item">
          <span>生产工序</span>
          <select v-model="editForm.生产工序">
            <option v-for="step in processSteps" :key="step" :value="step">{{ step }}</option>
          </select>
        </label>
        <button class="btn primary" type="submit">保存</button>
        <button class="btn ghost" type="button" @click="editingId = null">取消</button>
      </form>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="isOwn(row)">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button class="link" type="button" @click="openEdit(row)">填写投料量</button>
            </template>
            <span v-else class="readonly-tag">只读（归属{{ row['所属车间'] || '未分配' }}）</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无批生产记录数据，可先登记批生产记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条批生产记录记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  assignBatchOwnership,
  createBatchRecord,
  listBatchRecords,
  listOwnership,
  runBatchAction,
  updateBatchRecord,
} from '@/api/batchrecord-service'
import type { SessionContext } from '@/api/batchrecord-service'
import { WORKSHOPS } from '@/data/directory'
import { PROCESS_STEPS } from '@/data/process-catalog'
import type { BatchOwnership } from '@/data/ownership'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('batchrecord')
const store = useSessionStore()

const columns = ["批号", "产品名称", "生产工序", "投料量", "所属车间", "操作人", "复核人", "起始时间", "批记录状态"]
const actions = ["提交编制", "送交复核", "归档批记录"]
const statuses = ["待编制", "编制中", "已复核", "已归档"]
const filterFields = columns.slice(0, 3)
const processSteps = PROCESS_STEPS
const workshops = WORKSHOPS

const rows = ref<EntryRow[]>([])
const ownershipRows = ref<BatchOwnership[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const showCreate = ref(false)
const editingId = ref<number | null>(null)
const editingBatch = ref('')

const currentMonth = new Date().toISOString().slice(0, 7)
const today = new Date().toISOString().slice(0, 10)

const createForm = reactive({
  批号: '',
  产品名称: '',
  生产工序: PROCESS_STEPS[0],
  投料量: '',
  起始时间: today,
})
const editForm = reactive({ 投料量: '', 生产工序: PROCESS_STEPS[0] })
const assignForm = reactive({ 批号: '', 车间: store.workshop || WORKSHOPS[0], 归属月份: currentMonth })

const stats = computed(() => [
  { label: '待编制批记录', value: rows.value.filter((row) => row.status === '待编制').length },
  { label: '编制中批记录', value: rows.value.filter((row) => row.status === '编制中').length },
  {
    label: '本月归档数',
    value: rows.value.filter(
      (row) => row.status === '已归档' && String(row['归档时间'] ?? '').startsWith(currentMonth),
    ).length,
  },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function session(): SessionContext {
  return { userName: store.operator, role: store.role, workshop: store.workshop }
}

// 归属判断走台账口径：列表出口已按台账统一过所属车间，这里直接比对。
function isOwn(row: EntryRow): boolean {
  return String(row['所属车间'] ?? '') !== '' && String(row['所属车间']) === store.workshop
}

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    successMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    successMessage.value = ''
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  showResult(runBatchAction(session(), Number(row.id), action))
  reload()
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  editingBatch.value = String(row['批号'] ?? '')
  editForm.投料量 = String(row['投料量'] ?? '')
  editForm.生产工序 = processSteps.includes(String(row['生产工序']))
    ? String(row['生产工序'])
    : processSteps[0]
}

function submitEdit() {
  if (editingId.value === null) {
    return
  }
  const result = updateBatchRecord(session(), editingId.value, {
    投料量: editForm.投料量,
    生产工序: editForm.生产工序,
  })
  showResult(result)
  if (result.ok) {
    editingId.value = null
  }
  reload()
}

function submitCreate() {
  const result = createBatchRecord(session(), { ...createForm })
  showResult(result)
  if (result.ok) {
    showCreate.value = false
    createForm.批号 = ''
    createForm.产品名称 = ''
    createForm.投料量 = ''
  }
  reload()
}

function submitAssign() {
  showResult(assignBatchOwnership(session(), assignForm.批号, assignForm.车间, assignForm.归属月份))
  reload()
}

function reload() {
  try {
    const payload = listBatchRecords(filters.value)
    rows.value = payload.items
    total.value = payload.total
    ownershipRows.value = [...listOwnership()]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '批生产记录列表读取失败'
  }
}

onMounted(reload)
</script>
