import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { RoleCtx } from './RoleContext'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
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
    <div className="auth-gate">
      <form className="auth-form" onSubmit={login}>
        <div className="auth-logo">PB SOR</div>
        <h2>Masuk</h2>
        <p className="auth-sub">Manajemen lapangan badminton</p>
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
  )
}
