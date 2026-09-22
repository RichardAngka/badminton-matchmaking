import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BracketKey, Slot, TeamId, TourPlayer, TournamentState } from '../types'
import {
  DAY, EMPTY_BRACKET, LEVELS, LEVEL_CLASS, PARTAI, SLOTS, WO,
  isHere, lineupOf, loadTournament, ready, resolve, setSlot,
} from '../internalMatch'
import { TOURNAMENT_ID, supabase, upsertTournament } from '../supabase'
import { useIsAdmin } from '../RoleContext'
import { LEVEL_COLOR } from './InternalMatch'

const MATCHES: [BracketKey, string][] = [
  ['sf1', 'SF 1'], ['sf2', 'SF 2'], ['final', 'Final'], ['third', 'Juara 3'],
]

type Side = { team: TeamId; name: string; slots: Slot[]; members: TourPlayer[]; here: Set<string> }

export function InternalLineup() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const [match, setMatch] = useState<BracketKey>('sf1')

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    refetchInterval: 60_000,  // fallback in case the Realtime socket drops
  })

  // Same scope as /internal/absen: writes land in the order they were made.
  const mut = useMutation({ mutationFn: upsertTournament, scope: { id: 'tournament' } })

  // Realtime, same as Bagan: a lineup appears on every phone the moment the
  // admin fills its last slot. Skipped while a write is in flight, so a
  // refetch can't swap the cache back to a state missing the admin's picks.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('tournament-lineup')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${TOURNAMENT_ID}` },
        () => { if (!qc.isMutating()) qc.invalidateQueries({ queryKey: ['tournament'] }) },
      )
      .subscribe()
    return () => { supabase?.removeChannel(channel) }
  }, [qc])

  if (!state) return <div className="im-loading">Memuat line-up…</div>

  const label = MATCHES.find(([k]) => k === match)![1]
  const day = DAY[match]
  const [ta, tb] = resolve({ ...EMPTY_BRACKET, ...state.bracket }).pairs[match]
  const side = (team: TeamId): Side => {
    const members = state.players
      .filter(p => !p.external && p.team === team)
      .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.name.localeCompare(b.name))
    return {
      team, members,
      name: state.teamNames[team],
      slots: lineupOf(state, team, day),
      here: new Set(members.filter(p => isHere(p, day)).map(p => p.id)),
    }
  }
  const sides = ta && tb ? [side(ta), side(tb)] : null
  const complete = !!sides && sides.every(s => ready(s.slots, s.here) === SLOTS.length)

  // ponytail: whole-blob write per pick, same last-write-wins as the other
  // internal pages. Picks are selects (one change = one write), so no debounce.
  const pick = async (s: Side, i: number, v: Slot) => {
    await qc.cancelQueries({ queryKey: ['tournament'] })  // an in-flight refetch would undo this pick
    const next: TournamentState = {
      ...state,
      lineups: { ...state.lineups, [s.team]: { ...state.lineups?.[s.team], [day]: setSlot(s.slots, i, v) } },
    }
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
  }

  return (
    <section className="ws-section">
      <div className="ws-head">
        <div className="ws-head-l">
          <h2>Line-up</h2>
          <span className="ws-head-sub">
            {isAdmin
              ? 'Tampil ke semua setelah kedua tim lengkap: pemain yang sudah hadir, atau WO.'
              : 'Susunan pemain tiap partai'}
          </span>
        </div>
      </div>

      <div className="im-segmented im-tabs" role="tablist" aria-label="Pertandingan">
        {MATCHES.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={match === k}
            className={`im-seg${match === k ? ' on' : ''}`} onClick={() => setMatch(k)}>
            <span className="im-tab-label">{l}</span>
          </button>
        ))}
      </div>

      {!sides ? <div className="im-empty">Menunggu hasil semifinal.</div>
        // Viewers see nothing until both sides are in, so neither captain can
        // counter-pick. ponytail: hidden in the UI only — the row is public,
        // real secrecy needs its own RLS-guarded table.
        : !isAdmin && !complete
          ? <div className="im-empty">
              Line-up belum lengkap · {sides.map(s => `${s.name} ${ready(s.slots, s.here)}/${SLOTS.length}`).join(' · ')}
            </div>
          : <>
              {isAdmin && (
                <div className="im-controls">
                  <button className="btn btn-ghost btn-sm" disabled={!complete}
                    onClick={() => exportPNG(label, sides)}>Export PNG</button>
                </div>
              )}
              <div className="lu-wrap">
                <table className="lu">
                  <colgroup><col className="lu-c0" /><col /><col /></colgroup>
                  <thead>
                    <tr>
                      <th aria-label="Partai" />
                      {sides.map(s => (
                        <th key={s.team} scope="col">
                          <span className="lu-team">{s.name}</span>
                          {isAdmin && (
                            <span className={`lu-count${ready(s.slots, s.here) === SLOTS.length ? ' ok' : ''}`}>
                              {ready(s.slots, s.here)}/{SLOTS.length}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PARTAI.map((levels, p) => (
                      <tr key={p}>
                        <th scope="row">
                          {levels.map((l, k) => (
                            <div key={k} className="lu-line">
                              <span className="lu-num">{k === 0 ? p + 1 : ''}</span>
                              <span className={`lvl-badge ${LEVEL_CLASS[l]}`}>{l}</span>
                            </div>
                          ))}
                        </th>
                        {sides.map(s => (
                          <td key={s.team}>
                            {levels.map((_, k) => (
                              <SlotCell key={k} side={s} i={p * 2 + k} isAdmin={isAdmin}
                                onPick={v => pick(s, p * 2 + k, v)} />
                            ))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>}
    </section>
  )
}

function SlotCell({ side, i, isAdmin, onPick }: {
  side: Side
  i: number
  isAdmin: boolean
  onPick: (v: Slot) => void
}) {
  const v = side.slots[i]
  const level = SLOTS[i]
  const p = side.members.find(m => m.id === v)
  const sub = p && p.level !== level && (
    <span className="lu-sub" title={`${p.level} main di slot ${level}`}>⚠{p.level}</span>
  )

  if (!isAdmin) {
    return (
      <div className="lu-line">
        {v === WO
          ? <span className="lu-name wo">WO</span>
          : <span className="lu-name">{p?.name}</span>}
        {sub}
      </div>
    )
  }

  // Where each teammate already plays, so picking one visibly moves them.
  const where = (id: string) => {
    const j = side.slots.indexOf(id)
    return j >= 0 && j !== i ? ` · P${(j >> 1) + 1}` : ''
  }
  // The closed select shows the picked option's label, so a no-show's own
  // label is what flags them in the table.
  const opt = (m: TourPlayer) => (
    <option key={m.id} value={m.id}>
      {m.name}{m.level !== level ? ` (${m.level})` : ''}
      {side.here.has(m.id) ? '' : ' · belum hadir'}{where(m.id)}
    </option>
  )
  const here = side.members.filter(m => side.here.has(m.id))
  const away = p && !side.here.has(p.id)
  return (
    <div className="lu-line">
      <select className={`lu-pick${v ? '' : ' empty'}${away ? ' away' : ''}`} value={v ?? ''}
        aria-label={`${side.name} partai ${(i >> 1) + 1} (${level})`}
        onChange={e => onPick(e.target.value || null)}>
        <option value="">–</option>
        <optgroup label={level}>{here.filter(m => m.level === level).map(opt)}</optgroup>
        <optgroup label="Pemain lain">{here.filter(m => m.level !== level).map(opt)}</optgroup>
        <optgroup label="Belum hadir">{side.members.filter(m => !side.here.has(m.id)).map(opt)}</optgroup>
        <option value={WO}>WO (walkover)</option>
      </select>
      {sub}
    </div>
  )
}

/** The selected match's lineup as one image, for the group chat. */
async function exportPNG(label: string, sides: Side[]) {
  await document.fonts.ready  // Inter must be loaded or the canvas falls back
  const PAD = 24, TITLE = 56, HEAD = 40, LINE = 26, ROW = LINE * 2 + 12
  const NUM = 30, LV = 60, COL = 240, GAP = 10
  const W = PAD * 2 + NUM + LV + COL * 2 + GAP
  const H = TITLE + HEAD + PARTAI.length * ROW + PAD
  const SCALE = 2  // retina-sharp when zoomed on a phone

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const g = canvas.getContext('2d')!
  g.scale(SCALE, SCALE)
  g.textBaseline = 'middle'
  g.fillStyle = '#0e0e0e'
  g.fillRect(0, 0, W, H)

  g.fillStyle = '#e5e2e1'
  g.font = '800 22px Inter, sans-serif'
  g.fillText(`Line-up · ${label}`, PAD, PAD + 14)

  const colX = (j: number) => PAD + NUM + LV + j * (COL + GAP)
  sides.forEach((s, j) => {
    g.fillStyle = '#adc7ff'
    g.fillRect(colX(j), TITLE, COL, HEAD)
    g.fillStyle = '#0A0800'
    g.font = '800 16px Inter, sans-serif'
    g.fillText(s.name, colX(j) + 12, TITLE + HEAD / 2, COL - 24)
  })

  PARTAI.forEach((levels, p) => {
    const y = TITLE + HEAD + p * ROW
    if (p % 2 === 0) {
      g.fillStyle = '#131313'
      g.fillRect(PAD, y, W - PAD * 2, ROW)
    }
    g.fillStyle = '#8b90a0'
    g.font = '800 14px "JetBrains Mono", monospace'
    g.fillText(String(p + 1), PAD + 6, y + 6 + LINE / 2)

    levels.forEach((lv, k) => {
      const cy = y + 6 + LINE * k + LINE / 2
      g.fillStyle = LEVEL_COLOR[lv]
      g.font = '800 11px Inter, sans-serif'
      g.fillText(lv, PAD + NUM, cy)

      sides.forEach((s, j) => {
        const m = s.members.find(x => x.id === s.slots[p * 2 + k])
        g.fillStyle = m ? '#e5e2e1' : '#8b90a0'
        g.font = `${m ? '' : 'italic '}600 14px Inter, sans-serif`
        // maxWidth squeezes an overlong name instead of spilling into the badge
        g.fillText(m ? m.name : 'WO', colX(j) + 12, cy, COL - 70)
        if (m && m.level !== lv) {
          g.fillStyle = '#FFB020'
          g.font = '800 11px Inter, sans-serif'
          g.textAlign = 'right'
          g.fillText(`⚠${m.level}`, colX(j) + COL - 12, cy)
          g.textAlign = 'left'
        }
      })
    })
  })

  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `pbsor-lineup-${label.replace(/\s/g, '').toLowerCase()}-${new Date().toLocaleDateString('en-CA')}.png`
  a.click()
}
