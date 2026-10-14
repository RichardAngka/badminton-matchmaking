import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useDialog } from '../ui'
import { upsertMembers } from '../supabase'
import type { Gender, SkillLevel } from '../types'
import type { Member, MemberDay, MemberLists } from '../members'

const GRADES: SkillLevel[] = ['A1', 'A2', 'B1', 'B2']
const DAYS: [MemberDay, string][] = [['selasa', 'Selasa'], ['kamis', 'Kamis']]

// Rows carry a local key so deleting one does not hand its input to the next.
type Row = Member & { key: number }
let nextKey = 0
const toRows = (list: Member[]): Row[] => list.map(m => ({ ...m, key: nextKey++ }))
const toMembers = (rows: Row[]): Member[] => rows
  .map(({ name, skill, gender }) => ({ name: name.trim(), skill, ...(gender === 'F' ? { gender } : {}) }))
  .filter(m => m.name)

/** Both standing lists, edited as a draft and saved together. */
export function MemberEditor({ lists, ready, failed, onClose }: {
  lists: MemberLists; ready: boolean; failed: boolean; onClose: () => void
}) {
  const qc = useQueryClient()
  const [day, setDay] = useState<MemberDay>('selasa')
  const [draft, setDraft] = useState(() => ({ selasa: toRows(lists.selasa), kamis: toRows(lists.kamis) }))
  const [newName, setNewName] = useState('')
  const [newSkill, setNewSkill] = useState<SkillLevel>('B1')
  const [newGender, setNewGender] = useState<Gender>('M')
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: upsertMembers,
    onSuccess: saved => { qc.setQueryData(['members'], saved); onClose() },
    onError: (e: Error) => setError(`Gagal menyimpan: ${e.message}. Coba lagi.`),
  })

  const out = { selasa: toMembers(draft.selasa), kamis: toMembers(draft.kamis) }
  const dirty = JSON.stringify(out) !== JSON.stringify(lists)

  function close() {
    if (dirty && !confirm('Buang perubahan member yang belum disimpan?')) return
    onClose()
  }
  const dialog = useDialog(close)

  const rows = draft[day]
  const setRows = (f: (r: Row[]) => Row[]) => { setError(''); setDraft(d => ({ ...d, [day]: f(d[day]) })) }
  const patch = (key: number, p: Partial<Member>) => setRows(r => r.map(x => x.key === key ? { ...x, ...p } : x))

  function add() {
    const name = newName.trim()
    if (!name) return
    if (rows.some(r => r.name.trim().toLowerCase() === name.toLowerCase()))
      return setError(`${name} sudah ada di daftar ${day === 'selasa' ? 'Selasa' : 'Kamis'}.`)
    setRows(r => [{ name, skill: newSkill, gender: newGender, key: nextKey++ }, ...r])
    setNewName('')
  }

  function submit() {
    for (const [d, label] of DAYS) {
      const seen = new Set<string>()
      for (const m of out[d]) {
        const k = m.name.toLowerCase()
        if (seen.has(k)) { setDay(d); return setError(`${m.name} tertulis dua kali di daftar ${label}.`) }
        seen.add(k)
      }
    }
    save.mutate(out)
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal me" {...dialog} aria-labelledby="me-title" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="me-title">Member tetap</h2>
          <button className="btn btn-ghost btn-sm" onClick={close} aria-label="Tutup">✕</button>
        </div>

        <div className="me-days ci-seg" role="group" aria-label="Hari main">
          {DAYS.map(([d, label]) => (
            <button key={d} aria-pressed={day === d} onClick={() => { setDay(d); setError('') }}>
              {label} <span className="me-n">{toMembers(draft[d]).length}</span>
            </button>
          ))}
        </div>

        <form className="me-add" onSubmit={e => { e.preventDefault(); add() }}>
          <input className="config-input" value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Nama member baru" aria-label="Nama member baru" />
          <select className="config-input" value={newSkill} aria-label="Grade member baru"
            onChange={e => setNewSkill(e.target.value as SkillLevel)}>
            {GRADES.map(g => <option key={g}>{g}</option>)}
          </select>
          <select className="config-input" value={newGender} aria-label="Jenis kelamin member baru"
            onChange={e => setNewGender(e.target.value as Gender)}>
            <option value="M">Pria</option>
            <option value="F">Wanita</option>
          </select>
          <button className="btn btn-ghost" type="submit" disabled={!newName.trim()}>Tambah</button>
        </form>

        <div className="modal-body me-list">
          {rows.length === 0 && <p className="me-empty">Belum ada member di hari ini. Tambah lewat kolom di atas.</p>}
          {rows.map(r => (
            <div key={r.key} className="me-row">
              <span className={`skill-badge skill-${r.skill}${r.gender === 'F' ? ' w' : ''}`} aria-hidden="true">{r.skill}</span>
              <input className="config-input" value={r.name} aria-label="Nama"
                onChange={e => patch(r.key, { name: e.target.value })} />
              <select className="config-input" value={r.skill} aria-label={`Grade ${r.name}`}
                onChange={e => patch(r.key, { skill: e.target.value as SkillLevel })}>
                {GRADES.map(g => <option key={g}>{g}</option>)}
              </select>
              <select className="config-input" value={r.gender ?? 'M'} aria-label={`Jenis kelamin ${r.name}`}
                onChange={e => patch(r.key, { gender: e.target.value as Gender })}>
                <option value="M">Pria</option>
                <option value="F">Wanita</option>
              </select>
              <button className="me-del" aria-label={`Hapus ${r.name} dari daftar`} title="Hapus dari daftar"
                onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>✕</button>
            </div>
          ))}
        </div>

        <div className="me-foot">
          {failed && <p className="me-error" role="alert">Daftar member gagal dimuat, jadi belum bisa disimpan. Periksa koneksi lalu buka lagi.</p>}
          {error && <p className="me-error" role="alert">{error}</p>}
          <div className="me-actions">
            <button className="btn btn-ghost" onClick={close}>Batal</button>
            <button className="btn btn-primary" onClick={submit}
              disabled={!ready || !dirty || save.isPending}>
              {save.isPending ? 'Menyimpan…' : 'Simpan member'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
