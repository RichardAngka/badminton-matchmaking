import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Bracket, BracketKey, Score, TeamId } from '../types'
import {
  COURTS, DAY, EMPTY_BRACKET, PARTAI, elapsed, loadTournament, resolve, semis, setTiebreak, tally,
} from '../internalMatch'
import { TOURNAMENT_ID, supabase, upsertTournament } from '../supabase'
import { useIsAdmin } from '../RoleContext'

const DRAWS: Bracket['draw'][] = [2, 3, 4]
const PLACES = ['Juara', 'Runner-up', '2nd Runner-up']
const LABEL: Record<BracketKey, string> = { sf1: 'SF 1', sf2: 'SF 2', final: 'Final', third: 'Juara 3' }

export function InternalBracket() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const [, tick] = useState(0)   // the running clock below, once a minute

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    refetchInterval: 60_000,  // fallback in case the Realtime socket drops
  })

  const mut = useMutation({ mutationFn: upsertTournament })

  // Once a minute, so a court's running clock counts up without a reload.
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // Realtime, same as /internal/player: results show up on every open phone
  // the moment the admin enters a score.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('tournament-bracket')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${TOURNAMENT_ID}` },
        () => { qc.invalidateQueries({ queryKey: ['tournament'] }) },
      )
      .subscribe()
    return () => { supabase?.removeChannel(channel) }
  }, [qc])

  if (!state) return <div className="im-loading">Memuat bagan…</div>

  // Spread over the default so a row saved by an older shape of this page
  // still has every field.
  const b: Bracket = { ...EMPTY_BRACKET, ...state.bracket }
  const name = (t: TeamId) => state.teamNames[t]
  const { pairs, winner, podium } = resolve(b)

  // ponytail: whole-blob write per change, same last-write-wins as the other
  // internal pages. Scores are selects (one change = one write), so no debounce.
  const save = (bracket: Bracket) => {
    const next = { ...state, bracket }
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
  }

  const setDraw = (draw: Bracket['draw']) => {
    if (draw === b.draw) return
    if (Object.values(b.results ?? {}).some(Boolean) || Object.values(b.partai).some(Boolean)
      && !confirm('Ganti undian semifinal? Semua hasil akan direset.')) return
    save({ draw, partai: {}, tiebreak: {}, results: {} })
  }

  // One row per lapangan: what is on court now, or the last partai it held.
  // Read-only — the Mulai / Selesai buttons on /internal/jadwal write these two
  // fields, this is the same data facing everyone watching.
  const timed = (Object.keys(DAY) as BracketKey[]).flatMap(k =>
    (b.results?.[k] ?? []).map((res, p) => ({ k, p, res })).filter(x => x.res?.started))
  const rows = COURTS.map(ct => {
    const here = timed.filter(x => x.res.court === ct)
    const on = here.find(x => !x.res.ended)
    return { ct, on: !!on, x: on ?? here.sort((a, z) => z.res.ended! - a.res.ended!)[0] }
  })

  const card = (k: BracketKey, label: string, tbd: string[] = []) => (
    <MatchCard
      label={label}
      teams={pairs[k].map((t, i) => (t ? { id: t, name: name(t) } : { tbd: tbd[i] }))}
      score={tally(b, k)}
      tiebreak={b.tiebreak[k]}
      winner={winner[k]}
      isAdmin={isAdmin}
      onTiebreak={t => save(setTiebreak(b, k, b.tiebreak[k] === t ? undefined : t))}
    />
  )

  return (
    <section className="ws-section">
      <div className="ws-head">
        <div className="ws-head-l">
          <h2>Bagan</h2>
          <span className="ws-head-sub">
            {isAdmin
              ? `Terisi sendiri dari poin di Line-up (dari ${PARTAI.length}). Seri 5–5 → partai tambahan.`
              : 'Semifinal → Final & Juara 3'}
          </span>
        </div>
      </div>

      {isAdmin && (
        <div className="im-segmented im-tabs" role="group" aria-label="Undian semifinal">
          {DRAWS.map(d => {
            const [[a, c], [e, f]] = semis(d)
            return (
              <button key={d} className={`im-seg${b.draw === d ? ' on' : ''}`}
                aria-pressed={b.draw === d} onClick={() => setDraw(d)}>
                <span className="im-tab-label">{a}v{c} · {e}v{f}</span>
              </button>
            )
          })}
        </div>
      )}

      {rows.some(r => r.x) && (
        <div className="br-courts">
          {rows.map(({ ct, on, x }) => (
            <div key={ct} className={`br-court${on ? ' on' : ''}`}>
              <span className="br-court-n">Lapangan {ct}</span>
              {x ? (
                <>
                  <span className="br-court-m">{LABEL[x.k]} · P{x.p + 1}</span>
                  <span className="br-court-t">
                    {pairs[x.k].map(t => (t ? name(t) : '–')).join('  vs  ')}
                  </span>
                  <span className="br-court-d">
                    {on ? `▶ ${elapsed(x.res)}′` : `${elapsed(x.res)} menit`}
                  </span>
                </>
              ) : <span className="br-court-m">Kosong</span>}
            </div>
          ))}
        </div>
      )}

      <div className="br">
        <div className="br-semis">
          <div className="br-slot">{card('sf1', 'Semifinal 1')}</div>
          <div className="br-slot">{card('sf2', 'Semifinal 2')}</div>
        </div>
        <div className="br-final">
          {card('final', 'Final', ['Pemenang SF 1', 'Pemenang SF 2'])}
        </div>
        <div className="br-third">
          {card('third', 'Perebutan Juara 3', ['Kalah SF 1', 'Kalah SF 2'])}
        </div>
      </div>

      <div className="br-podium">
        {PLACES.map((label, i) => (
          <div key={label} className={`br-place${i === 0 ? ' gold' : ''}`}>
            <span className="br-place-label">{label}</span>
            <span className="br-place-name">{podium[i] ? name(podium[i]) : '—'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function MatchCard({ label, teams, score, tiebreak, winner, isAdmin, onTiebreak }: {
  label: string
  teams: ({ id: TeamId; name: string } | { tbd: string })[]
  score?: Score
  tiebreak?: TeamId
  winner?: TeamId
  isAdmin: boolean
  onTiebreak: (t: TeamId) => void
}) {
  const ready = teams.every(t => 'id' in t)
  const tied = score?.[0] === PARTAI.length / 2 && score[1] === PARTAI.length / 2
  const named = teams.filter((t): t is { id: TeamId; name: string } => 'id' in t)

  return (
    <div className="br-match">
      <div className="br-label">{label}</div>
      {teams.map((t, i) => {
        if (!('id' in t)) return <div key={t.tbd} className="br-team tbd">{t.tbd}</div>
        const mine = score?.[i]
        return (
          <div key={t.id} className={`br-team${winner === t.id ? ' win' : winner ? ' lose' : ''}`}>
            <span className="br-team-name">{t.name}</span>
            {winner === t.id && <span className="br-check" aria-label="Menang">✓</span>}
            {/* Counted from the points entered on /internal/lineup, never typed here. */}
            <span className="br-partai static">{mine ?? ''}</span>
          </div>
        )
      })}
      {tied && (
        <div className="br-tb">
          <span className="br-label">Partai tambahan</span>
          {isAdmin
            ? <div className="br-tb-row">
                {named.map(t => (
                  <button key={t.id} className={`br-tb-btn${tiebreak === t.id ? ' on' : ''}`}
                    aria-pressed={tiebreak === t.id} onClick={() => onTiebreak(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            : <span className="br-tb-note">
                {named.find(t => t.id === tiebreak)?.name ?? 'Belum dimainkan'}
              </span>}
        </div>
      )}
    </div>
  )
}
