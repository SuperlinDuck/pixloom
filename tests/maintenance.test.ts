import { afterEach, describe, expect, it, vi } from 'vitest'
import { maintenanceMode } from '../src/lib/maintenance'
import { requireWorkspaceUser, signInAccount } from '../src/lib/auth'
import { checkMutation } from '../src/lib/http'
import { GET as projectsGET } from '../src/app/api/projects/route'
import { gatewayHandler } from '../src/lib/publication/gateway'
import { publicationConfig } from '../src/lib/publication/config'
import type { IncomingMessage, ServerResponse } from 'node:http'
vi.mock('../src/lib/maintenance', async (original) => ({
  ...(await original<typeof import('../src/lib/maintenance')>()),
  maintenanceMode: vi.fn(() => false),
}))
afterEach(() => {
  vi.mocked(maintenanceMode).mockReset()
  vi.mocked(maintenanceMode).mockReturnValue(false)
})
describe('maintenance blocks business access before touching data', () => {
  it('rejects workspace reads, account writes and mutations with 503', async () => {
    vi.mocked(maintenanceMode).mockReturnValue(true)
    const request = new Request('http://127.0.0.1:3000/api/projects')
    expect(() => requireWorkspaceUser(request)).toThrow('正在升级')
    expect(() => checkMutation(request)).toThrow('正在升级')
    expect(() =>
      signInAccount({
        subject: 'test',
        name: 'test',
        email: 'test@example.com',
        picture: null,
      }),
    ).toThrow('正在升级')
    expect((await projectsGET(request)).status).toBe(503)
  })
  it.each(['/cloud/v2/apps/test', '/__pixloom/auth/signin', '/'])(
    'blocks gateway traffic before auth/database handlers: %s',
    async (url) => {
      vi.mocked(maintenanceMode).mockReturnValue(true)
      const status = vi.fn(),
        end = vi.fn()
      await gatewayHandler(publicationConfig())(
        { url, method: 'POST' } as IncomingMessage,
        { writeHead: status, end } as unknown as ServerResponse,
      )
      expect(status.mock.calls[0][0]).toBe(503)
      expect(end).toHaveBeenCalledWith('HTTP 503')
    },
  )
})
