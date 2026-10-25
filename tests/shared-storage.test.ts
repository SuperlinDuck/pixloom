import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensurePrivateStorageBucket,
  storageFetch,
  storageFailureSummary,
} from '../src/lib/cloud/shared-storage'

const config = {
  environment: 'development' as const,
  origin: 'https://storage.example',
  serviceKey: 'secret-must-not-leak',
}
const json = (value: unknown, status = 200) => Response.json(value, { status })
const upstream = vi.fn<typeof fetch>()
beforeEach(() => {
  upstream.mockReset()
  vi.stubGlobal('fetch', upstream)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shared private storage initialization', () => {
  it.each([
    [404, {}],
    [400, { code: 'NoSuchBucket' }],
    [400, { statusCode: '404', error: 'Bucket not found' }],
    [400, { message: 'Bucket not found' }],
  ])(
    'creates a missing bucket for HTTP %s %j and checks privacy again',
    async (status, body) => {
      upstream
        .mockResolvedValueOnce(json(body, status))
        .mockResolvedValueOnce(json({ name: 'pixloom-cloud-v2' }))
        .mockResolvedValueOnce(json({ public: false }))
      await ensurePrivateStorageBucket(config)
      expect(upstream).toHaveBeenCalledTimes(3)
      const [url, init] = upstream.mock.calls[1]
      expect(url).toBe(config.origin + '/storage/v1/bucket')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(init?.body as string)).toEqual({
        id: 'pixloom-cloud-v2',
        name: 'pixloom-cloud-v2',
        public: false,
        file_size_limit: 2097152,
      })
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer ' + config.serviceKey,
      )
      expect(upstream.mock.calls[2][0]).toBe(
        config.origin + '/storage/v1/bucket/pixloom-cloud-v2',
      )
      expect(console.error).not.toHaveBeenCalled()
    },
  )

  it('reuses a private bucket without creating it', async () => {
    upstream.mockResolvedValueOnce(json({ public: false }))
    await ensurePrivateStorageBucket(config)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it.each([
    [409, {}],
    [400, { code: 'BucketAlreadyExists' }],
    [400, { code: 'ResourceAlreadyExists' }],
    [400, { statusCode: '409', error: 'Duplicate' }],
  ])(
    'checks the winning creator after a concurrent HTTP %s response',
    async (status, body) => {
      upstream
        .mockResolvedValueOnce(json({ error: 'Bucket not found' }, 400))
        .mockResolvedValueOnce(json(body, status))
        .mockResolvedValueOnce(json({ public: false }))
      await ensurePrivateStorageBucket(config)
      expect(upstream).toHaveBeenCalledTimes(3)
    },
  )

  it.each([400, 401, 403, 429, 500, 503])(
    'never creates a bucket for an unrelated HTTP %s failure',
    async (status) => {
      upstream.mockResolvedValueOnce(
        json({ error: 'Unauthorized secret-must-not-leak' }, status),
      )
      await expect(ensurePrivateStorageBucket(config)).rejects.toMatchObject({
        status: 502,
        diagnostic: { operation: 'bucket.lookup', status },
      })
      expect(upstream).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        'secret-must-not-leak',
      )
    },
  )

  it('reports initialization failure distinctly and never proceeds to objects', async () => {
    upstream
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ code: 'AccessDenied' }, 403))
    await expect(ensurePrivateStorageBucket(config)).rejects.toMatchObject({
      message: expect.stringContaining('私有文件存储初始化失败'),
      diagnostic: {
        operation: 'bucket.create',
        status: 403,
        code: 'AccessDenied',
      },
    })
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it.each(['existing', 'created', 'conflict'])(
    'refuses a public bucket when %s',
    async (mode) => {
      if (mode !== 'existing') {
        upstream
          .mockResolvedValueOnce(json({}, 404))
          .mockResolvedValueOnce(json({}, mode === 'conflict' ? 409 : 200))
      }
      upstream.mockResolvedValueOnce(json({ public: true }))
      await expect(ensurePrivateStorageBucket(config)).rejects.toMatchObject({
        status: 503,
        diagnostic: { code: 'PUBLIC_BUCKET' },
      })
    },
  )

  it.each([
    () => new Response('invalid-json secret-must-not-leak'),
    () => json({ unexpected: 'secret-must-not-leak' }),
    () => json({ public: false, oversized: 'x'.repeat(64000) }),
  ])(
    'rejects invalid or oversized metadata without exposing it',
    async (makeResponse) => {
      upstream.mockResolvedValueOnce(makeResponse())
      await expect(ensurePrivateStorageBucket(config)).rejects.toMatchObject({
        status: 503,
        diagnostic: { code: 'INVALID_RESPONSE' },
      })
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        'secret-must-not-leak',
      )
    },
  )
})

describe('safe storage failures', () => {
  it.each([
    ['file.upload', '文件上传'],
    ['file.download', '文件下载'],
    ['file.delete', '文件删除'],
  ] as const)(
    'keeps %s errors actionable without logging file data or secrets',
    async (operation, label) => {
      const requestId = '8e5965a5-8c3e-4359-886d-186e766b96a4'
      upstream.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'AccessDenied',
            message: 'secret-must-not-leak',
          }),
          { status: 403, headers: { 'sb-request-id': requestId } },
        ),
      )
      const error = await storageFetch(
        config,
        operation,
        'object/private-file-name',
      ).catch((error) => error)
      expect(error).toMatchObject({
        status: 502,
        diagnostic: { operation, status: 403, code: 'AccessDenied', requestId },
      })
      expect(error.message).toContain(label)
      const summary = storageFailureSummary({ storage: error.diagnostic })
      expect(summary).toContain(label)
      expect(summary).toContain('HTTP 403')
      expect(summary).toContain(requestId)
      const logs = JSON.stringify(vi.mocked(console.error).mock.calls)
      expect(logs).toContain(operation)
      expect(logs).not.toContain('private-file-name')
      expect(logs).not.toContain('secret-must-not-leak')
    },
  )

  it.each([
    [new DOMException('secret-must-not-leak', 'TimeoutError'), 'TIMEOUT'],
    [
      Object.assign(new Error('secret-must-not-leak'), {
        cause: { code: 'ENOTFOUND' },
      }),
      'DNS_LOOKUP_FAILED',
    ],
    [
      Object.assign(new Error('secret-must-not-leak'), {
        cause: { code: 'ECONNREFUSED' },
      }),
      'CONNECTION_REFUSED',
    ],
    [new Error('secret-must-not-leak'), 'TRANSPORT_ERROR'],
  ])('classifies transport failures as %s / %s', async (error, code) => {
    upstream.mockRejectedValueOnce(error)
    await expect(
      storageFetch(config, 'file.upload', 'object/private'),
    ).rejects.toMatchObject({
      diagnostic: { code, status: null },
    })
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      'secret-must-not-leak',
    )
  })

  it('does not forward arbitrary upstream codes or request identifiers', async () => {
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'secret-must-not-leak' }), {
        status: 500,
        headers: { 'sb-request-id': 'secret-must-not-leak' },
      }),
    )
    await expect(
      storageFetch(config, 'file.upload', 'object/private'),
    ).rejects.toMatchObject({
      diagnostic: { code: 'UPSTREAM_ERROR', requestId: null },
    })
    expect(
      storageFailureSummary({ storage: { code: 'secret-must-not-leak' } }),
    ).toBe('')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      'secret-must-not-leak',
    )
  })
})
