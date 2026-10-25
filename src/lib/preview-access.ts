import { randomBytes } from 'node:crypto'
import {
  authRequired,
  readCookie,
  requireProjectUser,
  sessionCookie,
} from './auth'
import { db, StoreError, transaction } from './store'
import { assertActive, digest, userById } from './tenancy'
const lifetime = 15 * 60 * 1000
export function artifactProject(artifactId: string) {
  const row = db()
    .prepare('SELECT projectId FROM preview_artifacts WHERE id=?')
    .get(artifactId) as { projectId: string } | undefined
  if (!row) throw new StoreError('预览不存在', 404)
  return row.projectId
}
export function requireArtifactUser(request: Request, artifactId: string) {
  return requireProjectUser(request, artifactProject(artifactId))
}
export function previewGrant(
  request: Request,
  artifactId: string,
  existing?: string,
) {
  const user = requireArtifactUser(request, artifactId)
  if (!user)
    return { base: `/api/previews/${artifactId}/`, token: '', expiresAt: null }
  return transaction(() => {
    db()
      .prepare('DELETE FROM preview_grants WHERE expiresAt<=?')
      .run(Date.now())
    const sessionHash = digest(readCookie(request, sessionCookie) || '')
    const token = existing || randomBytes(32).toString('base64url')
    if (!/^[\w-]{43}$/.test(token)) throw new StoreError('预览凭证无效', 403)
    const expiresAt = Date.now() + lifetime
    if (existing) {
      const changed = db()
        .prepare(
          'UPDATE preview_grants SET expiresAt=? WHERE tokenHash=? AND artifactId=? AND userId=? AND sessionHash=?',
        )
        .run(expiresAt, digest(token), artifactId, user.id, sessionHash).changes
      if (!changed) throw new StoreError('预览凭证已过期，请刷新预览', 403)
    } else {
      const count = (
        db()
          .prepare('SELECT count(*) AS n FROM preview_grants WHERE userId=?')
          .get(user.id) as { n: number }
      ).n
      if (count >= 100) throw new StoreError('打开的预览过多，请稍后重试', 429)
      db()
        .prepare(
          'INSERT INTO preview_grants (tokenHash,artifactId,userId,expiresAt,sessionHash) VALUES (?,?,?,?,?)',
        )
        .run(digest(token), artifactId, user.id, expiresAt, sessionHash)
    }
    return {
      base: `/api/previews/${artifactId}/_grant/${token}/`,
      token,
      expiresAt,
    }
  })
}
export function authorizePreviewAsset(
  request: Request,
  artifactId: string,
  segments: string[],
) {
  if (segments[0] !== '_grant') {
    if (authRequired()) requireArtifactUser(request, artifactId)
    return { file: segments.join('/') || 'index.html', base: undefined }
  }
  const token = segments[1] || ''
  if (!/^[\w-]{43}$/.test(token)) throw new StoreError('预览凭证无效', 403)
  const row = db()
    .prepare(
      `SELECT g.userId FROM preview_grants g JOIN auth_sessions s ON s.tokenHash=g.sessionHash
    JOIN projects p ON p.ownerId=g.userId JOIN preview_artifacts a ON a.projectId=p.id AND a.id=g.artifactId
    WHERE g.tokenHash=? AND g.artifactId=? AND g.expiresAt>? AND s.expiresAt>? AND s.userId=g.userId`,
    )
    .get(digest(token), artifactId, Date.now(), Date.now()) as
    { userId: string } | undefined
  if (!row) throw new StoreError('预览凭证已失效，请刷新预览', 403)
  assertActive(userById(row.userId))
  return {
    file: segments.slice(2).join('/') || 'index.html',
    base: `/api/previews/${artifactId}/_grant/${token}/`,
  }
}
