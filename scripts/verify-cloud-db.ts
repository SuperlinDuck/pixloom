import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { compileSchema } from '../src/lib/cloud/schema'
import { dockerCommand } from '../src/lib/runtime/docker'

async function main() {
  const name = `pixloom-cloud-db-test-${randomUUID()}`
  const projectId = randomUUID(),
    userA = randomUUID(),
    userB = randomUUID()
  const bucket = `px-${projectId.replaceAll('-', '').slice(0, 16)}-uploads`
  const image = process.env.PIXLOOM_TEST_POSTGRES_IMAGE || 'postgres:17-alpine'
  const call = async (args: string[], input?: string) => {
    const result = await dockerCommand(args, { input, timeout: 90000 })
    assert.equal(result.code, 0, result.stderr.slice(-3000))
    return result.stdout.trim()
  }
  const sql = (query: string) =>
    call(
      [
        'exec',
        '-i',
        name,
        'psql',
        '-U',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
      ],
      query,
    )
  try {
    await call([
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'dev.pixloom.test=cloud-db',
      '--network',
      'none',
      '--memory',
      '256m',
      '--cpus',
      '1',
      '--pids-limit',
      '100',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=128m',
      '-e',
      `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`,
      image,
    ])
    let ready = false
    for (let i = 0; i < 40; i++) {
      const result = await dockerCommand([
        'exec',
        name,
        'pg_isready',
        '-U',
        'postgres',
      ])
      if (result.code === 0) {
        ready = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    assert.ok(ready, 'PostgreSQL did not become ready')
    await sql(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO PUBLIC;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      INSERT INTO auth.users VALUES ('${userA}'),('${userB}');
      CREATE SCHEMA storage; GRANT USAGE ON SCHEMA storage TO PUBLIC;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;
      CREATE POLICY existing_broad_policy ON storage.objects FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
      CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(regexp_replace(name,'/[^/]*$',''),'/') $$;`)
    const schema = {
      tables: [
        { name: 'todos', columns: [{ name: 'title', type: 'text' as const }] },
      ],
      buckets: ['uploads'],
    }
    await sql('BEGIN;' + compileSchema(schema, projectId) + 'COMMIT;')
    const asUser = (user: string, query: string) =>
      sql(
        `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${user}'; ${query}; COMMIT;`,
      )
    await asUser(userA, "INSERT INTO public.todos(title) VALUES ('A task')")
    await asUser(userB, "INSERT INTO public.todos(title) VALUES ('B task')")
    assert.ok(
      (await asUser(userA, 'SELECT title FROM public.todos')).includes(
        'A task',
      ),
    )
    assert.ok(
      !(await asUser(userA, 'SELECT title FROM public.todos')).includes(
        'B task',
      ),
    )
    await asUser(
      userA,
      "UPDATE public.todos SET title='stolen' WHERE title='B task'",
    )
    assert.ok(
      (await asUser(userB, 'SELECT title FROM public.todos')).includes(
        'B task',
      ),
    )
    const forbidden = await dockerCommand(
      [
        'exec',
        '-i',
        name,
        'psql',
        '-U',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
      ],
      {
        input: `BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${userA}'; INSERT INTO public.todos(owner_id,title) VALUES ('${userB}','forged');COMMIT;`,
      },
    )
    assert.notEqual(forbidden.code, 0, 'forged ownership should fail')
    await asUser(
      userA,
      `INSERT INTO storage.objects(bucket_id,name) VALUES ('${bucket}','${userA}/one.txt')`,
    )
    assert.ok(
      !(await asUser(userB, 'SELECT name FROM storage.objects')).includes(
        'one.txt',
      ),
      'existing permissive storage policy must not bypass the guard',
    )
    const anon = await sql(
      'BEGIN;SET LOCAL ROLE anon;SELECT count(*) FROM storage.objects;COMMIT;',
    )
    assert.ok(
      anon.includes('\n0\n'),
      'anonymous user must not read protected storage',
    )
    const extended = {
      ...schema,
      tables: [
        {
          name: 'todos',
          columns: [
            { name: 'title', type: 'text' as const },
            { name: 'category', type: 'text' as const },
          ],
        },
      ],
    }
    await sql('BEGIN;' + compileSchema(extended, projectId) + 'COMMIT;')
    assert.ok(
      (await asUser(userA, 'SELECT title FROM public.todos')).includes(
        'A task',
      ),
      'additive migration must preserve existing data',
    )
    await sql('BEGIN;' + compileSchema(schema, projectId) + 'COMMIT;')
    assert.ok(
      (
        await sql(
          "SELECT column_name FROM information_schema.columns WHERE table_name='todos'",
        )
      ).includes('category'),
      'restoring old code must not drop later columns',
    )
    const conflict = await dockerCommand(
      [
        'exec',
        '-i',
        name,
        'psql',
        '-U',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
      ],
      {
        input:
          'BEGIN;' +
          compileSchema(
            {
              tables: [
                {
                  name: 'todos',
                  columns: [{ name: 'title', type: 'integer' }],
                },
              ],
            },
            projectId,
          ) +
          'COMMIT;',
      },
    )
    assert.notEqual(conflict.code, 0, 'type-changing migration must fail')
    assert.ok(
      (await asUser(userB, 'SELECT title FROM public.todos')).includes(
        'B task',
      ),
    )
    console.log(
      'Cloud PostgreSQL verification passed: migrations, CRUD ownership, forged owners, storage guard, data preservation and old-code compatibility.',
    )
  } finally {
    const info = await dockerCommand([
      'inspect',
      '--format',
      '{{ index .Config.Labels "dev.pixloom.test" }}',
      name,
    ]).catch(() => null)
    if (info?.code === 0 && info.stdout.trim() === 'cloud-db')
      await dockerCommand(['rm', '-f', name])
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
