import { z } from 'zod'

export const browserStepSchema = z
  .object({
    action: z.enum([
      'click',
      'fill',
      'select',
      'press',
      'check',
      'uncheck',
      'assert_text',
      'assert_count',
      'assert_visible',
      'assert_hidden',
      'assert_value',
      'assert_checked',
    ]),
    selector: z.string().min(1).max(240),
    value: z.string().max(1000),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (
      step.action === 'press' &&
      !['Enter', 'Escape', 'Tab', 'Space', 'ArrowDown', 'ArrowUp'].includes(
        step.value,
      )
    )
      ctx.addIssue({ code: 'custom', message: '不支持此按键' })
    if (
      step.action === 'assert_count' &&
      !/^(0|[1-9]\d{0,3})$/.test(step.value)
    )
      ctx.addIssue({ code: 'custom', message: '数量必须为 0–9999 的整数' })
    if (
      step.action === 'assert_checked' &&
      !['true', 'false'].includes(step.value)
    )
      ctx.addIssue({ code: 'custom', message: '勾选状态必须为 true 或 false' })
  })
export const browserTestSchema = z
  .object({
    steps: z
      .array(browserStepSchema)
      .min(1)
      .max(30)
      .refine(
        (steps) => steps.some((step) => step.action.startsWith('assert_')),
        '行为测试必须包含至少一个断言',
      ),
  })
  .strict()
export type BrowserStep = z.infer<typeof browserStepSchema>
export type BrowserReport = {
  ok: boolean
  output: string
  completedSteps: number
}
