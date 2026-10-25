import { createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { db, StoreError } from '../store'
import { unseal } from './crypto'
import { CloudDefinitionError } from './errors'
import type { AppSchema } from './schema'
import { sharedPoolConfig } from './shared-config'
import {
  environmentConfig,
  reserveSharedEnvironment,
  sharedEnvironment,
  sharedState,
  type SharedEnvironment,
} from './shared-store'
import type { CloudEnvironment } from './types'
import type { CloudExecution } from './provision'

type Entry = {
  pool: Pool
  active: number
  used: number
  environment: CloudEnvironment
}
const connections = new Map<string, Entry>()
export const quoteIdentifier = (name: string) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name))
    throw new StoreError('数据库标识无效')
  return `"${name}"`
}
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'"
function poolFor(environment: CloudEnvironment, row?: SharedEnvironment) {
  const config = row ? environmentConfig(row) : sharedPoolConfig(environment)
  const url = new URL(config.databaseUrl)
  if (row) {
    const original = decodeURIComponent(url.username)
    // Supavisor session connections use <role>.<project-ref> as the user.
    url.username =
      row.role + (original.endsWith('.' + config.ref) ? '.' + config.ref : '')
    url.password = unseal(row.password, `shared-role:${row.id}`)
  }
  const key = createHash('sha256').update(url.toString()).digest('hex')
  let entry = connections.get(key)
  if (!entry) {
    const entries = Array.from(connections.entries()).filter(
      ([, value]) => value.environment === environment,
    )
    if (entries.length >= config.maxConnections) {
      const idle = entries
        .filter(([, value]) => !value.active)
        .sort((a, b) => a[1].used - b[1].used)[0]
      if (!idle) throw new StoreError('共享池连接繁忙，请稍后重试', 429)
      connections.delete(idle[0])
      void idle[1].pool.end()
    }
    const pool = new Pool({
      connectionString: url.toString(),
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 8000,
      application_name: row ? 'pixloom-app' : 'pixloom-control',
    })
    pool.on('error', () => {
      /* Errors are returned through the bounded request, never log credentials. */
    })
    entry = { pool, active: 0, used: Date.now(), environment }
    connections.set(key, entry)
  }
  return entry
}
export async function closeSharedConnections() {
  const entries = Array.from(connections.values())
  connections.clear()
  await Promise.all(entries.map(({ pool }) => pool.end()))
}
export async function sharedTransaction<T>(
  environment: CloudEnvironment,
  action: (client: PoolClient) => Promise<T>,
  options: {
    row?: SharedEnvironment
    userId?: string
    signal?: AbortSignal
  } = {},
) {
  options.signal?.throwIfAborted()
  const entry = poolFor(environment, options.row)
  // Bound queues as well as sockets; a burst cannot build an unbounded pg wait list.
  if (entry.active >= 8) throw new StoreError('共享池请求繁忙', 429)
  entry.active++
  let client: PoolClient | undefined
  try {
    client = await entry.pool.connect()
    await client.query('BEGIN')
    await client.query(
      "SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='5s'; SET LOCAL search_path=pg_catalog",
    )
    if (options.row) {
      if (!options.userId || !/^[a-f0-9-]{36}$/.test(options.userId))
        throw new StoreError('请先登录', 401)
      const identity = await client.query('SELECT current_user AS role')
      if (identity.rows[0]?.role !== options.row.role)
        throw new StoreError('共享池运行角色不匹配', 503)
      await client.query("SELECT set_config('pixloom.user_id',$1,true)", [
        options.userId,
      ])
    }
    const result = await action(client)
    options.signal?.throwIfAborted()
    await client.query('COMMIT')
    return result
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    if (error instanceof StoreError || options.signal?.aborted) throw error
    // SQL errors can include row contents and connection metadata. Return only controlled text.
    const code = (error as { code?: string }).code
    if (code === 'P0001')
      throw new StoreError('应用数据额度不足，或后端结构不兼容', 409)
    if (
      ['23505', '23502', '22P02', '22003', '22007', '22008', '42804'].includes(
        code || '',
      )
    )
      throw new StoreError('记录格式无效或已存在', 400)
    throw new StoreError(
      '共享数据库不可用，请检查连接凭证、池状态或稍后重试',
      503,
    )
  } finally {
    client?.release()
    entry.active--
    entry.used = Date.now()
  }
}
export async function poolCapacity(
  environment: CloudEnvironment,
  client?: PoolClient,
) {
  const config = sharedPoolConfig(environment)
  const check = async (connection: PoolClient) => {
    const result = await connection.query(
      'SELECT pg_database_size(current_database())::text AS bytes',
    )
    const bytes = Number(result.rows[0].bytes)
    return {
      bytes,
      limit: config.maxPoolBytes,
      warning: bytes >= config.maxPoolBytes * 0.7,
      blocked: bytes >= config.maxPoolBytes * 0.85,
    }
  }
  return client ? check(client) : sharedTransaction(environment, check)
}
export const poolControlSql = `
  CREATE SCHEMA IF NOT EXISTS pixloom_pool_v2;
  REVOKE ALL ON SCHEMA pixloom_pool_v2 FROM PUBLIC;
  CREATE TABLE IF NOT EXISTS pixloom_pool_v2.environments(id uuid PRIMARY KEY,namespace text UNIQUE NOT NULL,role_name text UNIQUE NOT NULL,definition jsonb NOT NULL DEFAULT '{"tables":[],"buckets":[]}',hash text,rows bigint NOT NULL DEFAULT 0,bytes bigint NOT NULL DEFAULT 0,file_bytes bigint NOT NULL DEFAULT 0,max_rows bigint NOT NULL,max_bytes bigint NOT NULL,max_file_bytes bigint NOT NULL);
  CREATE TABLE IF NOT EXISTS pixloom_pool_v2.members(environment_id uuid NOT NULL REFERENCES pixloom_pool_v2.environments(id),user_id uuid NOT NULL,PRIMARY KEY(environment_id,user_id));
  CREATE TABLE IF NOT EXISTS pixloom_pool_v2.files(environment_id uuid NOT NULL REFERENCES pixloom_pool_v2.environments(id),user_id uuid NOT NULL,bucket text NOT NULL,path text NOT NULL,size bigint NOT NULL,state text NOT NULL,PRIMARY KEY(environment_id,user_id,bucket,path));
  REVOKE ALL ON ALL TABLES IN SCHEMA pixloom_pool_v2 FROM PUBLIC;
  DO $px$ DECLARE r text; BEGIN FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA pixloom_pool_v2 FROM %I',r);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA pixloom_pool_v2 FROM %I',r);
  END LOOP; END $px$;
`
export function compileSharedSchema(
  input: AppSchema,
  row: Pick<SharedEnvironment, 'id' | 'namespace' | 'role'>,
) {
  if (!/^[a-f0-9-]{36}$/.test(row.id)) throw new StoreError('环境标识无效')
  const schema = quoteIdentifier(row.namespace),
    role = quoteIdentifier(row.role)
  const sql: string[] = [
    `CREATE SCHEMA IF NOT EXISTS ${schema}; REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC; GRANT USAGE ON SCHEMA ${schema} TO ${role};`,
    // Per-application transactionally updated counters. All writers serialize on this row.
    `CREATE OR REPLACE FUNCTION ${schema}.pixloom_quota() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $px$
    DECLARE delta_rows bigint := 0; delta_bytes bigint := 0;
    BEGIN
      IF TG_OP='INSERT' THEN delta_rows:=1; delta_bytes:=octet_length(to_jsonb(NEW)::text);
      ELSIF TG_OP='UPDATE' THEN delta_bytes:=octet_length(to_jsonb(NEW)::text)-octet_length(to_jsonb(OLD)::text);
      ELSE delta_rows:=-1; delta_bytes:=-octet_length(to_jsonb(OLD)::text); END IF;
      UPDATE pixloom_pool_v2.environments SET rows=rows+delta_rows,bytes=bytes+delta_bytes WHERE id=${literal(row.id)}::uuid AND (delta_rows<=0 OR rows+delta_rows<=max_rows) AND (delta_bytes<=0 OR bytes+delta_bytes<=max_bytes);
      IF NOT FOUND THEN RAISE EXCEPTION 'Application quota exceeded'; END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $px$; REVOKE ALL ON FUNCTION ${schema}.pixloom_quota() FROM PUBLIC;`,
  ]
  for (const table of input.tables) {
    const name = `${schema}.${quoteIdentifier(table.name)}`
    sql.push(
      `CREATE TABLE IF NOT EXISTS ${name} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL DEFAULT nullif(current_setting('pixloom.user_id',true),'')::uuid,created_at timestamptz NOT NULL DEFAULT now());`,
    )
    for (const column of table.columns) {
      sql.push(
        `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(column.name)} ${column.type};`,
        `DO $px$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=${literal(name)}::regclass AND attname=${literal(column.name)} AND NOT attisdropped AND atttypid=${literal(column.type)}::regtype) THEN RAISE EXCEPTION 'Column type changes require manual migration'; END IF; END $px$;`,
      )
    }
    sql.push(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${name} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON ${name} FROM PUBLIC; GRANT SELECT,INSERT,UPDATE,DELETE ON ${name} TO ${role};
      DROP POLICY IF EXISTS pixloom_owner ON ${name}; CREATE POLICY pixloom_owner ON ${name} FOR ALL TO ${role} USING (owner_id=nullif(current_setting('pixloom.user_id',true),'')::uuid) WITH CHECK (owner_id=nullif(current_setting('pixloom.user_id',true),'')::uuid);
      DROP TRIGGER IF EXISTS pixloom_quota ON ${name}; CREATE TRIGGER pixloom_quota BEFORE INSERT OR UPDATE OR DELETE ON ${name} FOR EACH ROW EXECUTE FUNCTION ${schema}.pixloom_quota();`)
  }
  sql.push(`DO $px$ DECLARE r text; BEGIN FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I',${literal(row.namespace)},r);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I',${literal(row.namespace)},r);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I',${literal(row.namespace)},r);
    END LOOP; END $px$;`)
  return sql.join('\n')
}
export async function ensureSharedEnvironment(
  projectId: string,
  environment: CloudEnvironment,
  execution: CloudExecution,
) {
  execution.check()
  const row = reserveSharedEnvironment(projectId, environment)
  environmentConfig(row)
  if (
    [
      'restoring',
      'restore_failed',
      'deleting',
      'delete_failed',
      'deleted',
    ].includes(row.status)
  )
    throw new StoreError(
      '此应用环境已停用或正在恢复/删除，请先完成管理员操作或使用新应用',
      409,
    )
  if (row.status === 'ready') {
    sharedState(projectId, 'ready')
    return row
  }
  try {
    const config = environmentConfig(row)
    await sharedTransaction(
      environment,
      async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('pixloom-pool-v2-init',0))",
        )
        if ((await poolCapacity(environment, client)).blocked)
          throw new StoreError('共享池容量已达到保护阈值，无法分配新环境', 409)
        await client.query(poolControlSql)
        const role = quoteIdentifier(row.role)
        const password = unseal(row.password, `shared-role:${row.id}`)
        const found = await client.query(
          'SELECT 1 FROM pg_roles WHERE rolname=$1',
          [row.role],
        )
        const registered = await client.query(
          'SELECT role_name FROM pixloom_pool_v2.environments WHERE id=$1',
          [row.id],
        )
        if (
          !registered.rowCount &&
          Number(
            (
              await client.query(
                'SELECT count(*) AS n FROM pixloom_pool_v2.environments',
              )
            ).rows[0].n,
          ) >= config.maxApps
        )
          throw new StoreError('共享池应用名额已满', 409)
        if (found.rowCount && registered.rows[0]?.role_name !== row.role)
          throw new StoreError('共享池角色冲突，需管理员检查', 409)
        if (!found.rowCount)
          await client.query(
            `CREATE ROLE ${role} LOGIN PASSWORD ${literal(password)} NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER CONNECTION LIMIT 2`,
          )
        await client.query(
          `INSERT INTO pixloom_pool_v2.environments(id,namespace,role_name,max_rows,max_bytes,max_file_bytes) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,
          [
            row.id,
            row.namespace,
            row.role,
            config.maxRows,
            config.maxBytes,
            config.maxFileBytes,
          ],
        )
        await client.query(
          `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(row.namespace)}; REVOKE ALL ON SCHEMA ${quoteIdentifier(row.namespace)} FROM PUBLIC; GRANT USAGE ON SCHEMA ${quoteIdentifier(row.namespace)} TO ${role}`,
        )
      },
      { signal: execution.signal },
    )
    // Record successful remote side effects even when cancellation arrives immediately afterwards.
    db()
      .prepare("UPDATE cloud_environments_v2 SET status='ready' WHERE id=?")
      .run(row.id)
    sharedState(projectId, 'ready')
    execution.check()
    return sharedEnvironment(projectId, environment)!
  } catch (error) {
    sharedState(
      projectId,
      'error',
      error instanceof StoreError
        ? error.message
        : '共享池准备失败，请检查平台配置后重试',
    )
    throw error
  }
}
export async function applySharedSchema(
  projectId: string,
  environment: CloudEnvironment,
  input: AppSchema,
  execution: CloudExecution,
) {
  const row = await ensureSharedEnvironment(projectId, environment, execution)
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const operationId = `${row.id}:${hash}`
  db()
    .prepare(
      "INSERT INTO cloud_operations_v2 VALUES (?,?,?,'running',NULL,?) ON CONFLICT(id) DO UPDATE SET status='running',error=NULL,updatedAt=excluded.updatedAt",
    )
    .run(operationId, row.id, hash, Date.now())
  try {
    const definition = await sharedTransaction(
      environment,
      async (client) => {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [row.id],
        )
        const result = await client.query(
          'SELECT definition,hash FROM pixloom_pool_v2.environments WHERE id=$1 FOR UPDATE',
          [row.id],
        )
        const previous = result.rows[0]?.definition as AppSchema
        if (result.rows[0]?.hash === hash) return previous
        if ((await poolCapacity(environment, client)).blocked)
          throw new StoreError('共享池容量已达到保护阈值，暂停扩展结构', 409)
        // Keep the complete physical definition when older code is restored.
        const tables = new Map(
          previous.tables.map((table) => [table.name, table]),
        )
        for (const table of input.tables) {
          const columns = new Map(
            tables
              .get(table.name)
              ?.columns.map((column) => [column.name, column]) || [],
          )
          for (const column of table.columns) {
            const old = columns.get(column.name)
            if (old && old.type !== column.type)
              throw new CloudDefinitionError('列类型变化需要手工迁移', 400)
            columns.set(column.name, column)
          }
          tables.set(table.name, {
            name: table.name,
            columns: Array.from(columns.values()),
          })
        }
        const merged: AppSchema = {
          tables: Array.from(tables.values()),
          buckets: Array.from(
            new Set([...(previous.buckets || []), ...(input.buckets || [])]),
          ),
        }
        if (
          merged.tables.length > 16 ||
          merged.tables.some((table) => table.columns.length > 24) ||
          (merged.buckets?.length || 0) > 8
        )
          throw new CloudDefinitionError('累计后端结构超过应用额度')
        await client.query(compileSharedSchema(input, row))
        await client.query(
          'UPDATE pixloom_pool_v2.environments SET definition=$2,hash=$3 WHERE id=$1',
          [row.id, JSON.stringify(merged), hash],
        )
        return merged
      },
      { signal: execution.signal },
    )
    db()
      .prepare(
        'UPDATE cloud_environments_v2 SET definition=?,hash=? WHERE id=?',
      )
      .run(JSON.stringify(definition), hash, row.id)
    db()
      .prepare(
        "UPDATE cloud_operations_v2 SET status='completed',updatedAt=? WHERE id=?",
      )
      .run(Date.now(), operationId)
    execution.check()
    return { ok: true, tables: input.tables.map((table) => table.name) }
  } catch (error) {
    db()
      .prepare(
        "UPDATE cloud_operations_v2 SET status='retryable',error='迁移未确认，请重试',updatedAt=? WHERE id=?",
      )
      .run(Date.now(), operationId)
    throw error
  }
}
export async function inspectSharedSchema(
  projectId: string,
  signal?: AbortSignal,
) {
  const row = sharedEnvironment(projectId, 'development')
  if (!row || row.status !== 'ready')
    throw new StoreError('开发后端尚未就绪', 409)
  return sharedTransaction(
    'development',
    async (client) =>
      (
        await client.query(
          'SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position LIMIT 500',
          [row.namespace],
        )
      ).rows,
    { signal },
  )
}
