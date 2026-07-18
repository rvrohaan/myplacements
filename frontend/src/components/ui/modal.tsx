import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalCtx {
  titleId: string
  requestClose: () => void
}

const Ctx = createContext<ModalCtx | null>(null)

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Accessible modal shell: backdrop scrim, Escape-to-close, focus trap, focus
 * restore on unmount, body scroll lock, and an optional confirm-before-discard
 * guard for forms with unsaved changes. Wraps the existing per-modal markup —
 * pass the panel classes via `panelClassName` and the body as children.
 */
export function Modal({
  onClose,
  children,
  panelClassName,
  isDirty = false,
  closeOnBackdrop = true,
  align = 'center',
}: {
  onClose: () => void
  children: ReactNode
  panelClassName?: string
  isDirty?: boolean
  closeOnBackdrop?: boolean
  align?: 'center' | 'start'
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // Keep the latest values in refs so the keydown listener (bound once) never
  // closes over stale state.
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const requestClose = () => {
    if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return
    onCloseRef.current()
  }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])

    // Move focus into the dialog: honour an explicit autofocus, else first field.
    const auto = panel?.querySelector<HTMLElement>('[autofocus]')
    ;(auto ?? focusables()[0] ?? panel)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        panel?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-black/50 p-4',
        align === 'center' ? 'items-center' : 'items-start overflow-y-auto',
      )}
      onClick={closeOnBackdrop ? requestClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-white rounded-2xl shadow-2xl outline-none',
          'animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none',
          panelClassName,
        )}
      >
        <Ctx.Provider value={{ titleId, requestClose }}>{children}</Ctx.Provider>
      </div>
    </div>
  )
}

/** The dialog's accessible name — wires aria-labelledby to the visible heading. */
export function ModalTitle({ children, className }: { children: ReactNode; className?: string }) {
  const ctx = useContext(Ctx)
  return (
    <h2 id={ctx?.titleId} className={cn('text-lg font-semibold text-gray-800', className)}>
      {children}
    </h2>
  )
}

/** Labelled close (X) button that runs the same discard guard as Escape/backdrop. */
export function ModalClose({ className }: { className?: string }) {
  const ctx = useContext(Ctx)
  return (
    <button
      type="button"
      onClick={() => ctx?.requestClose()}
      aria-label="Close"
      className={cn('p-1 text-gray-400 hover:text-gray-600 rounded-lg', className)}
    >
      <X className="w-5 h-5" />
    </button>
  )
}
