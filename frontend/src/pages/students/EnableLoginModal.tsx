import { useState } from 'react'
import { KeyRound, Copy, Check, Download } from 'lucide-react'
import type { EnableLoginResult } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

export default function EnableLoginModal({
  results,
  onClose,
}: {
  results: EnableLoginResult[]
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const asText = results
    .map((r) => `${r.roll_number}\t${r.full_name ?? ''}\t${r.temp_password}`)
    .join('\n')

  const copyAll = async () => {
    await navigator.clipboard.writeText(asText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadCsv = () => {
    const header = 'roll_number,full_name,temp_password\n'
    const body = results
      .map((r) => `${r.roll_number},"${r.full_name ?? ''}",${r.temp_password}`)
      .join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'student_logins.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg max-h-[85vh] flex flex-col">
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
            These temporary passwords are shown <strong>only once</strong>. Copy or download them now
            and share with students — they'll be asked to set a new password on first sign-in.
          </p>
        </div>

        <div className="px-6 py-3 overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase">
                <th scope="col" className="py-2">Roll No</th>
                <th scope="col" className="py-2">Name</th>
                <th scope="col" className="py-2">Temp password</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results.map((r) => (
                <tr key={r.student_id}>
                  <td className="py-2 text-gray-700">{r.roll_number}</td>
                  <td className="py-2 text-gray-600">{r.full_name ?? '—'}</td>
                  <td className="py-2 font-mono text-gray-900">{r.temp_password}</td>
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
            {copied ? 'Copied' : 'Copy'}
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
