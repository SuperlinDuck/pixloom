import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

// Additive migration; the original single-owner account is retained for migration audit.
export function ensurePlatformSchema(c: DatabaseSync) {
  c.exec('BEGIN IMMEDIATE')
  try {
    const column = (table: string, name: string, definition: string) => {
      if (
        !(
          c.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).some((row) => row.name === name)
      )
        c.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
    }
    c.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        email TEXT NOT NULL, picture TEXT, role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending', creditLimit INTEGER NOT NULL DEFAULT 0,
        accessExpiresAt INTEGER, createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY, codeHash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        creditLimit INTEGER NOT NULL, accessDays INTEGER NOT NULL, maxUses INTEGER NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0, expiresAt INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invitation_redemptions (
        userId TEXT PRIMARY KEY REFERENCES users(id), invitationId TEXT NOT NULL REFERENCES invitations(id), redeemedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS platform_rates (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_ledger (
        id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id), userId TEXT REFERENCES users(id),
        provider TEXT NOT NULL, model TEXT NOT NULL, day TEXT NOT NULL,
        inputReserved INTEGER NOT NULL, outputReserved INTEGER NOT NULL, creditsReserved INTEGER NOT NULL,
        inputTokens INTEGER, outputTokens INTEGER, credits INTEGER,
        status TEXT NOT NULL DEFAULT 'reserved', createdAt INTEGER NOT NULL, settledAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS ledger_user ON usage_ledger(userId, status);
      CREATE INDEX IF NOT EXISTS ledger_day ON usage_ledger(day, status);
      CREATE INDEX IF NOT EXISTS ledger_task ON usage_ledger(taskId);
      CREATE TABLE IF NOT EXISTS preview_grants (
        tokenHash TEXT PRIMARY KEY, artifactId TEXT NOT NULL REFERENCES preview_artifacts(id) ON DELETE CASCADE,
        userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL
      );
    `)
    c.exec(
      'CREATE INDEX IF NOT EXISTS preview_grants_user ON preview_grants(userId,expiresAt)',
    )
    column('usage_ledger', 'inputWeight', 'INTEGER NOT NULL DEFAULT 1')
    column('usage_ledger', 'outputWeight', 'INTEGER NOT NULL DEFAULT 4')
    column('preview_grants', 'sessionHash', 'TEXT')
    column('worker', 'releaseSha', 'TEXT')
    column('projects', 'ownerId', 'TEXT REFERENCES users(id)')
    column('auth_sessions', 'userId', 'TEXT REFERENCES users(id)')
    column('cloud_connections', 'ownerId', 'TEXT REFERENCES users(id)')
    c.exec('CREATE INDEX IF NOT EXISTS projects_owner ON projects(ownerId)')
    const legacy = c.prepare('SELECT * FROM auth_account WHERE id=1').get() as
      | { subject: string; name: string; email: string; picture: string | null }
      | undefined
    if (legacy) {
      c.prepare(
        `INSERT OR IGNORE INTO users (id,subject,name,email,picture,role,status,creditLimit,createdAt) VALUES (?,?,?,?,?,'admin','active',1000000000,?)`,
      ).run(
        randomUUID(),
        legacy.subject,
        legacy.name,
        legacy.email,
        legacy.picture,
        Date.now(),
      )
      const user = c
        .prepare('SELECT id FROM users WHERE subject=?')
        .get(legacy.subject) as { id: string }
      c.prepare('UPDATE auth_sessions SET userId=? WHERE userId IS NULL').run(
        user.id,
      )
      c.prepare('UPDATE projects SET ownerId=? WHERE ownerId IS NULL').run(
        user.id,
      )
      c.prepare(
        'UPDATE cloud_connections SET ownerId=? WHERE ownerId IS NULL',
      ).run(user.id)
    }
    c.exec('COMMIT')
  } catch (error) {
    c.exec('ROLLBACK')
    throw error
  }
}
