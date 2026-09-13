import api from '@/lib/api'
import type { Company, Student } from '@/types'
import type { SearchOption } from '@/components/ui/search-select'

/**
 * Server-side searches behind the <SearchSelect> pickers.
 *
 * A `<select>` has to hold every row before the form can be used, which costs
 * more the bigger the client gets — at a hundred thousand students it means
 * paging the whole table into the browser first. These ask for the handful that
 * match what was typed instead.
 */

/** One page of matches is all a picker needs; the rest is what typing is for. */
export const PICKER_LIMIT = 20

export async function searchStudents(
  query: string,
  params: Record<string, string | number | boolean> = {},
): Promise<SearchOption[]> {
  const { data } = await api.get<Student[]>('/students', {
    params: { ...(query ? { search: query } : {}), limit: PICKER_LIMIT, sort: 'roll_number', ...params },
  })
  return data.map((s) => ({
    id: s.id,
    label: s.full_name || s.roll_number,
    hint: `${s.roll_number} \u00b7 ${s.branch}${s.batch_year ? ` \u00b7 ${s.batch_year}` : ''}`,
  }))
}

export async function searchCompanies(
  query: string,
  params: Record<string, string | number | boolean> = {},
): Promise<SearchOption[]> {
  const { data } = await api.get<Company[]>('/companies', {
    params: { ...(query ? { search: query } : {}), limit: PICKER_LIMIT, sort: 'name', order: 'asc', ...params },
  })
  return data.map((c) => ({
    id: c.id,
    label: c.name,
    hint: [c.sector, c.location].filter(Boolean).join(' \u00b7 ') || undefined,
  }))
}

/**
 * Drops rows the caller already holds — students enrolled on this module,
 * companies already assigned to this officer. The server can't know about a
 * choice made a second ago and not yet refetched.
 */
export function excluding(ids: Set<number>) {
  return (rows: SearchOption[]) => rows.filter((r) => !ids.has(r.id))
}
