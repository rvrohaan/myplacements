import { createContext, useContext, type ReactNode } from 'react'

/**
 * Visual weight of a confirmation. `danger` is for anything that destroys data,
 * `warning` for reversible-but-costly choices (losing a half-typed form),
 * `primary` for a plain "are you sure" with no downside.
 */
export type ConfirmTone = 'danger' | 'warning' | 'primary'

export interface ConfirmOptions {
  title: string
  /** Say what will happen and whether it can be undone — not just "Are you sure?". */
  message: ReactNode
  /** Name the action, e.g. "Delete record" — never a bare "OK". */
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

/**
 * Without a provider the app would deadlock on an unresolved promise, so the
 * fallback resolves true and complains in dev. <ConfirmProvider> is mounted at
 * the app root, so this should never fire in practice.
 */
const fallback: ConfirmFn = async (options) => {
  console.warn('useConfirm() used outside <ConfirmProvider>; auto-confirming', options.title)
  return true
}

export const ConfirmContext = createContext<ConfirmFn>(fallback)

/**
 * Promise-based replacement for window.confirm(). Renders an in-app dialog that
 * matches the product, is keyboard and screen-reader accessible, and lets the
 * confirm button show its own pending state.
 *
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: 'Delete note?', message: '…', tone: 'danger' }))) return
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext)
}
