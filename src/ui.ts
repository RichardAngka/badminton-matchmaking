import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

/**
 * Dialog manners, in one place: Escape closes, focus lands inside on open, and
 * the overlay announces itself as a dialog. Spread the returned ref and props
 * onto the `.modal` element; the overlay stays a plain div.
 *
 * ponytail: no focus trap — Tab can still walk out behind the backdrop. Add one
 * if that ever actually bites someone on a keyboard.
 */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  // Callers pass inline arrows, so read onClose through a ref and let the
  // effect run once — otherwise every parent render re-steals focus mid-typing.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    // Focus the panel itself so Tab starts inside and a screen reader lands on
    // the title. A field that wants the caret (and the soft keyboard with it)
    // carries its own autoFocus.
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return { ref, role: 'dialog' as const, 'aria-modal': true, tabIndex: -1 }
}

/**
 * Makes a non-button element answer the keyboard the way it answers a mouse.
 * Pass the handler, or a falsy value when the element is not interactive — the
 * read-only and non-admin views then get no role, no tab stop and no focus ring.
 */
export function clickable(on: (() => void) | false | null | undefined) {
  if (!on) return {}
  return {
    role: 'button',
    tabIndex: 0,
    onClick: on,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on() }
    },
  }
}
