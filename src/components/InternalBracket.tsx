import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Bracket, BracketKey, Score, TeamId } from '../types'
import { EMPTY_BRACKET, PARTAI, editMatch, loadTournament, resolve, semis } from '../internalMatch'
import { TOURNAMENT_ID, supabase, upsertTournament } from '../supabase'
import { useIsAdmin } from '../RoleContext'

const DRAWS: Bracket['draw'][] = [2, 3, 4]
const PLACES = ['Juara', 'Runner-up', '2nd Runner-up']

export function InternalBracket() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    refetchInterval: 60_000,  // fallback in case the Realtime socket drops
  })

  const mut = useMutation({ mutationFn: upsertTournament })

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
    if (Object.values(b.partai).some(Boolean)
      && !confirm('Ganti undian semifinal? Semua hasil akan direset.')) return
    save({ draw, partai: {}, tiebreak: {} })
  }

  const card = (k: BracketKey, label: string, tbd: string[] = []) => (
    <MatchCard
      label={label}
      teams={pairs[k].map((t, i) => (t ? { id: t, name: name(t) } : { tbd: tbd[i] }))}
      score={b.partai[k]}
      tiebreak={b.tiebreak[k]}
      winner={winner[k]}
      isAdmin={isAdmin}
      onScore={s => save(editMatch(b, k, s))}
      onTiebreak={t => save(editMatch(b, k, b.partai[k], b.tiebreak[k] === t ? undefined : t))}
    />
  )

  return (
    <section className="ws-section">
      <div className="ws-head">
        <div className="ws-head-l">
          <h2>Bagan</h2>
          <span className="ws-head-sub">
            {isAdmin
              ? `Isi partai yang dimenangkan (dari ${PARTAI.length}). Seri 5–5 → partai tambahan.`
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

function MatchCard({ label, teams, score, tiebreak, winner, isAdmin, onScore, onTiebreak }: {
  label: string
  teams: ({ id: TeamId; name: string } | { tbd: string })[]
  score?: Score
  tiebreak?: TeamId
  winner?: TeamId
  isAdmin: boolean
  onScore: (s: Score) => void
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
            {isAdmin && ready
              // All 10 partai are always played, so one side's count fixes the
              // other's: picking 4 here makes the opponent 6.
              ? <select className="br-partai" aria-label={`Partai ${t.name}`}
                  value={mine ?? ''}
                  onChange={e => {
                    const n = Number(e.target.value)
                    onScore(i === 0 ? [n, PARTAI.length - n] : [PARTAI.length - n, n])
                  }}>
                  {mine === undefined && <option value="" disabled>–</option>}
                  {Array.from({ length: PARTAI.length + 1 }, (_, n) =>
                    <option key={n} value={n}>{n}</option>)}
                </select>
              : <span className="br-partai static">{mine ?? ''}</span>}
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
