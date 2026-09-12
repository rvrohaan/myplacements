import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-context'

interface ModalCtx {
  titleId: string
  requestClose: () => void
}

const Ctx = createContext<ModalCtx | null>(null)

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Fields a form dialog should open on, in preference to its close button. */
const CONTROLS = 'input:not([disabled]),select:not([disabled]),textarea:not([disabled])'

/**
 * Open dialogs, oldest first. Only the topmost one reacts to Escape and Tab, so
 * a confirmation stacked on a form doesn't leave both trapping the keyboard.
 */
const stack: symbol[] = []

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
  role = 'dialog',
  describedBy,
  labelledBy,
}: {
  onClose: () => void
  children: ReactNode
  panelClassName?: string
  isDirty?: boolean
  closeOnBackdrop?: boolean
  align?: 'center' | 'start'
  /** Use 'alertdialog' for confirmations, so assistive tech announces them at once. */
  role?: 'dialog' | 'alertdialog'
  describedBy?: string
  /** Overrides the <ModalTitle> wiring when the heading lives outside this shell. */
  labelledBy?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const confirm = useConfirm()

  // Keep the latest values in refs so the keydown listener (bound once) never
  // closes over stale state.
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  // True while the discard dialog is up, so a second Escape doesn't stack another.
  const askingRef = useRef(false)

  const requestClose = async () => {
    if (!dirtyRef.current) {
      onCloseRef.current()
      return
    }
    if (askingRef.current) return
    askingRef.current = true
    try {
      const discard = await confirmRef.current({
        title: 'Discard your changes?',
        message:
          'This form has changes you haven’t saved yet. Closing it now will lose them.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        tone: 'warning',
      })
      if (discard) onCloseRef.current()
    } finally {
      askingRef.current = false
    }
  }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  useEffect(() => {
    const id = Symbol('modal')
    stack.push(id)
    const isTopmost = () => stack[stack.length - 1] === id

    const prevFocus = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])

    // Move focus into the dialog: an explicit autofocus wins, then the first
    // form control — landing on the header's X instead would mean the first
    // thing typed goes nowhere.
    const auto = panel?.querySelector<HTMLElement>('[autofocus]')
    const firstControl = panel?.querySelector<HTMLElement>(CONTROLS)
    ;(auto ?? firstControl ?? focusables()[0] ?? panel)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopmost()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        void requestCloseRef.current()
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
      stack.splice(stack.indexOf(id), 1)
      // Only the last dialog on screen may hand scrolling back to the page.
      if (stack.length === 0) document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-black/50 p-4',
        align === 'center' ? 'items-center' : 'items-start overflow-y-auto',
      )}
      onClick={closeOnBackdrop ? () => void requestClose() : undefined}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-white rounded-2xl shadow-2xl outline-none',
          'animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none',
          panelClassName,
        )}
      >
        <Ctx.Provider value={{ titleId, requestClose: () => void requestClose() }}>
          {children}
        </Ctx.Provider>
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

/**
 * The guarded close for the surrounding modal. Use it for in-form Cancel
 * buttons so they run the same unsaved-changes check as Escape and the X,
 * instead of throwing the user's typing away silently.
 */
export function useModalClose() {
  const ctx = useContext(Ctx)
  return ctx?.requestClose ?? (() => {})
}

/**
 * A Cancel button wired to the modal's guarded close. Prefer this over an
 * onClick={onClose} of your own, which would discard a half-typed form without
 * asking.
 */
export function ModalCancelButton({
  children = 'Cancel',
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  const requestClose = useModalClose()
  return (
    <button
      type="button"
      onClick={requestClose}
      className={cn(
        'min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
        'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
    </button>
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
      className={cn(
        'p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
        className,
      )}
    >
      <X className="w-5 h-5" />
    </button>
  )
}
