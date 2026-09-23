import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { RoleCtx } from './RoleContext'
import type { TeamId } from './types'

// The four captain logins, mapped to their team so the accounts need no
// metadata: create them in Supabase with these emails and nothing else.
const CAPTAINS: Record<string, TeamId> = {
  'captain1@sor.com': 1, 'captain2@sor.com': 2, 'captain3@sor.com': 3, 'captain4@sor.com': 4,
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [showLogin, setShowLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
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
    const role = {
      admin: session.user.user_metadata?.role === 'admin',
      team: CAPTAINS[session.user.email?.toLowerCase() ?? ''] ?? null,
      signedIn: true,
    }
    return <RoleCtx.Provider value={role}>{children}</RoleCtx.Provider>
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setError(''); setNote('')

    if (!registering) {
      setLoading(true)
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      setLoading(false)
      return
    }

    // Only the four captain logins may be created here; admins are made in
    // Supabase. The check is a guard rail, not security — the sign-up endpoint
    // is open, so it stops typos, not a determined stranger.
    const who = CAPTAINS[email.trim().toLowerCase()]
    if (!who) return setError('Email ini bukan email kapten tim.')
    if (password.length < 6) return setError('Password minimal 6 karakter.')
    if (password !== confirm) return setError('Konfirmasi password tidak sama.')

    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(), password,
    })
    setLoading(false)
    if (error) return setError(error.message)
    // No session back means the project still demands e-mail confirmation, and
    // these addresses have no inbox — say so instead of leaving a dead account.
    if (!data.session) {
      setNote('Akun dibuat, tapi project masih meminta konfirmasi email. '
        + 'Matikan "Confirm email" di Supabase, lalu daftar ulang.')
    }
  }

  return (
    <RoleCtx.Provider value={{ admin: false, team: null, signedIn: false }}>
      {children}
      {showLogin && (
        <div className="auth-gate" style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
          <form className="auth-form" onSubmit={submit}>
            <button
              type="button"
              onClick={() => setShowLogin(false)}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}
            >✕</button>
            <div className="auth-logo">PB SOR</div>
            <h2>{registering ? 'Daftar Kapten' : 'Login'}</h2>
            <p className="auth-sub">
              {registering ? 'Pakai email kapten tim Anda' : 'Admin & kapten tim'}
            </p>
            <input type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} required autoFocus />
            <input type="password" autoComplete={registering ? 'new-password' : 'current-password'}
              placeholder={registering ? 'Password baru' : 'Password'} value={password}
              onChange={e => setPassword(e.target.value)} required />
            {registering && (
              <input type="password" autoComplete="new-password" placeholder="Ulangi password"
                value={confirm} onChange={e => setConfirm(e.target.value)} required />
            )}
            {error && <p className="auth-error">{error}</p>}
            {note && <p className="auth-note">{note}</p>}
            <button type="submit" disabled={loading}>
              {loading ? 'Memproses…' : registering ? 'Daftar' : 'Masuk'}
            </button>
            <button type="button" className="auth-swap"
              onClick={() => { setRegistering(v => !v); setError(''); setNote(''); setConfirm('') }}>
              {registering ? 'Sudah punya akun? Masuk' : 'Kapten tim, belum punya akun? Daftar'}
            </button>
          </form>
        </div>
      )}
    </RoleCtx.Provider>
  )
}
