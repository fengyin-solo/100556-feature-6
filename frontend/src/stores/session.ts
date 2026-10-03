import { defineStore } from 'pinia'

import { ORG_USERS, findUser, type OrgUser } from '@/data/org'

export const useSessionStore = defineStore('session', {
  state: () => ({
    userName: '李建国',
    shiftLabel: '白班 08:00-20:00',
    scope: '制药企业洁净区与批生产记录管理平台',
  }),
  getters: {
    currentUser(state): OrgUser {
      return findUser(state.userName) ?? ORG_USERS[0]
    },
    users: () => ORG_USERS,
    // 顶栏沿用的值班人展示，就是当前用户姓名。
    operator(state): string {
      return state.userName
    },
    canOperate(): boolean {
      return true
    },
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
