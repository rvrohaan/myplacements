import { useState } from 'react'
import { Check, Copy, Mail, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EmailStatus } from '@/types'

/**
 * The handoff for a one-time password-setup link.
 *
 * Email is the only channel we can send ourselves (see the backend's
 * notifications service); SMS and WhatsApp need registrations that aren't in
 * place, so the WhatsApp button hands the message to the sender's own device
 * via wa.me instead of pretending we delivered it.
 */

/** The message that goes out with the link, on whichever channel. */
export function inviteMessage(name: string | undefined, url: string, collegeName?: string) {
  const who = collegeName ? `${collegeName} on MyPlacement.AI` : 'MyPlacement.AI'
  return (
    `${name ? `Hi ${name}, ` : ''}your account on ${who} is ready.\n\n` +
    `Set your password here:\n${url}\n\n` +
    `The link works once, and only for you.`
  )
}

export function whatsappHref(message: string) {
  // No phone number: wa.me opens the sender's WhatsApp and lets them pick the
  // recipient, which needs no Business API approval.
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

export function mailtoHref(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

const BTN =
  'inline-flex items-center justify-center gap-1.5 text-sm font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1'

/** Copy-to-clipboard button that confirms in place rather than via a toast. */
export function CopyButton({
  value,
  label = 'Copy link',
  copiedLabel = 'Copied',
  className,
}: {
  value: string
  label?: string
  copiedLabel?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return // clipboard blocked (insecure origin / denied): leave the label alone
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(BTN, 'border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5', className)}
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {copied ? copiedLabel : label}
    </button>
  )
}

/** Opens WhatsApp with the invite message ready to send. */
export function WhatsAppButton({ message, className }: { message: string; className?: string }) {
  return (
    <a
      href={whatsappHref(message)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(BTN, 'border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5', className)}
    >
      <MessageCircle className="w-4 h-4" />
      WhatsApp
    </a>
  )
}

/** Hands the message to the sender's own mail client. */
export function EmailButton({
  to,
  subject,
  body,
  className,
}: {
  to: string
  subject: string
  body: string
  className?: string
}) {
  return (
    <a
      href={mailtoHref(to, subject, body)}
      className={cn(BTN, 'border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5', className)}
    >
      <Mail className="w-4 h-4" />
      Email
    </a>
  )
}

/** Says plainly whether we sent the email, so nobody assumes we did. */
export function DeliveryNote({ status, email }: { status: EmailStatus; email: string }) {
  if (status === 'sent') {
    return (
      <p className="text-sm text-green-800">
        Emailed to <span className="font-medium">{email}</span>. Share the link below too if it
        hasn't arrived.
      </p>
    )
  }
  if (status === 'failed') {
    return (
      <p className="text-sm text-amber-800">
        The email to <span className="font-medium">{email}</span> didn't go out. Send the link
        yourself using the buttons below.
      </p>
    )
  }
  return (
    <p className="text-sm text-amber-800">
      No email was sent — share the link below instead.
    </p>
  )
}

/** The link itself, wrapping rather than overflowing its container. */
export function LinkBox({ url }: { url: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <code className="text-xs text-gray-700 break-all">{url}</code>
    </div>
  )
}
