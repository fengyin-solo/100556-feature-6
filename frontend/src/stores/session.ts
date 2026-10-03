import { defineStore } from 'pinia'

import { findUser, USERS } from '@/data/directory'
import type { UserRole } from '@/data/directory'

export const useSessionStore = defineStore('session', {
  state: () => ({
    userName: '李国强',
    shiftLabel: '白班 08:00-20:00',
    scope: '制药企业洁净区与批生产记录管理平台',
  }),
  getters: {
    operator: (state) => state.userName,
    role: (state): UserRole => findUser(state.userName)?.role ?? '操作人',
    workshop: (state) => findUser(state.userName)?.workshop ?? '',
    canOperate: (state) => state.userName.length > 0,
    userOptions: () => USERS,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchUser(name: string) {
      if (findUser(name)) {
        this.userName = name
      }
    },
  },
})
