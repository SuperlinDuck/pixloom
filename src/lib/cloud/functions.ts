import { CloudDefinitionError } from './errors'
import { parse } from 'acorn'
import { createHash } from 'node:crypto'
import { StoreError, db } from '../store'
import type { SourceFile } from '../types'
import { supabaseRequest } from './api'
import { managementToken, type CloudExecution } from './provision'
import { resource } from './store'
import { projectOrigin } from './config'
import type { CloudEnvironment } from './types'

export function appFunctions(files: SourceFile[]) {
  const functions = files
    .filter((file) => file.path.startsWith('src/backend/functions/'))
    .map((file) => {
      const match = file.path.match(
        /^src\/backend\/functions\/([a-z][a-z0-9-]{0,31})\.js$/,
      )
      if (!match || Buffer.byteLength(file.content) > 64000)
        throw new CloudDefinitionError(
          '后端函数必须是 src/backend/functions/<name>.js，最多 64 KiB',
        )
      try {
        const ast = parse(file.content, {
          ecmaVersion: 'latest',
          sourceType: 'module',
        })
        if (!ast.body.some((node) => node.type === 'ExportDefaultDeclaration'))
          throw new Error('missing default export')
      } catch {
        throw new CloudDefinitionError(
          `后端函数 ${match[1]} JavaScript 语法无效`,
        )
      }
      const hash = createHash('sha256')
        .update('pixloom-function-v1\n' + file.content)
        .digest('hex')
      return {
        name: match[1],
        slug: `px-${match[1]}-${hash.slice(0, 12)}`,
        hash,
        source: file.content,
      }
    })
  if (functions.length > 8)
    throw new CloudDefinitionError('每个版本最多 8 个后端函数')
  return functions
}
export async function deployFunctions(
  projectId: string,
  environment: CloudEnvironment,
  files: SourceFile[],
  execution: CloudExecution,
) {
  const functions = appFunctions(files)
  if (!functions.length) return {}
  const row = resource(projectId, environment)
  if (!row.ref || !row.publishableKey || row.status !== 'ready')
    throw new StoreError('云后端未就绪', 409)
  const token = await managementToken(projectId, execution.signal)
  for (const fn of functions) {
    execution.check()
    if (
      db()
        .prepare(
          "SELECT hash FROM cloud_deployments WHERE ref=? AND kind='function' AND name=? AND hash=?",
        )
        .get(row.ref, fn.slug, fn.hash)
    )
      continue
    // The platform entrypoint verifies the app user's token before executing generated business logic.
    const wrapper = `import handler from './handler.js';\nconst origin=${JSON.stringify(projectOrigin(row.ref))};\nconst key=${JSON.stringify(row.publishableKey)};\nconst cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};\nDeno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return new Response('Method not allowed',{status:405,headers:cors});const authorization=req.headers.get('authorization')||'';const identity=await fetch(origin+'/auth/v1/user',{headers:{apikey:key,authorization},redirect:'error'});if(!identity.ok)return new Response('Unauthorized',{status:401,headers:cors});try{const result=await handler(req,{user:await identity.json(),supabaseUrl:origin,authorization,publishableKey:key});const raw=result instanceof Response?result:Response.json(result);const response=new Response(raw.body,{status:raw.status,statusText:raw.statusText,headers:new Headers(raw.headers)});for(const [name,value]of Object.entries(cors))response.headers.set(name,value);return response;}catch{return new Response('Function execution failed',{status:500,headers:cors});}});\n`
    const form = new FormData()
    form.append(
      'metadata',
      JSON.stringify({
        name: fn.slug,
        entrypoint_path: 'index.ts',
        verify_jwt: false,
      }),
    )
    form.append(
      'file',
      new Blob([wrapper], { type: 'application/typescript' }),
      'index.ts',
    )
    form.append(
      'file',
      new Blob([fn.source], { type: 'text/javascript' }),
      'handler.js',
    )
    const deployed = await supabaseRequest<{ status: string }>(
      token,
      `/v1/projects/${row.ref}/functions/deploy?slug=${fn.slug}`,
      { method: 'POST', body: form, signal: execution.signal },
    )
    execution.check()
    if (deployed?.status !== 'ACTIVE')
      throw new StoreError('后端函数未进入 ACTIVE 状态，请修复后重试', 409)
    db()
      .prepare(
        "INSERT INTO cloud_deployments VALUES (?,'function',?,?,?) ON CONFLICT(ref,kind,name) DO UPDATE SET hash=excluded.hash,updatedAt=excluded.updatedAt",
      )
      .run(row.ref, fn.slug, fn.hash, new Date().toISOString())
  }
  return Object.fromEntries(functions.map((fn) => [fn.name, fn.slug]))
}
