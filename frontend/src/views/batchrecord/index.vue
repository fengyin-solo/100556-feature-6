<template>
  <section class="page" data-module="batchrecord">
    <header class="page-head">
      <div>
        <h2>批生产记录管理</h2>
        <p class="page-desc">
          批号归属以台账为准：只有归属车间的操作人能提交编制，复核必须换人，别的班组一律只读。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openAssign">登记批生产记录</button>
        <button class="btn" type="button" @click="exportRows">导出批生产记录清单</button>
      </div>
    </header>

    <p class="identity-line">
      当前身份：{{ user.name }}（{{ user.roleLabel }} · {{ user.workshop }}）
      <span v-if="user.role !== 'director'">；非本车间的批号一律只读</span>
      <span v-else>；可按月分配批记录归属</span>
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

    <section class="ledger-panel">
      <h3 class="ledger-title">批记录归属台账（车间主任按月分配，车间口径以此为准）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>批号</th>
            <th>归属车间</th>
            <th>归属月份</th>
            <th>允许工序范围</th>
            <th>分配人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in ledger" :key="`${item.batchNo}-${item.month}`">
            <td>{{ item.batchNo }}</td>
            <td>{{ item.workshop }}</td>
            <td>{{ item.month }}</td>
            <td>{{ item.processes.join('、') }}</td>
            <td>{{ item.assignedBy }}</td>
          </tr>
          <tr v-if="!ledger.length">
            <td colspan="5" class="empty-state">台账暂无归属记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <form v-if="assignOpen" class="assign-panel" @submit.prevent="submitAssign">
      <label class="filter-item">
        <span>归属月份</span>
        <input v-model="assignForm.month" type="month" required />
      </label>
      <label class="filter-item">
        <span>批号</span>
        <input v-model="assignForm.batchNo" placeholder="如 FD2026-1001" required />
      </label>
      <label class="filter-item">
        <span>归属车间</span>
        <select v-model="assignForm.workshop">
          <option v-for="name in workshops" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <fieldset class="process-picker">
        <legend>允许工序范围（共用工序字典）</legend>
        <label v-for="name in processDict" :key="name" class="process-option">
          <input v-model="assignForm.processes" type="checkbox" :value="name" />
          {{ name }}
        </label>
      </fieldset>
      <button class="btn primary" type="submit">确认分配</button>
      <button class="btn ghost" type="button" @click="assignOpen = false">收起</button>
    </form>

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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '生产工序' && editable(row)">
              <select v-model="drafts[Number(row.id)].生产工序">
                <option
                  v-for="name in processRangeOf(row)"
                  :key="name"
                  :value="name"
                >
                  {{ name }}
                </option>
              </select>
            </template>
            <template v-else-if="column === '投料量' && editable(row)">
              <input
                v-model="drafts[Number(row.id)].投料量"
                class="feeding-input"
                placeholder="填写投料量"
              />
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="editable(row)"
              class="link"
              type="button"
              @click="saveEntry(row)"
            >
              保存投料
            </button>
            <button
              v-for="action in actionsOf(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!editable(row) && !actionsOf(row).length" class="readonly-tag">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无批生产记录数据，可由车间主任登记分配</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条批生产记录记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  archiveBatch,
  assignBatch,
  batchMetrics,
  canEditEntry,
  ledgerEntries,
  listBatchEntries,
  rowActions,
  saveOperatorEntry,
  submitPrepare,
  submitReview,
} from '@/api/batchrecord-service'
import { downloadEntries } from '@/api/local-service'
import { assignmentOf, type BatchAssignment } from '@/data/batch-ledger'
import { WORKSHOPS } from '@/data/org'
import { PRODUCTION_PROCESSES } from '@/data/processes'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const columns = ['批号', '产品名称', '车间', '生产工序', '投料量', '操作人', '复核人', '起始时间', '批记录状态']
const statuses = ['待编制', '编制中', '已复核', '已归档']
const workshops = WORKSHOPS
const processDict = PRODUCTION_PROCESSES

const store = useSessionStore()
const user = computed(() => store.currentUser)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref<{ label: string; value: number }[]>([])
const ledger = ref<BatchAssignment[]>([])
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['批号', '产品名称', '车间']
const drafts = ref<Record<number, { 投料量: string; 生产工序: string }>>({})
const assignOpen = ref(false)
const assignForm = ref({
  month: new Date().toISOString().slice(0, 7),
  batchNo: '',
  workshop: WORKSHOPS[0] as string,
  processes: [] as string[],
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function editable(row: EntryRow): boolean {
  return canEditEntry(user.value, row)
}

function actionsOf(row: EntryRow): string[] {
  return rowActions(user.value, row)
}

function processRangeOf(row: EntryRow): readonly string[] {
  return assignmentOf(String(row['批号'] ?? ''))?.processes ?? []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('batchrecord')
}

function openAssign() {
  clearMessages()
  if (user.value.role !== 'director') {
    errorMessage.value = `越权拒绝：批记录归属只能由车间主任按月分配，当前身份是${user.value.roleLabel}`
    return
  }
  assignOpen.value = !assignOpen.value
}

function submitAssign() {
  clearMessages()
  const result = assignBatch(user.value, { ...assignForm.value })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  assignForm.value.batchNo = ''
  assignForm.value.processes = []
  reload()
}

function saveEntry(row: EntryRow) {
  clearMessages()
  const draft = drafts.value[Number(row.id)]
  if (!draft) {
    return
  }
  const result = saveOperatorEntry(user.value, Number(row.id), {
    投料量: draft.投料量,
    生产工序: draft.生产工序,
  })
  showResult(result)
}

function runAction(action: string, row: EntryRow) {
  clearMessages()
  const id = Number(row.id)
  const result =
    action === '提交编制'
      ? submitPrepare(user.value, id)
      : action === '送交复核'
        ? submitReview(user.value, id)
        : archiveBatch(user.value, id)
  showResult(result)
}

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
  reload()
}

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function reload() {
  try {
    const payload = listBatchEntries(filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = batchMetrics()
    ledger.value = ledgerEntries()
    const next: Record<number, { 投料量: string; 生产工序: string }> = {}
    for (const row of payload.items) {
      if (canEditEntry(user.value, row)) {
        next[Number(row.id)] = {
          投料量: String(row['投料量'] ?? ''),
          生产工序: String(row['生产工序'] ?? ''),
        }
      }
    }
    drafts.value = next
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '批生产记录列表读取失败'
  }
}

onMounted(reload)

// 顶栏切换值班身份后，按新身份重建可编辑草稿与动作。
watch(() => store.userName, () => {
  clearMessages()
  assignOpen.value = false
  reload()
})
</script>
