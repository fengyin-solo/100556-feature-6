// 组织架构：车间、岗位与演示用户。批生产记录的权限判断都拿这份名单说话。
export type Role = 'operator' | 'reviewer' | 'director'

export type OrgUser = {
  name: string
  role: Role
  roleLabel: string
  workshop: string
}

export const WORKSHOPS = ['冻干车间', '灌装车间', '固体制剂车间'] as const

export const ORG_USERS: OrgUser[] = [
  { name: '王主任', role: 'director', roleLabel: '车间主任', workshop: '冻干车间' },
  { name: '李建国', role: 'operator', roleLabel: '操作人', workshop: '冻干车间' },
  { name: '孙文', role: 'reviewer', roleLabel: '复核人', workshop: '冻干车间' },
  { name: '赵强', role: 'operator', roleLabel: '操作人', workshop: '灌装车间' },
  { name: '周敏', role: 'reviewer', roleLabel: '复核人', workshop: '灌装车间' },
  { name: '钱伟', role: 'operator', roleLabel: '操作人', workshop: '固体制剂车间' },
  { name: '吴芳', role: 'reviewer', roleLabel: '复核人', workshop: '固体制剂车间' },
]

export function findUser(name: string): OrgUser | undefined {
  return ORG_USERS.find((user) => user.name === name)
}
