import { randomBytes } from 'node:crypto'
import { workspaceOrigin } from '../workspace-origin'
import { liveRelease } from '../publication/store'
import { sharedApp, sharedEnvironment } from './shared-store'
import { db, StoreError } from '../store'
import { artifactManifest } from './manifest'
import type { CloudEnvironment } from './types'

export const EMAIL_CONFIRMATION_PATH = '/cloud/auth/confirmed'

export function emailConfirmationUrl(
  projectId: string,
  environment: CloudEnvironment,
  generation: string,
  previewArtifactId?: string,
) {
  const artifactId =
    environment === 'development'
      ? confirmationArtifact(projectId, generation, previewArtifactId)
      : undefined
  if (environment !== 'development' && previewArtifactId !== undefined)
    throw new StoreError('生产环境不接受预览产物', 400)
  return `${workspaceOrigin()}${EMAIL_CONFIRMATION_PATH}/${projectId}/${environment}/${generation}${artifactId ? '/' + artifactId : ''}`
}

function confirmationArtifact(
  projectId: string,
  generation: string,
  requested?: string,
) {
  if (requested !== undefined && !/^[a-f0-9-]{36}$/.test(requested))
    throw new StoreError('预览产物无效', 400)
  const rows = db()
    .prepare(
      `SELECT id FROM preview_artifacts WHERE projectId=? ${requested === undefined ? '' : 'AND id=?'} ORDER BY createdAt DESC,rowid DESC LIMIT 30`,
    )
    .all(
      ...(requested === undefined ? [projectId] : [projectId, requested]),
    ) as {
    id: string
  }[]
  for (const row of rows) {
    try {
      const manifest = artifactManifest(row.id)
      if (
        manifest?.format === 'pixloom-cloud-v2' &&
        manifest.projectId === projectId &&
        manifest.environment === 'development' &&
        manifest.generation === generation
      )
        return row.id
    } catch {
      // A malformed or obsolete build cannot supply a return destination.
    }
  }
  if (requested !== undefined)
    throw new StoreError('预览产物不属于当前应用环境', 400)
}

export function emailConfirmationResponse(scope: string[] = []) {
  let returnUrl: string | undefined
  if (scope.length === 3 || scope.length === 4) {
    const [projectId, environment, generation, requestedArtifact] = scope
    if (
      /^[a-f0-9-]{36}$/.test(projectId) &&
      /^[a-f0-9-]{36}$/.test(generation) &&
      ['development', 'production'].includes(environment)
    ) {
      const app = sharedApp(projectId)
      const row = sharedEnvironment(projectId, environment as CloudEnvironment)
      if (app?.generation === generation && row?.status === 'ready') {
        if (environment === 'production' && !requestedArtifact)
          returnUrl = liveRelease(projectId)?.url
        else if (environment === 'development') {
          try {
            const artifactId = confirmationArtifact(
              projectId,
              generation,
              requestedArtifact,
            )
            if (artifactId)
              returnUrl = `${workspaceOrigin()}/preview/${artifactId}`
          } catch {
            // Deleted, foreign or stale artifacts have no automatic return.
          }
        }
      }
    }
  }
  const nonce = randomBytes(18).toString('base64')
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  // Shared Auth uses password login after confirmation. Never forward upstream
  // access/refresh tokens to an application or adopt them as a platform session.
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>邮箱验证 · Pixloom</title><script nonce="${nonce}">
const params=new URLSearchParams(location.hash.slice(1));
const failed=params.has('error')||params.has('error_code');
const confirmed=!failed&&params.has('access_token');
history.replaceState(null,'',location.pathname);
document.addEventListener('DOMContentLoaded',()=>{
 if(failed){document.getElementById('title').textContent='验证链接无效或已过期';document.getElementById('message').textContent='请返回原应用重新注册以获取验证邮件，或使用邮件验证码完成验证。'}
 else if(confirmed){document.getElementById('title').textContent='邮箱验证完成';const target=${JSON.stringify(returnUrl || null).replace(/</g, '\\u003c')};if(target)location.replace(target);}
});</script><style nonce="${nonce}">body{margin:0;background:#f6f7fb;color:#20232c;font:16px/1.7 system-ui,sans-serif;display:grid;min-height:100dvh;place-items:center}main{max-width:440px;margin:24px;padding:32px;border:1px solid #e1e4ec;border-radius:16px;background:white}h1{font-size:24px;margin:0 0 12px}p{color:#525866}a{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:8px;background:#3538cd;color:white;text-decoration:none}</style></head><body><main><h1 id="title">邮箱验证</h1><p id="message">请返回原应用，使用注册时的邮箱和密码登录。</p>${returnUrl ? `<a href="${escape(returnUrl)}" rel="noreferrer">返回应用登录</a>` : '<p>可关闭此页面，回到刚才打开的应用继续。</p>'}</main></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    },
  )
}
