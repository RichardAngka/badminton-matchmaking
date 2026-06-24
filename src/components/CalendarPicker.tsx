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
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const selected = value ? new Date(value + 'T00:00') : undefined

  return (
    <div ref={ref} className="cal-popup">
      <Calendar
        mode="single"
        selected={selected}
        onSelect={(date) => {
          if (date) {
            onSelect(date.toLocaleDateString('en-CA'))
            onClose()
          }
        }}
        disabled={(date) => date > new Date()}
        defaultMonth={selected}
      />
    </div>
  )
}
