import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { RoleCtx } from './RoleContext'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [showLogin, setShowLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!supabase) { setSession(null); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // ponytail: global DOM event avoids new context; upgrade to context if multiple triggers needed
  useEffect(() => {
    const h = () => setShowLogin(true)
    window.addEventListener('open-admin-login', h)
    return () => window.removeEventListener('open-admin-login', h)
  }, [])

  if (session === undefined) return <div className="auth-loading">…</div>

  if (session) {
    const isAdmin = session.user.user_metadata?.role === 'admin'
    return <RoleCtx.Provider value={isAdmin}>{children}</RoleCtx.Provider>
  }

  async function login(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <RoleCtx.Provider value={false}>
      {children}
      {showLogin && (
        <div className="auth-gate" style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
          <form className="auth-form" onSubmit={login}>
            <button
              type="button"
              onClick={() => setShowLogin(false)}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}
            >✕</button>
            <div className="auth-logo">PB SOR</div>
            <h2>Login Admin</h2>
            <p className="auth-sub">Akses manajemen lapangan</p>
            <input type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} required autoFocus />
            <input type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} required />
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" disabled={loading}>
              {loading ? 'Masuk…' : 'Masuk'}
            </button>
          </form>
        </div>
      )}
    </RoleCtx.Provider>
  )
}
