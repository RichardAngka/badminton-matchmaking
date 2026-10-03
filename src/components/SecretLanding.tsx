import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Gender, TourLevel, TourPlayer, TournamentState } from '../types'
import { LEVELS, applyJersey, seedState } from '../internalMatch'
import { fetchTournament } from '../supabase'
import '../secret.css'

// Divisions split by gender, and each one shows whichever tiers actually hold
// its players — so the three women who sit in A2 and B1 appear under Women, and
// a re-tier never needs a matching edit here.
const LABEL: Record<TourLevel, string> = {
  'A1+': 'A1+', A1: 'A1', A2: 'A2', B1: 'B1', B2: 'B2', 'W-B1': 'WB1', 'W-B2': 'WB2',
}
const DIVISIONS: [string, Gender][] = [['Men', 'M'], ['Women', 'F']]

const IG = 'https://www.instagram.com/pb.sor/'
const RANK_URL = '/rank'

// Court footage behind the hero mark — the squad photo stands in for it for
// anyone who has asked the OS for less motion. Empty renders the type treatment
// on black, the design's own fallback.
const HERO_VIDEO = '/hero.mp4'
const HERO_STILL = '/hero.jpg'
const STILL_ONLY = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Gold renders people and nothing else. The ramp runs light at the top of a
// ladder to deep at its foot, so depth reads without a second colour.
const RAMP: [number, number, number][] = [[0xD4, 0xAF, 0x37], [0x8A, 0x6A, 0x17]]
function goldAt(t: number) {
  const [a, b] = RAMP
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

// Squad numbers live in JERSEY, not in the stored row, so the page applies them
// the same way loadTournament() does.
// ponytail: read-only on purpose — loadTournament() writes the result back, and
// an anonymous visitor must never author the roster row.
const loadPublic = async (): Promise<TournamentState> =>
  applyJersey((await fetchTournament()) ?? seedState())

// Player photos, keyed by player id, served from public/players/. Empty until
// the shoot happens — every player falls back to their initials until then.
const PHOTOS: Record<string, string> = {}

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

/** Adds .sx-in to each .sx-rise as it scrolls into view. */
function useReveal(ready: boolean) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => entries.forEach(e => e.isIntersecting && e.target.classList.add('sx-in')),
      { rootMargin: '0px 0px -12% 0px' },
    )
    el.querySelectorAll('.sx-rise').forEach(n => io.observe(n))
    return () => io.disconnect()
  }, [ready])
  return root
}

/** One division's stage: a single player at a time, with arrows and dots. */
function Stage({ title, roster }: { title: string; roster: TourPlayer[] }) {
  const [i, setI] = useState(0)
  const n = roster.length
  if (!n) return null
  const at = Math.min(i, n - 1)
  const p = roster[at]
  const go = (d: number) => setI(v => (v + d + n) % n)

  return (
    <div className="sx-stage">
      <p className="sx-stage-cap">{title}</p>

      <div className="sx-slide">
        {PHOTOS[p.id] && <img className="sx-slide-img" src={PHOTOS[p.id]} alt="" />}
        <span className="sx-slide-no">{p.number ?? initials(p.name)}</span>

        <button
          className="sx-arrow sx-arrow-l" onClick={() => go(-1)}
          aria-label={`Previous ${title.toLowerCase()} player`}
        >&#8249;</button>
        <button
          className="sx-arrow sx-arrow-r" onClick={() => go(1)}
          aria-label={`Next ${title.toLowerCase()} player`}
        >&#8250;</button>

        <span className="sx-slide-foot">
          <span className="sx-slide-name">{p.name}</span>
          <span className="sx-slide-tier">{LABEL[p.level]}</span>
        </span>
      </div>

      <div className="sx-dots">
        {roster.map((q, k) => (
          <button
            key={q.id}
            className={`sx-dot-b${k === at ? ' on' : ''}`}
            onClick={() => setI(k)}
            aria-label={q.name}
            aria-current={k === at ? 'true' : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function Face({ p }: { p: TourPlayer }) {
  return PHOTOS[p.id]
    ? <img src={PHOTOS[p.id]} alt="" loading="lazy" />
    : <span className="sx-row-num">{initials(p.name)}</span>
}

function Bar({ onRank }: { onRank: boolean }) {
  // Section anchors only exist on the home page, so from /rank they have to
  // carry the path with them.
  const at = (hash: string) => (onRank ? `/${hash}` : hash)
  return (
    <header className="sx-bar">
      <div className="sx-bar-in">
        <a className="sx-brand" href={onRank ? '/' : '#top'}>
          <img src="/Logo PB SOR.png" alt="" />
          <span>PB SOR</span>
        </a>
        <nav className="sx-nav">
          <a href={RANK_URL} aria-current={onRank ? 'page' : undefined}>Rankings</a>
          <a href={at('#partners')}>Partners</a>
          <a href={at('#sponsorship')}>Sponsorship</a>
        </nav>
        <a className="sx-bar-cta" href={IG} target="_blank" rel="noreferrer">Instagram</a>
      </div>
    </header>
  )
}

function End({ onRank, total }: { onRank: boolean; total: number }) {
  const at = (hash: string) => (onRank ? `/${hash}` : hash)
  return (
    <footer className="sx-end">
      <div className="sx-wrap sx-end-in">
        <a className="sx-end-brand" href={onRank ? '/' : '#top'}>
          <img src="/Logo PB SOR.png" alt="PB SOR" />
        </a>
        <nav className="sx-end-cols">
          <div className="sx-end-col">
            <h4>Club</h4>
            <a href={RANK_URL}>Ranking overview</a>
            <a href={at('#rankings')}>Divisions &amp; tiers</a>
            <a href={at('#partners')}>Partners</a>
            <a href={at('#sponsorship')}>Sponsorship</a>
          </div>
          <div className="sx-end-col">
            <h4>Roster</h4>
            <a href={RANK_URL}>Men</a>
            <a href={RANK_URL}>Women</a>
            <a href={RANK_URL}>All {total} players</a>
          </div>
          <div className="sx-end-col">
            <h4>Social</h4>
            <a href={IG} target="_blank" rel="noreferrer">Instagram</a>
          </div>
        </nav>
      </div>
      <div className="sx-wrap sx-end-base">
        <p>
          Medan&apos;s ranked badminton club. {total} players, seven tiers, one ladder.
          <br />
          <span>&copy;{new Date().getFullYear()} PB SOR. All rights reserved.</span>
        </p>
        <a className="sx-top" href={onRank ? '#' : '#top'}>Back to top <span aria-hidden="true">&uarr;</span></a>
      </div>
    </footer>
  )
}

export function SecretLanding() {
  // ponytail: two static pages, so plain links and a path check beat adding a
  // router to a tree that deliberately sits outside the app's own one.
  const onRank = window.location.pathname.replace(/\/+$/, '') === RANK_URL

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadPublic,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    document.title = onRank ? 'Rankings — PB SOR' : 'PB SOR — Medan'
  }, [onRank])

  // A hash that arrives with the document: the browser looks for #partners and
  // gives up well before React has mounted the section, so jump once the roster
  // has landed and the sections are laid out.
  const jumped = useRef(false)
  useEffect(() => {
    if (jumped.current || !state) return
    const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
    if (!el) return
    jumped.current = true
    el.scrollIntoView({ behavior: 'instant' })
  }, [state])

  // Re-observe once the roster lands: anything rendered after first paint would
  // otherwise stay at opacity 0 forever.
  const root = useReveal(Boolean(state))

  const players = (state?.players ?? []).filter(p => !p.external)
  const seed = (p: TourPlayer) => LEVELS.indexOf(p.level)
  // Lowest squad number first; ponytail: numberless players sort last rather
  // than at the top, which is what 0 would do.
  const of = (sex: Gender) =>
    players.filter(p => p.gender === sex)
      .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
  /** The tiers a division actually fills, strongest first. */
  const tiersOf = (sex: Gender) =>
    LEVELS.filter(l => players.some(p => p.gender === sex && p.level === l))

  if (import.meta.env.DEV && players.length) {
    console.assert(
      of('M').length + of('F').length === players.length,
      '[secret] a player belongs to no division:',
      players.filter(p => p.gender !== 'M' && p.gender !== 'F'),
    )
  }

  // Each stage leads with the strongest of its division rather than a hand-kept
  // list, so the carousels cannot go stale.
  const topOf = (sex: Gender) =>
    [...of(sex)].sort((a, b) => seed(a) - seed(b)).slice(0, 8)

  const divisions = (
    <div className="sx-cols">
      {DIVISIONS.map(([title, sex]) => {
        const tiers = tiersOf(sex)
        return (
          <div className="sx-rise" key={title}>
            <h3 className="sx-col-h">
              {title}
              <span>{of(sex).length}</span>
            </h3>
            {tiers.map((lvl, i) => {
              const roster = of(sex).filter(p => p.level === lvl)
              const tone = goldAt(tiers.length > 1 ? i / (tiers.length - 1) : 0)
              return (
                <div className="sx-tier" key={lvl} style={{ ['--sx-tier' as string]: tone }}>
                  <div className="sx-tier-head">
                    <span className="sx-tier-code">{LABEL[lvl]}</span>
                    <span className="sx-tier-n">{roster.length} players</span>
                  </div>
                  <ul className="sx-rows">
                    {roster.map(p => (
                      <li className="sx-row" key={p.id}>
                        <span className="sx-row-face"><Face p={p} /></span>
                        <span className="sx-row-name">{p.name}</span>
                        <span className="sx-row-no">{p.number ?? ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
            {tiers.length === 0 && <p className="sx-empty">No players yet.</p>}
          </div>
        )
      })}
    </div>
  )

  // ── The dedicated rankings page ──────────────────────────────────────────
  if (onRank) {
    return (
      <div className="sx-page" ref={root}>
        <Bar onRank />
        <section className="sx-rank sx-rank-page">
          <div className="sx-wrap">
            <p className="sx-label sx-rise">Ranking overview</p>
            <h1 className="sx-h sx-rise">PB SOR Rankings</h1>
            <p className="sx-sub sx-rise">
              Placement is by standard, not by score. A1+ is the top of the
              ladder and B2 the foot of it; the women's division carries its own
              WB1 and WB2 tiers below A2.
            </p>
            {divisions}
          </div>
        </section>
        <End onRank total={players.length} />
      </div>
    )
  }

  // ── Home ─────────────────────────────────────────────────────────────────
  return (
    <div className="sx-page" ref={root}>
      <Bar onRank={false} />

      <section className="sx-hero" id="top">
        <div className="sx-hero-shot">
          {STILL_ONLY
            ? <img src={HERO_STILL} alt="" fetchPriority="high" />
            : <video src={HERO_VIDEO} autoPlay muted loop playsInline aria-hidden="true" />}
        </div>
        <div className="sx-wrap">
          <p className="sx-label sx-rise">Medan, Indonesia</p>
          <h1 className="sx-mark">PB SOR</h1>
          <p className="sx-tag">#SORCARIKERINGAT</p>

          <p className="sx-count">
            <span><b>{players.length}</b> ranked players.</span>
            <span>Seven tiers.</span>
            <span>One ladder.</span>
          </p>
        </div>
      </section>

      <section className="sx-rank" id="rankings">
        <div className="sx-wrap">
          <p className="sx-label sx-rise">Rankings</p>
          <h2 className="sx-h sx-rise">No points. Only the tier you earned.</h2>
          <p className="sx-sub sx-rise">
            Placement is by standard, not by score. These are the players at the
            top of each division.
          </p>
        </div>

        <div className="sx-wrap">
          <div className="sx-stages sx-rise">
            {DIVISIONS.map(([title, sex]) => (
              <Stage key={title} title={title} roster={topOf(sex)} />
            ))}
          </div>
        </div>

        <div className="sx-wrap">
          <a className="sx-more sx-rise" href={RANK_URL}>See all {players.length} players</a>
        </div>
      </section>

      <section className="sx-sponsors" id="partners">
        <div className="sx-wrap">
          <p className="sx-label sx-rise">Partners</p>
          <h2 className="sx-h sx-rise">Backed by businesses from Medan.</h2>
          <p className="sx-lede sx-rise">
            These names sit courtside every week the club plays, in front of
            every player on the roster.
          </p>
          <div className="sx-belt sx-rise">
            <div className="sx-belt-track">
              {[...SPONSORS, ...SPONSORS].map((s, i) => (
                <div
                  className={`sx-logo${s.tone ? ` sx-tone-${s.tone}` : ''}`}
                  key={`${s.name}-${i}`}
                  aria-hidden={i >= SPONSORS.length || undefined}
                >
                  {s.src
                    ? <img src={s.src} alt={i < SPONSORS.length ? s.name : ''} loading="lazy" />
                    : <span className="sx-logo-name">{s.name}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="sx-partner" id="sponsorship">
        <div className="sx-wrap">
          <p className="sx-label sx-rise">Sponsorship</p>
          <h2 className="sx-ask sx-rise">Put your name on a club that counts every player.</h2>
          <p className="sx-note sx-rise">
            {players.length} ranked players, seven tiers, four teams, and a season
            that runs every week. Message us and we'll show you where your logo
            would sit.
          </p>
          <a className="sx-cta sx-rise" href={IG} target="_blank" rel="noreferrer">
            Message us on Instagram
          </a>
        </div>
      </section>

      <End onRank={false} total={players.length} />
    </div>
  )
}

// Logos are the sponsors' own supplied files, placed as given. `tone` records
// how each file is composed, measured from the pixels rather than assumed, so
// the right filter renders it white on the dark band:
//   alpha = transparent PNG, light = opaque white bg, dark = opaque black bg.
// The two that arrived as PDFs have no image yet, so they are set as names.
type Tone = 'alpha' | 'light' | 'dark'
const SPONSORS: { name: string; src?: string; tone?: Tone }[] = [
  { name: '729 Kopitien', src: '/sponsors/729-kopitien.png', tone: 'alpha' },
  { name: 'Artifindo Solar Energy', src: '/sponsors/artifindo-solar.png', tone: 'alpha' },
  { name: 'ATK Medan Grosir' },
  { name: 'BWE Sports' },
  { name: '200 Mobil', src: '/sponsors/200-mobil.jpg', tone: 'dark' },
  { name: "De' Nail Studio", src: '/sponsors/de-nail-studio.jpg', tone: 'light' },
  { name: 'Aneka Seafood 88', src: '/sponsors/aneka-seafood-88.jpg', tone: 'light' },
]
