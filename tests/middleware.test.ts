import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../src/middleware'
const id = '12345678-1234-1234-1234-123456789abc'
describe('opaque-origin preview resource access', () => {
  it('allows only GET for immutable preview assets while rejecting cross-site platform API calls', () => {
    const request = (
      pathname: string,
      method = 'GET',
      host = '127.0.0.1:3100',
    ) =>
      new NextRequest(`http://${host}${pathname}`, {
        method,
        headers: { host, 'sec-fetch-site': 'cross-site' },
      })
    expect(
      middleware(request(`/api/previews/${id}/assets/index.js`)).status,
    ).toBe(200)
    expect(
      middleware(request(`/api/previews/${id}/index.html`, 'POST')).status,
    ).toBe(403)
    expect(middleware(request('/api/projects')).status).toBe(403)
    expect(middleware(request('/api/auth/callback/google')).status).toBe(200)
    expect(
      middleware(request('/api/auth/callback/google', 'POST')).status,
    ).toBe(403)
    expect(middleware(request('/api/auth/logout', 'POST')).status).toBe(403)
    expect(middleware(request('/api/auth/google')).status).toBe(403)
    expect(
      middleware(request(`/api/previews/${id}/index.html`, 'GET', 'evil.test'))
        .status,
    ).toBe(403)
    expect(
      middleware(request(`/api/runtime-preview/${id}/index.html`)).status,
    ).toBe(403)
  })
})
