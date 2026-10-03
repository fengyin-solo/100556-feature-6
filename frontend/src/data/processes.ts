// 生产工序字典：登记、分配、校验几个入口共用这一份，别处不再各自维护一份工序清单。
export const PRODUCTION_PROCESSES = [
  '配料',
  '制粒',
  '压片',
  '包衣',
  '灌装',
  '冻干',
  '灯检',
  '包装',
] as const

export function isKnownProcess(name: string): boolean {
  return (PRODUCTION_PROCESSES as readonly string[]).includes(name)
}
