import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, HelpCircle } from 'lucide-react'
import { Modal, ModalTitle } from '@/components/ui/modal'
import { ConfirmContext, type ConfirmFn, type ConfirmOptions, type ConfirmTone } from '@/components/ui/confirm-context'
import { cn } from '@/lib/utils'

const TONES: Record<
  ConfirmTone,
  { Icon: typeof AlertTriangle; iconWrap: string; confirm: string }
> = {
  // Red is reserved for things that destroy saved data.
  danger: {
    Icon: AlertTriangle,
    iconWrap: 'bg-red-50 text-red-600',
    confirm: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500',
  },
  // Amber flags a costly-but-recoverable choice; the button stays neutral so it
  // never reads as "this deletes something".
  warning: {
    Icon: AlertCircle,
    iconWrap: 'bg-amber-50 text-amber-600',
    confirm: 'bg-gray-900 hover:bg-gray-800 focus-visible:ring-gray-700',
  },
  primary: {
    Icon: HelpCircle,
    iconWrap: 'bg-primary-50 text-primary-600',
    confirm: 'bg-primary-600 hover:bg-primary-700 focus-visible:ring-primary-500',
  },
}

const BUTTON_BASE =
  'min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2'

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

/**
 * Hosts the app's confirmation dialog and exposes it through useConfirm().
 * Mount once, above anything that can ask for confirmation.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const messageId = useId()
  // A dialog is already up if a second request arrives; answer the older one
  // with "cancel" rather than dropping its promise on the floor.
  const pendingRef = useRef<Pending | null>(null)
  pendingRef.current = pending

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false)
      setPending({ ...options, resolve })
    })
  }, [])

  const settle = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  const tone = TONES[pending?.tone ?? 'primary']

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal
          onClose={() => settle(false)}
          role="alertdialog"
          describedBy={messageId}
          panelClassName="w-full max-w-md"
        >
          <div className="p-6">
            <div className="flex gap-4">
              <span
                aria-hidden="true"
                className={cn('shrink-0 w-10 h-10 rounded-full grid place-items-center', tone.iconWrap)}
              >
                <tone.Icon className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <ModalTitle className="text-base">{pending.title}</ModalTitle>
                <div id={messageId} className="mt-1.5 text-sm text-gray-600 leading-relaxed">
                  {pending.message}
                </div>
              </div>
            </div>

            {/* Cancel comes first in the DOM so it takes initial focus: the safe
                answer should be one Enter away, the destructive one deliberate.
                Reversed on mobile to keep the primary action nearest the thumb. */}
            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className={cn(
                  BUTTON_BASE,
                  'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-400',
                )}
              >
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={cn(BUTTON_BASE, 'text-white shadow-sm', tone.confirm)}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

export { useConfirm } from '@/components/ui/confirm-context'
export type { ConfirmOptions, ConfirmTone } from '@/components/ui/confirm-context'
