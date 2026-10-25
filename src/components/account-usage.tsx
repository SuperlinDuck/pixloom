import type { AccountSession } from '@/lib/auth-types'

// Presentation only: the ledger and all limits retain their integer units.
const unitsPerPoint = 1_000
const points = (units: number) => {
  const value = units / unitsPerPoint
  if (value > 0 && value < 0.01) return '<0.01'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function AccountUsage({
  usage,
}: {
  usage: NonNullable<AccountSession['usage']>
}) {
  const remaining = Math.max(0, usage.remainingCredits)
  const total = Math.max(0, usage.creditLimit)
  const percentage = total > 0 ? Math.min(100, (remaining / total) * 100) : 0
  const balance = `${points(remaining)} / ${points(total)} 积分`
  return (
    <div className="account-usage">
      <p className="account-points-label">积分余额</p>
      <p className="account-points-balance">
        <strong>{points(remaining)}</strong>
        <span>/ {points(total)}</span>
      </p>
      <div
        className="account-points-track"
        role="progressbar"
        aria-label="剩余积分"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(percentage.toFixed(2))}
        aria-valuetext={balance}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      {usage.accessExpiresAt && (
        <p className="account-points-expiry">
          {new Date(usage.accessExpiresAt).toLocaleDateString('zh-CN')} 到期
          {usage.accessExpiresAt <= Date.now() ? '，请联系管理员' : ''}
        </p>
      )}
    </div>
  )
}
