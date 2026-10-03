// 生产工序目录：全厂统一口径，只维护这一份。
// 批生产记录的登记、重填、提交校验等入口都从这里取，谁要改工序范围就改这里。
export const PROCESS_STEPS: string[] = [
  '配料',
  '制粒',
  '干燥',
  '总混',
  '压片',
  '包衣',
  '铝塑包装',
  '外包装',
]

export function isKnownProcessStep(step: string): boolean {
  return PROCESS_STEPS.includes(step.trim())
}
