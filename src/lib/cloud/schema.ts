import { CloudDefinitionError } from './errors'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { db, StoreError } from '../store'
import { supabaseRequest } from './api'
import { managementToken, type CloudExecution } from './provision'
import { resource } from './store'
import type { CloudEnvironment } from './types'
import type { SourceFile } from '../types'

export const CLOUD_SCHEMA_PATH = 'src/pixloom-schema.json'
const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .refine((name) => !name.startsWith('pg_') && !name.startsWith('pixloom_'))
const columnSchema = z
  .object({
    name: identifier.refine(
      (name) => !['id', 'owner_id', 'created_at'].includes(name),
    ),
    type: z.enum([
      'text',
      'integer',
      'numeric',
      'boolean',
      'timestamptz',
      'jsonb',
    ]),
  })
  .strict()
export const cloudSchema = z
  .object({
    buckets: z
      .array(identifier)
      .max(8)
      .default([])
      .refine((names) => new Set(names).size === names.length),
    tables: z
      .array(
        z
          .object({
            name: identifier,
            columns: z
              .array(columnSchema)
              .min(1)
              .max(24)
              .refine(
                (cols) =>
                  new Set(cols.map((col) => col.name)).size === cols.length,
              ),
          })
          .strict(),
      )
      .max(16)
      .refine(
        (tables) =>
          new Set(tables.map((table) => table.name)).size === tables.length,
      ),
  })
  .strict()
export type AppSchema = z.input<typeof cloudSchema>
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const quote = (name: string) => `"${name}"`
export function schemaFromFiles(files: SourceFile[]) {
  const file = files.find((file) => file.path === CLOUD_SCHEMA_PATH)
  if (!file) return null
  try {
    return cloudSchema.parse(JSON.parse(file.content))
  } catch {
    throw new CloudDefinitionError(
      'src/pixloom-schema.json 结构无效；只允许 tables/name/columns/name/type',
      400,
    )
  }
}
export function compileSchema(input: AppSchema, projectId: string) {
  const schema = cloudSchema.parse(input)
  if (!/^[a-f0-9-]{36}$/.test(projectId))
    throw new StoreError('Cloud 项目标识无效')
  const sql = [
    "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s';",
    `SELECT pg_advisory_xact_lock(hashtext('pixloom:${projectId}'));`,
    'CREATE SCHEMA IF NOT EXISTS pixloom_internal; REVOKE ALL ON SCHEMA pixloom_internal FROM PUBLIC,anon,authenticated;',
    'CREATE TABLE IF NOT EXISTS pixloom_internal.tables (name text PRIMARY KEY, project_id text NOT NULL);',
  ]
  for (const table of schema.tables) {
    const name = quote(table.name)
    sql.push(
      `DO $px$ BEGIN IF to_regclass('public.${table.name}') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pixloom_internal.tables WHERE name='${table.name}' AND project_id='${projectId}') THEN RAISE EXCEPTION 'Table is not managed by this Pixloom app'; END IF; END $px$;`,
      `CREATE TABLE IF NOT EXISTS public.${name} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now());`,
      `INSERT INTO pixloom_internal.tables VALUES ('${table.name}','${projectId}') ON CONFLICT DO NOTHING;`,
    )
    for (const col of table.columns) {
      sql.push(
        `ALTER TABLE public.${name} ADD COLUMN IF NOT EXISTS ${quote(col.name)} ${col.type};`,
        `DO $px$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.${table.name}'::regclass AND attname='${col.name}' AND NOT attisdropped AND atttypid='${col.type}'::regtype) THEN RAISE EXCEPTION 'Column type changes require a manual migration'; END IF; END $px$;`,
      )
    }
    sql.push(
      `ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;`,
      `REVOKE ALL ON public.${name} FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON public.${name} TO authenticated;`,
      `DROP POLICY IF EXISTS pixloom_owner_guard ON public.${name}; CREATE POLICY pixloom_owner_guard ON public.${name} AS RESTRICTIVE FOR ALL TO authenticated USING ((select auth.uid())=owner_id) WITH CHECK ((select auth.uid())=owner_id);`,
      `DROP POLICY IF EXISTS pixloom_owner ON public.${name}; CREATE POLICY pixloom_owner ON public.${name} FOR ALL TO authenticated USING ((select auth.uid())=owner_id) WITH CHECK ((select auth.uid())=owner_id);`,
    )
  }
  if (schema.buckets.length)
    sql.push(
      'CREATE TABLE IF NOT EXISTS pixloom_internal.buckets (name text PRIMARY KEY, project_id text NOT NULL);',
    )
  for (const bucket of schema.buckets) {
    const actual = `px-${projectId.replaceAll('-', '').slice(0, 16)}-${bucket}`
    const policy = quote(`px_${hash(actual).slice(0, 20)}`)
    const guard = quote(`px_guard_${hash(actual).slice(0, 20)}`)
    sql.push(
      `DO $px$ BEGIN IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='${actual}') AND NOT EXISTS (SELECT 1 FROM pixloom_internal.buckets WHERE name='${actual}' AND project_id='${projectId}') THEN RAISE EXCEPTION 'Bucket is not managed by this app'; END IF; END $px$;`,
      `INSERT INTO storage.buckets (id,name,public,file_size_limit) VALUES ('${actual}','${actual}',false,2097152) ON CONFLICT(id) DO NOTHING;`,
      `INSERT INTO pixloom_internal.buckets VALUES ('${actual}','${projectId}') ON CONFLICT DO NOTHING;`,
      `UPDATE storage.buckets SET public=false WHERE id='${actual}';`,
      `DROP POLICY IF EXISTS ${guard} ON storage.objects; CREATE POLICY ${guard} ON storage.objects AS RESTRICTIVE FOR ALL TO PUBLIC USING (bucket_id <> '${actual}' OR ((select auth.uid()) IS NOT NULL AND (storage.foldername(name))[1]=(select auth.uid())::text)) WITH CHECK (bucket_id <> '${actual}' OR ((select auth.uid()) IS NOT NULL AND (storage.foldername(name))[1]=(select auth.uid())::text));`,
      `DROP POLICY IF EXISTS ${policy} ON storage.objects; CREATE POLICY ${policy} ON storage.objects FOR ALL TO authenticated USING (bucket_id='${actual}' AND (storage.foldername(name))[1]=(select auth.uid())::text) WITH CHECK (bucket_id='${actual}' AND (storage.foldername(name))[1]=(select auth.uid())::text);`,
    )
  }
  sql.push("NOTIFY pgrst, 'reload schema';")
  return sql.join('\n')
}
export async function applySchema(
  projectId: string,
  environment: CloudEnvironment,
  schema: AppSchema,
  execution: CloudExecution,
) {
  const row = resource(projectId, environment)
  if (!row.ref || row.status !== 'ready')
    throw new StoreError('云资源未就绪', 409)
  const sql = compileSchema(schema, projectId),
    digest = hash(sql)
  const previous = db()
    .prepare(
      "SELECT hash FROM cloud_deployments WHERE ref=? AND kind='schema' AND name='app'",
    )
    .get(row.ref) as { hash: string } | undefined
  if (previous?.hash === digest)
    return {
      ok: true,
      tables: schema.tables.map((table) => table.name),
      reused: true,
    }
  execution.check()
  const token = await managementToken(projectId, execution.signal)
  execution.check()
  // Supabase's migration endpoint wraps the generated SQL in a transaction and records migration history.
  await supabaseRequest(token, `/v1/projects/${row.ref}/database/migrations`, {
    method: 'POST',
    body: { name: `pixloom_${digest.slice(0, 20)}`, query: sql },
    signal: execution.signal,
  })
  execution.check()
  db()
    .prepare(
      "INSERT INTO cloud_deployments VALUES (?,'schema','app',?,?) ON CONFLICT(ref,kind,name) DO UPDATE SET hash=excluded.hash,updatedAt=excluded.updatedAt",
    )
    .run(row.ref, digest, new Date().toISOString())
  return {
    ok: true,
    tables: schema.tables.map((table) => table.name),
    reused: false,
  }
}
export async function inspectSchema(projectId: string, signal: AbortSignal) {
  const row = resource(projectId, 'development')
  if (!row.ref || row.status !== 'ready')
    throw new StoreError('开发后端尚未就绪', 409)
  const token = await managementToken(projectId, signal)
  return supabaseRequest(token, `/v1/projects/${row.ref}/database/query`, {
    method: 'POST',
    body: {
      query:
        "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position LIMIT 400",
      read_only: true,
    },
    signal,
  })
}
