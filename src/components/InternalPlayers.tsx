import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Gender, ShirtSize, TourLevel, TourPlayer, TournamentState } from '../types'
import {
  LEVELS, LEVEL_CLASS, SIZES, duplicateNumbers, loadTournament, newPlayerId,
} from '../internalMatch'
import { TOURNAMENT_ID, supabase, uploadPlayerPhoto, upsertTournament } from '../supabase'
import { useIsAdmin } from '../RoleContext'

/** '' | '07' | 'abc' -> undefined | 7 | undefined */
function parseNumber(v: string): number | undefined {
  const n = Number(v.trim())
  return v.trim() && Number.isInteger(n) && n >= 0 && n < 1000 ? n : undefined
}

/** Only http(s) links reach the public page's <img src>; '' clears the photo. */
function parsePhotoUrl(v: string): string | undefined | null {
  const t = v.trim()
  if (!t) return undefined
  // A Drive share link (…/file/d/<id>/view, or ?id=<id>) is a viewer page, not
  // an image; the thumbnail endpoint serves the file itself, resized. The file
  // must be shared as "anyone with the link".
  const drive = /^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]+)/.exec(t)
  if (drive) return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w1000`
  try { return /^https?:$/.test(new URL(t).protocol) ? t : null } catch { return null }
}

if (import.meta.env.DEV) {
  const thumb = 'https://drive.google.com/thumbnail?id=1flOg0hS0VLF4D-zYGVC6p8dSYPGq1U5y&sz=w1000'
  console.assert(parsePhotoUrl('https://drive.google.com/file/d/1flOg0hS0VLF4D-zYGVC6p8dSYPGq1U5y/view?usp=share_link') === thumb, '[photo] drive share link')
  console.assert(parsePhotoUrl('https://drive.google.com/open?id=1flOg0hS0VLF4D-zYGVC6p8dSYPGq1U5y') === thumb, '[photo] drive open link')
  console.assert(parsePhotoUrl(thumb) === thumb, '[photo] thumbnail link not stable')
  console.assert(parsePhotoUrl('https://x.com/a.jpg') === 'https://x.com/a.jpg', '[photo] plain link changed')
  console.assert(parsePhotoUrl('javascript:alert(1)') === null, '[photo] non-http accepted')
}

const MAX_PHOTO_MB = 5

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

function exportXLSX(players: TourPlayer[]) {
  const rows = groupRoster(players).flatMap(g =>
    g.rows.map((p, i) => [
      i + 1, p.name, p.number ?? '', p.jersey ?? '', p.size ?? '',
      g.label, p.gender === 'F' ? 'Putri' : 'Putra',
    ]),
  )
  const sheet = [['No', 'Nama', 'No. PB', 'Nama Baju', 'Size', 'Grade', 'Gender'], ...rows]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), 'Baju Internal')
  XLSX.writeFile(wb, `pbsor-baju-internal-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/** Level groups in table order, with jersey-only players in a trailing group. */
function groupRoster(players: TourPlayer[]) {
  const byName = (a: TourPlayer, b: TourPlayer) => a.name.localeCompare(b.name)
  const groups = LEVELS.map(l => ({
    key: l as string,
    label: l as string,
    cls: LEVEL_CLASS[l],
    rows: players.filter(p => !p.external && p.level === l).sort(byName),
  }))
  const ext = players.filter(p => p.external).sort(byName)
  if (ext.length) groups.push({ key: 'LUAR', label: 'Luar Internal', cls: 'lvl-luar', rows: ext })
  return groups
}

/** Photo with initials underneath, so a dead link falls back instead of showing a broken icon. */
function Face({ p, className }: { p: TourPlayer; className: string }) {
  return (
    <span className={className} data-empty={p.photo ? undefined : ''}>
      <span className="ip-initials" aria-hidden="true">{initials(p.name)}</span>
      {p.photo && (
        <img src={p.photo} alt="" loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none' }} />
      )}
    </span>
  )
}

export function InternalPlayers() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [noPhotoOnly, setNoPhotoOnly] = useState(false)
  const [newName, setNewName] = useState('')
  const [uploading, setUploading] = useState<string | null>(null)

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    // Fallback poll in case the Realtime WebSocket drops, same as the session
    // view. Admins poll too now that Realtime keeps them in sync.
    refetchInterval: 60_000,
  })

  const mut = useMutation({ mutationFn: upsertTournament })

  // Realtime: pick up another device's save the moment it lands. The row is a
  // single blob, so any write is a full-roster update.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('tournament-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${TOURNAMENT_ID}` },
        () => { qc.invalidateQueries({ queryKey: ['tournament'] }) },
      )
      .subscribe()
    return () => { supabase?.removeChannel(channel) }
  }, [qc])

  if (!state) return <div className="im-loading">Memuat daftar pemain…</div>

  // ponytail: commits on blur (text) or change (select), not per keystroke, so
  // no debounce is needed — unlike the team builder, which edits a name field
  // that re-renders on every character.
  const save = (next: TournamentState) => {
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
  }
  const patch = (fn: (ps: TourPlayer[]) => TourPlayer[]) =>
    save({ ...state, players: fn(state.players) })

  const edit = (id: string, p: Partial<TourPlayer>) =>
    patch(ps => ps.map(x => (x.id === id ? { ...x, ...p } : x)))

  /**
   * Warns before handing out a number someone else already wears. Overridable
   * rather than blocking: swapping two players' numbers has to pass through a
   * moment where they collide, and one real duplicate (7) predates this page.
   */
  const confirmNumber = (n: number | undefined, selfId?: string) => {
    if (n === undefined) return true
    const owner = state.players.find(x => x.number === n && x.id !== selfId)
    return !owner || confirm(`Nomor ${n} sudah dipakai ${owner.name}. Tetap pakai?`)
  }

  // Name only: grade, gender, number and the rest are set on the card that
  // opens straight after, where every field already has a home.
  const addPlayer = () => {
    const name = newName.trim()
    if (!name) return
    const id = newPlayerId(name, state.players)
    patch(ps => [...ps, { id, name, level: 'B1', gender: 'M', team: null }])
    setNewName('')
    setSearch('')
    setNoPhotoOnly(false)
    setSelected(id)
  }

  const removePlayer = (p: TourPlayer) => {
    if (!confirm(`Hapus ${p.name} dari daftar? Ini juga menghapusnya dari turnamen.`)) return
    patch(ps => ps.filter(x => x.id !== p.id))
    setSelected(null)
  }

  const uploadPhoto = async (p: TourPlayer, file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return alert('File harus berupa gambar.')
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) return alert(`Foto maksimal ${MAX_PHOTO_MB} MB.`)
    setUploading(p.id)
    try {
      const photo = await uploadPlayerPhoto(file, p.id)
      // Read the roster fresh: `state` is from before the upload started, and
      // saving it would undo any edit made while the file was in flight.
      const latest = qc.getQueryData<TournamentState>(['tournament']) ?? state
      save({ ...latest, players: latest.players.map(x => (x.id === p.id ? { ...x, photo } : x)) })
    } catch (e) {
      alert(`Gagal upload foto ${p.name}: ${(e as Error).message}`)
    } finally {
      setUploading(null)
    }
  }

  const dups = duplicateNumbers(state.players)
  const withPhoto = state.players.filter(p => p.photo).length
  const q = search.trim().toLowerCase()
  const matches = (p: TourPlayer) =>
    (!noPhotoOnly || !p.photo) &&
    (!q || p.name.toLowerCase().includes(q) || (p.jersey ?? '').toLowerCase().includes(q)
      || String(p.number ?? '') === q)
  const groups = groupRoster(state.players)
    .map(g => ({ ...g, rows: g.rows.filter(matches) }))
    .filter(g => g.rows.length)
  const current = state.players.find(p => p.id === selected)

  return (
    <section className="ip">
      <header className="ip-head">
        <div>
          <h2>Roster</h2>
          <p className="ip-head-sub">
            {withPhoto} dari {state.players.length} pemain sudah punya foto di halaman ranking.
          </p>
        </div>
        {isAdmin && (
          <button className="btn btn-ghost btn-sm" onClick={() => exportXLSX(state.players)}>
            Export Excel
          </button>
        )}
      </header>

      {dups.size > 0 && (
        <div className="ip-warn">
          Nomor dipakai lebih dari satu orang: <b>{[...dups].sort((a, b) => a - b).join(', ')}</b>
        </div>
      )}

      <div className="ip-tools">
        <input
          className="ip-in ip-search" type="search" value={search}
          placeholder="Cari nama atau nomor" aria-label="Cari pemain"
          onChange={e => setSearch(e.target.value)}
        />
        <button className="ip-chip" aria-pressed={noPhotoOnly} onClick={() => setNoPhotoOnly(v => !v)}>
          Belum ada foto <span>{state.players.length - withPhoto}</span>
        </button>
        {isAdmin && (
          <form className="ip-new" onSubmit={e => { e.preventDefault(); addPlayer() }}>
            <input
              className="ip-in" value={newName} placeholder="Nama pemain baru"
              aria-label="Nama pemain baru" onChange={e => setNewName(e.target.value)}
            />
            <button className="btn btn-ghost btn-sm" type="submit" disabled={!newName.trim()}>
              Tambah
            </button>
          </form>
        )}
      </div>

      <div className={`ip-body${current ? ' has-card' : ''}`}>
        <div className="ip-list">
          {groups.length === 0 && (
            <p className="ip-none">
              {noPhotoOnly && !q ? 'Semua pemain sudah punya foto.' : 'Tidak ada pemain yang cocok. Coba kata lain.'}
            </p>
          )}
          {groups.map(({ key, label, cls, rows }) => (
            <div className="ip-group" key={key}>
              <h3 className="ip-group-h">
                <span className={`lvl-badge ${cls}`}>{label}</span>
                <span className="ip-count">{rows.length} orang</span>
              </h3>
              <ul>
                {rows.map(p => {
                  const dup = p.number !== undefined && dups.has(p.number)
                  return (
                    <li key={p.id}>
                      <button
                        className="ip-row" aria-current={p.id === selected ? 'true' : undefined}
                        onClick={() => setSelected(p.id === selected ? null : p.id)}
                      >
                        <span className={`ip-num${dup ? ' dup' : ''}${p.number === undefined ? ' none' : ''}`}
                          title={dup ? 'Nomor ini dipakai dua pemain' : undefined}>
                          {p.number ?? '–'}
                        </span>
                        <Face p={p} className="ip-face" />
                        <span className="ip-who">
                          <span className="ip-name">
                            {p.name}{p.gender === 'F' && <span className="im-w">W</span>}
                          </span>
                          {p.jersey && p.jersey.toLowerCase() !== p.name.toLowerCase() && <span className="ip-jersey">{p.jersey}</span>}
                        </span>
                        <span className="ip-size">{p.size ?? ''}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <aside className="ip-card-wrap" aria-label="Detail pemain">
          {current ? (
            <PlayerCard
              key={current.id} p={current} isAdmin={isAdmin}
              uploading={uploading === current.id} busy={uploading !== null}
              dup={current.number !== undefined && dups.has(current.number)}
              onEdit={p => edit(current.id, p)}
              onUpload={f => uploadPhoto(current, f)}
              confirmNumber={n => confirmNumber(n, current.id)}
              onRemove={() => removePlayer(current)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="ip-card-empty">
              Pilih pemain untuk mengatur foto, nomor, dan datanya. Begini tampilannya di halaman ranking.
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}

/**
 * One player as /rank shows them, with every field under it. Inputs are
 * uncontrolled on purpose: a Realtime refetch must never yank a half-typed
 * value out from under the editor. `key` on the caller remounts per player.
 */
function PlayerCard({ p, isAdmin, uploading, busy, dup, onEdit, onUpload, confirmNumber, onRemove, onClose }: {
  p: TourPlayer; isAdmin: boolean; uploading: boolean; busy: boolean; dup: boolean
  onEdit: (p: Partial<TourPlayer>) => void
  onUpload: (f?: File) => void
  confirmNumber: (n: number | undefined) => boolean
  onRemove: () => void
  onClose: () => void
}) {
  const [over, setOver] = useState(false)
  const lvlClass = p.external ? 'lvl-luar' : LEVEL_CLASS[p.level]

  const preview = (
    <>
      <Face p={p} className="ip-shot" />
      <span className="ip-shot-no">{p.number ?? ''}</span>
      <span className="ip-shot-foot">
        <span className="ip-shot-name">{p.name}</span>
        <span className={`lvl-badge ${lvlClass}`}>{p.external ? 'Luar' : p.level}</span>
      </span>
      {isAdmin && (
        <span className="ip-shot-hint">
          {uploading ? 'Mengunggah…' : p.photo ? 'Ganti foto' : 'Klik atau seret foto ke sini'}
        </span>
      )}
    </>
  )

  return (
    <div className="ip-card">
      <button className="ip-back btn btn-ghost btn-sm" onClick={onClose}>Kembali ke daftar</button>

      {isAdmin ? (
        <label
          className={`ip-preview${over ? ' over' : ''}${uploading ? ' busy' : ''}`}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); if (!busy) onUpload(e.dataTransfer.files[0]) }}
        >
          {preview}
          <input
            type="file" accept="image/*" disabled={busy} aria-label={`Upload foto ${p.name}`}
            onChange={e => { onUpload(e.target.files?.[0]); e.target.value = '' }}
          />
        </label>
      ) : (
        <div className="ip-preview">{preview}</div>
      )}

      {isAdmin ? (
        <div className="ip-fields">
          <div className="ip-field ip-wide">
            <label htmlFor="ip-photo">Atau tempel URL foto</label>
            <div className="ip-inline">
              {/* key: an upload replaces the URL, so remount to show it. */}
              <input
                id="ip-photo" key={p.photo ?? ''} className="ip-in" inputMode="url"
                placeholder="https://" defaultValue={p.photo ?? ''}
                onBlur={e => {
                  const url = parsePhotoUrl(e.target.value)
                  if (url === null) {
                    alert('URL foto harus diawali http:// atau https://')
                    e.target.value = p.photo ?? ''
                    return
                  }
                  if (url !== p.photo) onEdit({ photo: url })
                }}
              />
              {p.photo && (
                <button className="ip-text-btn" onClick={() => onEdit({ photo: undefined })}>Hapus foto</button>
              )}
            </div>
          </div>

          <div className="ip-field ip-wide">
            <label htmlFor="ip-name">Nama</label>
            <input
              id="ip-name" className="ip-in" defaultValue={p.name}
              onBlur={e => {
                const v = e.target.value.trim()
                // A blank name would make the row unfindable, so an empty
                // field snaps back instead of saving.
                if (!v) { e.target.value = p.name; return }
                if (v !== p.name) onEdit({ name: v })
              }}
            />
          </div>

          <div className="ip-field">
            <label htmlFor="ip-number">No. PB</label>
            <input
              id="ip-number" className={`ip-in${dup ? ' dup' : ''}`} inputMode="numeric"
              defaultValue={p.number ?? ''}
              aria-describedby={dup ? 'ip-number-dup' : undefined}
              onBlur={e => {
                const n = parseNumber(e.target.value)
                if (n === p.number) return   // no edit, no upsert
                if (!confirmNumber(n)) { e.target.value = String(p.number ?? ''); return }
                onEdit({ number: n })
              }}
            />
            {dup && <span id="ip-number-dup" className="ip-field-err">Nomor ini juga dipakai pemain lain.</span>}
          </div>

          <div className="ip-field">
            <label htmlFor="ip-jersey">Nama di baju</label>
            <input
              id="ip-jersey" className="ip-in" defaultValue={p.jersey ?? ''}
              onBlur={e => {
                const v = e.target.value.trim() || undefined
                if (v !== p.jersey) onEdit({ jersey: v })
              }}
            />
          </div>

          <fieldset className="ip-field ip-wide">
            <legend>Ukuran baju</legend>
            <div className="ip-seg ip-seg-4">
              {SIZES.map(s => (
                <button key={s} aria-pressed={p.size === s}
                  onClick={() => onEdit({ size: p.size === s ? undefined : s as ShirtSize })}>{s}</button>
              ))}
            </div>
          </fieldset>

          <div className="ip-field">
            <label htmlFor="ip-level">Grade</label>
            <select id="ip-level" className="ip-in" value={p.level}
              onChange={e => onEdit({ level: e.target.value as TourLevel })}>
              {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <fieldset className="ip-field">
            <legend>Divisi</legend>
            <div className="ip-seg">
              {([['M', 'Putra'], ['F', 'Putri']] as [Gender, string][]).map(([g, label]) => (
                <button key={g} aria-pressed={p.gender === g} onClick={() => onEdit({ gender: g })}>{label}</button>
              ))}
            </div>
          </fieldset>

          <button className="ip-text-btn danger ip-wide" onClick={onRemove}>Hapus {p.name} dari daftar</button>
        </div>
      ) : (
        <dl className="ip-facts">
          <dt>No. PB</dt><dd>{p.number ?? '—'}</dd>
          <dt>Nama di baju</dt><dd>{p.jersey ?? '—'}</dd>
          <dt>Ukuran</dt><dd>{p.size ?? '—'}</dd>
        </dl>
      )}
    </div>
  )
}
