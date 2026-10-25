import { requireProjectUser } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse, readJson } from '@/lib/http'
import { projectById, StoreError } from '@/lib/store'
import { requireWorker } from '@/lib/workspace-api'
import { publicationConfig, publicationTarget } from '@/lib/publication/config'
import {
  enqueuePublication,
  liveRelease,
  releaseHistory,
  updatePublicationPrefix,
} from '@/lib/publication/store'
import {
  normalizePublicationPrefix,
  publicationPrefixError,
} from '@/lib/publication/prefix'

const prefixSchema = z
  .string()
  .max(200)
  .transform(normalizePublicationPrefix)
  .superRefine((value, ctx) => {
    const message = publicationPrefixError(value)
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  })

export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    projectById(params.id)
    const live = liveRelease(params.id),
      releases = releaseHistory(params.id)
    try {
      const config = publicationConfig()
      const target = publicationTarget(params.id, config)
      return NextResponse.json({
        enabled: config.enabled,
        reason: config.enabled ? null : '请在服务端启用发布并启动发布网关',
        domain: target.domain,
        prefix: target.domain.split('.')[0],
        domainSuffix: config.domain,
        live,
        releases,
      })
    } catch {
      return NextResponse.json({
        enabled: false,
        reason: '发布配置无效，请检查服务端环境变量',
        domain: null,
        prefix: null,
        domainSuffix: null,
        live,
        releases,
      })
    }
  } catch (error) {
    return errorResponse(error)
  }
}
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const common = { expectedReleaseId: z.string().uuid().nullable() }
    const input = z
      .discriminatedUnion('action', [
        z
          .object({
            ...common,
            action: z.literal('publish'),
            versionId: z.string().uuid(),
            prefix: prefixSchema.optional(),
            expectedPrefix: z.string().max(63).optional(),
          })
          .strict(),
        z
          .object({
            ...common,
            action: z.literal('rollback'),
            releaseId: z.string().uuid(),
          })
          .strict(),
        z.object({ ...common, action: z.literal('unpublish') }).strict(),
      ])
      .parse(await readJson(request))
    requireWorker()
    let target = null
    if (input.action !== 'unpublish') {
      const config = publicationConfig()
      if (!config.enabled) throw new StoreError('发布尚未启用', 503)
      target = publicationTarget(
        params.id,
        config,
        input.action === 'publish' ? input.prefix : undefined,
      )
    }
    return NextResponse.json(enqueuePublication(params.id, input, target), {
      status: 202,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireProjectUser(request, params.id)
    const input = z
      .object({
        prefix: prefixSchema,
        expectedPrefix: z.string().max(63),
        expectedReleaseId: z.string().uuid().nullable(),
      })
      .strict()
      .parse(await readJson(request))
    const config = publicationConfig()
    if (!config.enabled) throw new StoreError('发布尚未启用', 503)
    const target = publicationTarget(params.id, config, input.prefix)
    updatePublicationPrefix(params.id, input, target)
    return GET(request, { params })
  } catch (error) {
    return errorResponse(error)
  }
}
