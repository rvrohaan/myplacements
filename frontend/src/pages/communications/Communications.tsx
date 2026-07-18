import { useEffect, useState } from 'react'
import { Plus, Mail, Phone, MessageCircle, Users, Linkedin, Trash2, Clock, AlertTriangle } from 'lucide-react'
import api from '@/lib/api'
import type { Communication, CommunicationType, Company, HRContact } from '@/types'
import { cn, STATUS_COLORS, formatDate } from '@/lib/utils'

const TYPE_ICON: Record<CommunicationType, typeof Mail> = {
  email: Mail,
  call: Phone,
  whatsapp: MessageCircle,
  meeting: Users,
  linkedin: Linkedin,
}

const RESPONSE_LABEL: Record<string, string> = {
  awaited: 'Awaiting reply',
  received: 'Replied',
  no_response: 'No response',
}

export default function Communications() {
  const [tab, setTab] = useState<'timeline' | 'followups'>('timeline')
  const [items, setItems] = useState<Communication[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [companyFilter, setCompanyFilter] = useState('')
  const [showLog, setShowLog] = useState(false)

  const fetchItems = () => {
    setLoading(true)
    if (tab === 'followups') {
      api.get('/communications/followups').then((r) => setItems(r.data)).finally(() => setLoading(false))
    } else {
      const params: Record<string, string> = {}
      if (companyFilter) params.company_id = companyFilter
      api.get('/communications', { params }).then((r) => setItems(r.data)).finally(() => setLoading(false))
    }
  }

  useEffect(() => { fetchItems() }, [tab, companyFilter])
  useEffect(() => {
    api.get('/companies', { params: { limit: 200 } }).then((r) => setCompanies(r.data)).catch(() => {})
  }, [])

  const isOverdue = (d?: string) => !!d && new Date(d) < new Date()

  const markReplied = async (c: Communication) => {
    await api.put(`/communications/${c.id}`, { response_received: 'received' })
    fetchItems()
  }
  const remove = async (c: Communication) => {
    await api.delete(`/communications/${c.id}`)
    fetchItems()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          {(['timeline', 'followups'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                tab === t ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              {t === 'timeline' ? 'Timeline' : 'Pending follow-ups'}
            </button>
          ))}
          {tab === 'timeline' && (
            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
        <button onClick={() => setShowLog(true)} className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors">
          <Plus className="w-4 h-4" /> Log Communication
        </button>
      </div>

      {showLog && (
        <LogForm companies={companies} onClose={() => setShowLog(false)} onSaved={() => { setShowLog(false); fetchItems() }} />
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            {tab === 'followups' ? 'No pending follow-ups. 🎉' : 'No communications logged yet.'}
          </div>
        ) : (
          items.map((c) => {
            const Icon = TYPE_ICON[c.comm_type] ?? Mail
            return (
              <div key={c.id} className="flex items-start gap-3 p-4">
                <div className="mt-0.5 w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{c.company_name ?? `Company #${c.company_id}`}</span>
                    {c.hr_contact_name && <span className="text-xs text-gray-500">· {c.hr_contact_name}</span>}
                    <span className="text-xs text-gray-400 capitalize">· {c.comm_type}</span>
                    {c.response_received && (
                      <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_COLORS[c.response_received] ?? 'bg-gray-100 text-gray-700')}>
                        {RESPONSE_LABEL[c.response_received] ?? c.response_received}
                      </span>
                    )}
                  </div>
                  {c.subject && <p className="text-sm text-gray-700 mt-0.5">{c.subject}</p>}
                  {c.notes && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{c.notes}</p>}
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                    <span>{formatDate(c.communicated_at)}</span>
                    {c.next_followup_date && (
                      <span className={cn('flex items-center gap-1', isOverdue(c.next_followup_date) ? 'text-red-500 font-medium' : '')}>
                        {isOverdue(c.next_followup_date) ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        follow up {formatDate(c.next_followup_date)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.response_received !== 'received' && (
                    <button onClick={() => markReplied(c)} className="text-xs text-primary-600 hover:text-primary-800 font-medium">Mark replied</button>
                  )}
                  <button onClick={() => remove(c)} title="Delete" className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function LogForm({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [contacts, setContacts] = useState<HRContact[]>([])
  const [form, setForm] = useState({
    company_id: '',
    hr_contact_id: '',
    comm_type: 'email' as CommunicationType,
    subject: '',
    notes: '',
    response_received: 'awaited',
    next_followup_date: '',
    communicated_at: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!form.company_id) { setContacts([]); return }
    api.get(`/companies/${form.company_id}/hr-contacts`).then((r) => setContacts(r.data)).catch(() => setContacts([]))
  }, [form.company_id])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await api.post('/communications', {
        company_id: parseInt(form.company_id),
        hr_contact_id: form.hr_contact_id ? parseInt(form.hr_contact_id) : null,
        comm_type: form.comm_type,
        subject: form.subject || null,
        notes: form.notes || null,
        response_received: form.response_received || null,
        next_followup_date: form.next_followup_date || null,
        communicated_at: form.communicated_at || null,
      })
      onSaved()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to log communication')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">Log Communication</h3>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Company *</label>
          <select value={form.company_id} onChange={(e) => setForm((p) => ({ ...p, company_id: e.target.value, hr_contact_id: '' }))} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="" disabled>Select a company…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">HR contact</label>
          <select value={form.hr_contact_id} onChange={(e) => setForm((p) => ({ ...p, hr_contact_id: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" disabled={!form.company_id}>
            <option value="">— none —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Channel</label>
          <select value={form.comm_type} onChange={(e) => setForm((p) => ({ ...p, comm_type: e.target.value as CommunicationType }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="email">Email</option>
            <option value="call">Call</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="meeting">Meeting</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Response</label>
          <select value={form.response_received} onChange={(e) => setForm((p) => ({ ...p, response_received: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="awaited">Awaiting reply</option>
            <option value="received">Replied</option>
            <option value="no_response">No response</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
          <input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Campus drive proposal for 2026 batch" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Communicated on</label>
          <input type="datetime-local" value={form.communicated_at} onChange={(e) => setForm((p) => ({ ...p, communicated_at: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Next follow-up</label>
          <input type="datetime-local" value={form.next_followup_date} onChange={(e) => setForm((p) => ({ ...p, next_followup_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors">
            {submitting ? 'Saving…' : 'Log'}
          </button>
        </div>
      </form>
    </div>
  )
}
