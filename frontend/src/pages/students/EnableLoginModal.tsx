import { useState } from 'react'
import { KeyRound, Copy, Check, Download } from 'lucide-react'
import type { EnableLoginResult } from '@/types'
import { formatDate } from '@/lib/utils'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { CopyButton, WhatsAppButton, inviteMessage } from '@/components/ui/share-link'

/**
 * What comes back from switching student logins on: a one-time link each,
 * never a password. Student accounts hold no real email address, so nothing is
 * delivered automatically — these are the handoffs staff use instead.
 */
export default function EnableLoginModal({
  results,
  onClose,
}: {
  results: EnableLoginResult[]
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const asText = results
    .map((r) => `${r.roll_number}\t${r.full_name ?? ''}\t${r.invite_url}`)
    .join('\n')

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(asText)
    } catch {
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadCsv = () => {
    const header = 'roll_number,full_name,password_link,expires_at\n'
    const body = results
      .map((r) => `${r.roll_number},"${r.full_name ?? ''}",${r.invite_url},${r.expires_at}`)
      .join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'student_login_links.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const expires = results[0] ? formatDate(results[0].expires_at) : ''

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-2xl max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary-600" />
          <ModalTitle>
            Login enabled for {results.length} student{results.length > 1 ? 's' : ''}
          </ModalTitle>
        </div>
        <ModalClose />
      </div>

      <div className="px-6 py-3 border-b border-gray-100">
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Each student gets a personal link to set their own password — send each one only to the
          student it belongs to. Every link works once{expires ? `, and expires on ${expires}` : ''}.
          Students sign in with their roll number afterwards.
        </p>
      </div>

      <div className="px-6 py-3 overflow-y-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold text-gray-500 uppercase">
              <th scope="col" className="py-2">Roll No</th>
              <th scope="col" className="py-2">Name</th>
              <th scope="col" className="py-2 text-right">Password link</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.map((r) => (
              <tr key={r.student_id}>
                <td className="py-2 text-gray-700">{r.roll_number}</td>
                <td className="py-2 text-gray-600">{r.full_name ?? '—'}</td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-2">
                    <CopyButton
                      value={r.invite_url}
                      label="Copy"
                      copiedLabel="Copied"
                      className="px-3 py-1.5 text-xs"
                    />
                    <WhatsAppButton
                      message={inviteMessage(r.full_name, r.invite_url)}
                      className="px-3 py-1.5 text-xs"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-4 border-t border-gray-200 flex gap-2 justify-end">
        <button
          onClick={copyAll}
          className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy all'}
        </button>
        <button
          onClick={downloadCsv}
          className="flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors"
        >
          <Download className="w-4 h-4" />
          Download CSV
        </button>
      </div>
    </Modal>
  )
}
