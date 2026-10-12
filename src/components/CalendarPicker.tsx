import { useEffect, useRef } from 'react'
import { Calendar } from '@/components/ui/calendar'

interface Props {
  value: string  // YYYY-MM-DD
  onSelect: (d: string) => void
  onClose: () => void
}

export function CalendarPicker({ value, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const selected = value ? new Date(value + 'T00:00') : undefined

  return (
    <div ref={ref} className="cal-popup">
      {/* No upper bound on the dates: a session is set up before it is played,
          so next Tuesday has to be selectable. A date other than today is
          still admin-only to write (isHistorical in App). */}
      <Calendar
        mode="single"
        selected={selected}
        onSelect={(date) => {
          if (date) {
            onSelect(date.toLocaleDateString('en-CA'))
            onClose()
          }
        }}
        defaultMonth={selected}
      />
    </div>
  )
}
