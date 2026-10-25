import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountUsage } from '../src/components/account-usage'
import type { AccountSession } from '../src/lib/auth-types'

const usage: NonNullable<AccountSession['usage']> = {
  creditLimit: 1_000_000_000,
  remainingCredits: 999_601_653,
  usedCredits: 398_347,
  reservedCredits: 0,
  inputTokens: 260_767,
  outputTokens: 34_395,
  accessExpiresAt: null,
}
const render = (overrides: Partial<typeof usage> = {}) =>
  renderToStaticMarkup(
    createElement(AccountUsage, {
      usage: { ...usage, ...overrides },
    }),
  )

describe('account points presentation', () => {
  it('shows the remaining points and total with a proportional balance bar', () => {
    const html = render()
    expect(html).toContain('<strong>999,601.65</strong>')
    expect(html).toContain('<span>/ 1,000,000</span>')
    expect(html).toContain('aria-valuenow="99.96"')
    expect(html).toContain('aria-valuetext="999,601.65 / 1,000,000 积分"')
    expect(html).not.toContain('tokens')
    expect(html).not.toContain('积分说明')
    expect(html).not.toContain('累计消耗')
    expect(html).not.toContain('预留中')
  })

  it('uses the available balance after reservations for the progress bar', () => {
    const html = render({
      creditLimit: 2_000_000,
      usedCredits: 300_000,
      reservedCredits: 100_000,
      remainingCredits: 1_700_000,
    })
    expect(html).toContain('<strong>1,700</strong>')
    expect(html).toContain('<span>/ 2,000</span>')
    expect(html).toContain('aria-valuenow="85"')
    expect(html).toContain('width:85%')
  })

  it('distinguishes tiny positive balances from empty accounts and bounds the bar', () => {
    const tiny = render({ remainingCredits: 1, usedCredits: 9 })
    expect(tiny).toContain('<strong>&lt;0.01</strong>')
    const empty = render({
      remainingCredits: 0,
      creditLimit: 0,
      usedCredits: 0,
    })
    expect(empty).toContain('<strong>0</strong>')
    expect(empty).toContain('aria-valuenow="0"')
    expect(empty).not.toContain('NaN')
    expect(render({ remainingCredits: 3_000, creditLimit: 2_000 })).toContain(
      'aria-valuenow="100"',
    )
  })
})
