// 车间与人员目录：批生产记录的归属、权限判断都按这份名单来。
export const WORKSHOPS: string[] = ['固体制剂一车间', '固体制剂二车间', '无菌制剂车间']

export type UserRole = '车间主任' | '操作人' | '复核人'

export type WorkshopUser = {
  name: string
  role: UserRole
  workshop: string
}

export const USERS: WorkshopUser[] = [
  { name: '王建国', role: '车间主任', workshop: '固体制剂一车间' },
  { name: '李国强', role: '操作人', workshop: '固体制剂一车间' },
  { name: '张丽华', role: '复核人', workshop: '固体制剂一车间' },
  { name: '刘志远', role: '车间主任', workshop: '固体制剂二车间' },
  { name: '赵永刚', role: '操作人', workshop: '固体制剂二车间' },
  { name: '陈静', role: '复核人', workshop: '固体制剂二车间' },
]

export function findUser(name: string): WorkshopUser | undefined {
  return USERS.find((user) => user.name === name)
}
