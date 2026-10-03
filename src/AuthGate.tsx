import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    if (!supabase) { setSession(null); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="auth-loading">…</div>

  if (session) {
    // Nothing left to log into; drop them at the dashboard.
    if (pathname === '/login') return <Navigate to="/" replace />
    const role = {
      admin: session.user.user_metadata?.role === 'admin',
      team: CAPTAINS[session.user.email?.toLowerCase() ?? ''] ?? null,
    }
    return <RoleCtx.Provider value={role}>{children}</RoleCtx.Provider>
  }

  // ponytail: always back to /login, no return-to; add a location-state hop if
  // deep links into the tool ever get shared.
  if (pathname !== '/login') return <Navigate to="/login" replace />

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
    <div className="auth-page">
      <header className="auth-bar">
        <img src="/Logo PB SOR.png" alt="" />
        <span className="auth-mark">PB SOR</span>
      </header>

      <main className="auth-main">
        <div className="auth-lede">
          <h1>{registering ? 'Password kapten' : 'Papan matchmaking'}</h1>
          <p>
            {registering
              ? 'Pakai email kapten tim Anda, lalu buat password baru.'
              : 'Masuk sebagai admin atau kapten tim.'}
          </p>
        </div>

        <div className="auth-crossing">
      {/* 1 unit = 1 cm of a 6.10 × 13.40 m court: doubles boundary, singles
              sidelines, long and short service lines, centre lines. No net — a net
              is not a painted line, so the gold rule below plays that part. */}
          <svg className="auth-court" viewBox="0 0 610 1340" aria-hidden="true">
            <rect x="0" y="0" width="610" height="1340" />
            <line x1="46" y1="0" x2="46" y2="1340" />
            <line x1="564" y1="0" x2="564" y2="1340" />
            <line x1="0" y1="76" x2="610" y2="76" />
            <line x1="0" y1="472" x2="610" y2="472" />
            <line x1="0" y1="868" x2="610" y2="868" />
            <line x1="0" y1="1264" x2="610" y2="1264" />
            <line x1="305" y1="0" x2="305" y2="472" />
            <line x1="305" y1="868" x2="305" y2="1340" />
          </svg>
          <div className="auth-net" />
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" autoComplete="email" value={email}
              onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          {registering && (
            <p className="auth-hint">
              Email kapten: captain1@sor.com sampai captain4@sor.com.
            </p>
          )}
          <div className="auth-field">
            <label htmlFor="auth-password">{registering ? 'Password baru' : 'Password'}</label>
            <input id="auth-password" type="password" value={password}
              autoComplete={registering ? 'new-password' : 'current-password'}
              onChange={e => setPassword(e.target.value)} required />
          </div>
          {registering && (
            <div className="auth-field">
              <label htmlFor="auth-confirm">Ulangi password</label>
              <input id="auth-confirm" type="password" autoComplete="new-password"
                value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {note && <p className="auth-note">{note}</p>}
          <button type="submit" disabled={loading}>
            {registering
              ? (loading ? 'Menyimpan…' : 'Buat password')
              : (loading ? 'Masuk…' : 'Masuk')}
          </button>
          <button type="button" className="auth-swap"
            onClick={() => { setRegistering(v => !v); setError(''); setNote(''); setConfirm('') }}>
            {registering ? 'Sudah punya akun? Masuk' : 'Kapten tim belum punya akun? Buat password'}
          </button>
        </form>
      </main>

      <footer className="auth-foot">
        <a className="auth-home" href="/">Halaman utama PB SOR</a>
      </footer>
    </div>
  )
}
