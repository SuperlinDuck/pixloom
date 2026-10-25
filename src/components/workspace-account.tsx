'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, LogOut, UserRound } from 'lucide-react'
import type { AccountSession } from '@/lib/auth-types'

const signedOut: AccountSession = {
  configured: false,
  required: false,
  user: null,
}
const loginErrors: Record<string, string> = {
  cancelled: '已取消 Google 登录',
  account: '此账号暂不可用，请联系管理员。',
  failed: 'Google 登录失败或已过期，请重试。',
}

export function useWorkspaceAccount() {
  const [session, setSession] = useState<AccountSession>(signedOut)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' })
      if (!response.ok) throw new Error('账号信息加载失败，请刷新重试。')
      setSession(await response.json())
    } catch (e) {
      // If session lookup fails, keep workspace requests disabled.
      setSession({ configured: false, required: true, user: null })
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const query = new URL(window.location.href)
    const reason = query.searchParams.get('auth_error')
    if (reason) {
      setError(loginErrors[reason] || loginErrors.failed)
      query.searchParams.delete('auth_error')
      window.history.replaceState(null, '', query.href)
    }
    const update = () => {
      void refresh()
    }
    window.addEventListener('focus', update)
    window.addEventListener('pixloom:unauthorized', update)
    const timer = window.setInterval(update, 60000)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('pixloom:unauthorized', update)
      window.clearInterval(timer)
    }
  }, [refresh])
  return {
    session,
    loading,
    error,
    setError,
    refresh,
    canAccess:
      !loading &&
      (!session.required ||
        (session.user?.status === 'active' &&
          (!session.user.accessExpiresAt ||
            session.user.accessExpiresAt > Date.now()))),
  }
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285f4"
        d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9Z"
      />
      <path
        fill="#34a853"
        d="M24 44c5.5 0 10.1-1.8 13.5-4.6l-6.6-5c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2A20.4 20.4 0 0 0 24 44Z"
      />
      <path
        fill="#fbbc05"
        d="M12.6 28a12 12 0 0 1 0-8V14.8H5.8a20 20 0 0 0 0 18.4L12.6 28Z"
      />
      <path
        fill="#ea4335"
        d="M24 11.6c3 0 5.7 1 7.8 3.1l5.8-5.8A19.5 19.5 0 0 0 24 4 20.4 20.4 0 0 0 5.8 14.8l6.8 5.2c1.6-4.8 6.1-8.4 11.4-8.4Z"
      />
    </svg>
  )
}

export function WorkspaceAccount({
  account,
  beforeNavigate,
}: {
  account: ReturnType<typeof useWorkspaceAccount>
  beforeNavigate: () => Promise<boolean>
}) {
  const [pending, setPending] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [code, setCode] = useState('')
  const { session, loading, error, setError } = account
  const user = session.user
  async function login() {
    if (!session.configured) {
      setError('Google 登录暂不可用，请联系管理员完成配置。')
      return
    }
    if (!(await beforeNavigate())) return
    setPending(true)
    window.location.assign('/api/auth/google')
  }
  async function logout() {
    if (!(await beforeNavigate())) return
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || '退出失败，请重试。')
      }
      localStorage.removeItem('pixloom-v3-project')
      if (user) localStorage.removeItem(`pixloom-v3-project:${user.id}`)
      window.location.assign('/')
    } catch (e) {
      setError((e as Error).message)
      setPending(false)
    }
  }
  async function redeem() {
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/auth/invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '兑换失败')
      setCode('')
      await account.refresh()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="workspace-account">
      {loading ? (
        <div className="account-loading" role="status">
          <Loader2 size={16} className="spin" />
          正在加载账号…
        </div>
      ) : user ? (
        <div className="account-profile">
          <span className="account-avatar" aria-hidden="true">
            {user.picture && !imageFailed ? (
              <img
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
              />
            ) : (
              user.name.trim()[0]?.toUpperCase() || <UserRound size={18} />
            )}
          </span>
          <div className="account-details">
            <strong title={user.name}>{user.name}</strong>
          </div>
          <button
            className="icon-button account-logout"
            aria-label="退出登录"
            title="退出登录"
            disabled={pending}
            onClick={() => void logout()}
          >
            {pending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <LogOut size={16} />
            )}
          </button>
        </div>
      ) : (
        <button
          className="account-login"
          disabled={pending}
          onClick={() => void login()}
        >
          {pending ? <Loader2 size={18} className="spin" /> : <GoogleIcon />}
          {pending ? '正在前往 Google…' : '使用 Google 登录'}
        </button>
      )}
      {user?.status === 'pending' && (
        <form
          className="invitation-form"
          onSubmit={(event) => {
            event.preventDefault()
            void redeem()
          }}
        >
          <label htmlFor="invitation-code">输入邀请码，开通体验</label>
          <input
            id="invitation-code"
            autoComplete="off"
            value={code}
            maxLength={100}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          <button className="primary-button" disabled={pending || !code.trim()}>
            {pending ? '正在兑换…' : '兑换邀请码'}
          </button>
        </form>
      )}
      {user?.status === 'disabled' && (
        <p role="alert">账号已停用，请联系管理员。</p>
      )}
      {user?.status === 'active' && session.usage && (
        <div className="account-usage">
          <p>
            剩余额度 {session.usage.remainingCredits.toLocaleString()} /{' '}
            {session.usage.creditLimit.toLocaleString()}
          </p>
          <p>
            输入 {session.usage.inputTokens.toLocaleString()} · 输出{' '}
            {session.usage.outputTokens.toLocaleString()} tokens
          </p>
          {session.usage.reservedCredits > 0 && (
            <p>
              已预留 {session.usage.reservedCredits.toLocaleString()}
              ，含待核对用量
            </p>
          )}
          {user.accessExpiresAt && (
            <p>
              {new Date(user.accessExpiresAt).toLocaleDateString()} 到期
              {user.accessExpiresAt <= Date.now() ? '，请联系管理员' : ''}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
