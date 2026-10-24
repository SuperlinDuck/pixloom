import { randomUUID } from 'node:crypto'
import {
  db,
  transaction,
  projectById,
  getDraft,
  getVersion,
  insertTask,
  attemptActive,
  StoreError,
  getTask,
  projectPublicId,
} from '../store'
import type { Release, Task } from '../types'

const now = () => new Date().toISOString()
const select =
  'SELECT releases.*,versions.number AS versionNumber FROM releases JOIN versions ON versions.id=releases.versionId'
function canonicalRelease(release: Release): Release {
  const legacyPrefix = `p-${release.projectId.replace(/-/g, '')}.`
  if (!release.domain.startsWith(legacyPrefix)) return release
  const domain =
    projectPublicId(release.projectId) +
    '.' +
    release.domain.slice(legacyPrefix.length)
  const url = new URL(release.url)
  if (url.hostname !== release.domain)
    throw new StoreError('发布地址与域名不匹配', 409)
  url.hostname = domain
  // Old audit rows stay intact; API responses consistently expose the canonical address.
  return { ...release, domain, url: url.origin }
}
export function installationId() {
  return (
    db()
      .prepare('SELECT installationId FROM publication_meta WHERE id=1')
      .get() as { installationId: string }
  ).installationId
}
export function getRelease(id: string, projectId?: string): Release {
  const row = db()
    .prepare(
      select +
        ' WHERE releases.id=?' +
        (projectId ? ' AND releases.projectId=?' : ''),
    )
    .get(...(projectId ? [id, projectId] : [id])) as Release | undefined
  if (!row) throw new StoreError('发布记录不存在', 404)
  return canonicalRelease(row)
}
export function liveRelease(projectId: string) {
  const row = db()
    .prepare('SELECT releaseId FROM published_sites WHERE projectId=?')
    .get(projectId) as { releaseId: string } | undefined
  return row ? getRelease(row.releaseId, projectId) : null
}
export function releaseHistory(projectId: string) {
  projectById(projectId)
  const rows = db()
    .prepare(
      select +
        ' WHERE releases.projectId=? ORDER BY releases.createdAt DESC,releases.rowid DESC LIMIT 30',
    )
    .all(projectId) as Release[]
  return rows.map(canonicalRelease)
}
export type ReleaseInput = {
  versionId?: string
  releaseId?: string
  action: 'publish' | 'rollback' | 'unpublish'
  expectedReleaseId: string | null
}
export function enqueuePublication(
  projectId: string,
  input: ReleaseInput,
  target: { domain: string; url: string } | null,
) {
  return transaction(() => {
    const project = projectById(projectId),
      draft = getDraft(projectId),
      live = liveRelease(projectId)
    if ((live?.id || null) !== input.expectedReleaseId)
      throw new StoreError('线上版本已变化，请刷新后重试', 409)
    const restored =
      input.action === 'rollback'
        ? getRelease(input.releaseId || '', projectId)
        : null
    if (restored && restored.status !== 'published')
      throw new StoreError('只能回滚到成功的发布记录', 409)
    if (input.action === 'unpublish' && !live)
      throw new StoreError('项目尚未上线', 409)
    const version = getVersion(
      projectId,
      restored?.versionId ||
        (input.action === 'unpublish'
          ? live!.versionId
          : input.versionId || ''),
    )
    const pinned = restored || (input.action === 'unpublish' ? live : null)
    const artifactId = pinned?.artifactId || version.artifactId
    const domain = input.action === 'unpublish' ? live!.domain : target?.domain
    const url = input.action === 'unpublish' ? live!.url : target?.url
    if (!domain || !url) throw new StoreError('发布尚未启用', 503)
    if (live && (live.domain !== domain || live.url !== url))
      throw new StoreError('发布域名配置已变化，请先下线原站点', 409)
    if (
      input.action !== 'unpublish' &&
      live?.versionId === version.id &&
      live.artifactId === artifactId
    )
      throw new StoreError('该版本及产物已经上线', 409)
    if (
      !db()
        .prepare(
          'SELECT id FROM preview_artifacts WHERE id=? AND projectId=? AND sourceHash=? AND templateId=?',
        )
        .get(artifactId, projectId, version.hash, version.templateId)
    )
      throw new StoreError('发布产物不存在或不匹配', 409)
    const task = insertTask(
      projectId,
      input.action === 'unpublish' ? 'unpublish' : 'publish',
      draft.revision,
      project.currentVersionId,
      version.id,
      input.action === 'rollback' ? `回滚线上到 v${version.number}` : undefined,
    )
    const id = randomUUID(),
      time = now()
    db()
      .prepare(
        'INSERT INTO releases (id,projectId,taskId,versionId,artifactId,sourceHash,templateId,action,status,domain,url,previousReleaseId,restoredFromReleaseId,error,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        projectId,
        task.id,
        version.id,
        artifactId,
        version.hash,
        version.templateId,
        input.action,
        'queued',
        domain,
        url,
        live?.id || null,
        restored?.id || null,
        null,
        time,
        time,
      )
    return { task, release: getRelease(id, projectId) }
  })
}
export function releaseForTask(task: Task) {
  const row = db()
    .prepare('SELECT id FROM releases WHERE taskId=? AND projectId=?')
    .get(task.id, task.projectId) as { id: string } | undefined
  if (!row) throw new StoreError('任务缺少发布记录', 409)
  return getRelease(row.id, task.projectId)
}
export function setReleasePhase(
  task: Task,
  phase: 'staging' | 'verifying',
  owner?: string,
) {
  return transaction(() => {
    if (!attemptActive(task, owner)) throw new StoreError('发布已中断', 409)
    db()
      .prepare('UPDATE releases SET status=?,updatedAt=? WHERE taskId=?')
      .run(phase, now(), task.id)
  })
}
export function completePublication(task: Task, owner?: string) {
  return transaction(() => {
    if (!attemptActive(task, owner)) return false
    const release = releaseForTask(task),
      live = liveRelease(task.projectId)
    if ((live?.id || null) !== release.previousReleaseId)
      throw new StoreError('线上基线已变化，未切换发布', 409)
    if (release.action !== 'unpublish' && release.status !== 'verifying')
      throw new StoreError('发布尚未验证', 409)
    if (release.action === 'unpublish')
      db()
        .prepare('DELETE FROM published_sites WHERE projectId=?')
        .run(task.projectId)
    else
      db()
        .prepare(
          'INSERT INTO published_sites VALUES (?,?,?) ON CONFLICT(projectId) DO UPDATE SET releaseId=excluded.releaseId,domain=excluded.domain',
        )
        .run(task.projectId, release.id, release.domain)
    const status = release.action === 'unpublish' ? 'unpublished' : 'published'
    const time = now(),
      events = getTask(task.id).events.concat({
        at: time,
        message:
          status === 'published' ? `发布已就绪：${release.url}` : '应用已下线',
      })
    db()
      .prepare('UPDATE releases SET status=?,error=NULL,updatedAt=? WHERE id=?')
      .run(status, time, release.id)
    db()
      .prepare(
        "UPDATE tasks SET status='completed',candidateFiles='[]',events=?,error=NULL,updatedAt=? WHERE id=?",
      )
      .run(JSON.stringify(events), time, task.id)
    return true
  })
}
export function siteForDomain(domain: string) {
  const row = db()
    .prepare('SELECT releaseId FROM published_sites WHERE domain=?')
    .get(domain) as { releaseId: string } | undefined
  if (row) return getRelease(row.releaseId)
  const dot = domain.indexOf('.')
  if (dot === -1) return null
  const label = domain.slice(0, dot),
    suffix = domain.slice(dot)
  if (/^[a-z0-9]{6}$/.test(label)) {
    const site = db()
      .prepare(
        'SELECT published_sites.projectId,published_sites.releaseId,published_sites.domain FROM published_sites JOIN project_public_ids ON project_public_ids.projectId=published_sites.projectId WHERE project_public_ids.shortId=?',
      )
      .get(label) as
      { projectId: string; releaseId: string; domain: string } | undefined
    if (
      site &&
      [label, `p-${site.projectId.replace(/-/g, '')}`].some(
        (prefix) => site.domain === prefix + suffix,
      )
    )
      return getRelease(site.releaseId)
  }
  const legacy = label.match(/^p-([a-f0-9]{32})$/)?.[1]
  if (legacy) {
    const projectId = `${legacy.slice(0, 8)}-${legacy.slice(8, 12)}-${legacy.slice(12, 16)}-${legacy.slice(16, 20)}-${legacy.slice(20)}`
    const live = liveRelease(projectId)
    if (live && live.domain === projectPublicId(projectId) + suffix) return live
  }
  return null
}
export function wasPublished(projectId: string, artifactId: string) {
  return !!db()
    .prepare(
      "SELECT id FROM releases WHERE projectId=? AND artifactId=? AND status='published' LIMIT 1",
    )
    .get(projectId, artifactId)
}
