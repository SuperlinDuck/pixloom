import { loadEnvConfig } from '@next/env'
import {
  createInvitation,
  dailyUsage,
  usageSummary,
  userById,
} from '../src/lib/tenancy'
import { cancelTask, db, StoreError, transaction } from '../src/lib/store'
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')
const [command, ...args] = process.argv.slice(2)
const number = (raw: string | undefined, maximum = 1e12) => {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new StoreError('数字参数无效')
  return value
}
function main() {
  switch (command) {
    case 'ai:pause':
    case 'ai:resume': {
      db()
        .prepare(
          "INSERT INTO platform_settings VALUES ('ai_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(command === 'ai:pause' ? '0' : '1')
      if (command === 'ai:pause')
        for (const task of db()
          .prepare(
            "SELECT id FROM tasks WHERE kind='agent' AND status IN ('queued','running')",
          )
          .all() as { id: string }[])
          cancelTask(task.id)
      return { ok: true }
    }
    case 'users':
      return db()
        .prepare(
          'SELECT id,name,email,role,status,creditLimit,accessExpiresAt FROM users ORDER BY createdAt',
        )
        .all()
    case 'usage':
      return args[0] ? usageSummary(args[0]) : dailyUsage()
    case 'invite:create': {
      const options = Object.fromEntries(
        args
          .filter((arg) => arg.startsWith('--'))
          .map((arg) => {
            const at = arg.indexOf('=')
            if (at < 0) throw new StoreError('选项格式为 --name=value')
            return [arg.slice(2, at), arg.slice(at + 1)]
          }),
      )
      for (const key of Object.keys(options))
        if (!['label', 'credits', 'days', 'uses', 'expiresDays'].includes(key))
          throw new StoreError(`未知选项 ${key}`)
      return createInvitation({
        label: options.label,
        ...Object.fromEntries(
          Object.entries(options)
            .filter(([key]) => key !== 'label')
            .map(([key, value]) => [key, number(value)]),
        ),
      })
    }
    case 'invites':
      return db()
        .prepare(
          'SELECT id,label,creditLimit,accessDays,maxUses,uses,expiresAt,disabled FROM invitations ORDER BY createdAt DESC',
        )
        .all()
    case 'invite:disable': {
      if (
        !db()
          .prepare('UPDATE invitations SET disabled=1 WHERE id=?')
          .run(args[0] || '').changes
      )
        throw new StoreError('邀请码不存在')
      return { ok: true }
    }
    case 'user:disable':
    case 'user:enable': {
      const user = userById(args[0] || '')
      if (
        user.role === 'admin' &&
        command === 'user:disable' &&
        (
          db()
            .prepare(
              "SELECT count(*) AS n FROM users WHERE role='admin' AND status='active'",
            )
            .get() as { n: number }
        ).n <= 1
      )
        throw new StoreError('不能停用最后一个管理员')
      db()
        .prepare('UPDATE users SET status=? WHERE id=?')
        .run(
          command === 'user:disable'
            ? 'disabled'
            : user.creditLimit > 0
              ? 'active'
              : 'pending',
          user.id,
        )
      if (command === 'user:disable') {
        db().prepare('DELETE FROM auth_sessions WHERE userId=?').run(user.id)
        const tasks = db()
          .prepare(
            "SELECT t.id FROM tasks t JOIN projects p ON p.id=t.projectId WHERE p.ownerId=? AND t.status IN ('queued','running')",
          )
          .all(user.id) as { id: string }[]
        for (const task of tasks) cancelTask(task.id)
      }
      return { ok: true }
    }
    case 'credits:add': {
      userById(args[0] || '')
      const credits = number(args[1])
      if (
        !db()
          .prepare(
            'UPDATE users SET creditLimit=creditLimit+? WHERE id=? AND creditLimit+?<=1000000000000',
          )
          .run(credits, args[0], credits).changes
      )
        throw new StoreError('额度超过上限')
      return usageSummary(args[0])
    }
    case 'access:extend': {
      userById(args[0] || '')
      const days = number(args[1], 3650)
      db()
        .prepare(
          'UPDATE users SET accessExpiresAt=MAX(COALESCE(accessExpiresAt,?),?)+? WHERE id=?',
        )
        .run(Date.now(), Date.now(), days * 86400000, args[0])
      return usageSummary(args[0])
    }
    case 'task:cancel': {
      const task = cancelTask(args[0] || '')
      return { id: task.id, status: task.status }
    }
    case 'ledger':
      return db()
        .prepare(
          `SELECT id,taskId,userId,provider,model,status,inputReserved,outputReserved,creditsReserved,inputTokens,outputTokens,credits,createdAt FROM usage_ledger WHERE status='reserved' ORDER BY createdAt`,
        )
        .all()
    case 'ledger:settle': {
      const input = number(args[1]),
        output = number(args[2])
      return transaction(() => {
        const row = db()
          .prepare(
            `SELECT l.inputWeight,l.outputWeight FROM usage_ledger l JOIN tasks t ON t.id=l.taskId WHERE l.id=? AND l.status='reserved' AND t.status NOT IN ('queued','running')`,
          )
          .get(args[0] || '') as
          { inputWeight: number; outputWeight: number } | undefined
        if (!row) throw new StoreError('待核对记录不存在或任务尚未结束')
        if (
          !Number.isSafeInteger(
            input * row.inputWeight + output * row.outputWeight,
          )
        )
          throw new StoreError('用量超过安全整数范围')
        db()
          .prepare(
            "UPDATE usage_ledger SET inputTokens=?,outputTokens=?,credits=?,status='settled',settledAt=? WHERE id=? AND status='reserved'",
          )
          .run(
            input,
            output,
            input * row.inputWeight + output * row.outputWeight,
            Date.now(),
            args[0],
          )
        return { ok: true }
      })
    }
    default:
      throw new StoreError(
        '命令：ai:pause | ai:resume | users | usage [userId] | invite:create [--credits=2000000 --days=30 --uses=1 --expiresDays=7 --label=内测] | invites | invite:disable <id> | user:disable <id> | user:enable <id> | credits:add <id> <credits> | access:extend <id> <days> | task:cancel <id> | ledger | ledger:settle <id> <inputTokens> <outputTokens>',
      )
  }
}
try {
  console.log(JSON.stringify(main(), null, 2))
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  db().close()
}
