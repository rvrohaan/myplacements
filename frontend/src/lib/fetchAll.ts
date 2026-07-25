import api from '@/lib/api'

// List endpoints cap `limit` (200), so a single request silently drops rows once
// a college grows past it — a picker would just be missing options with no error.
const PAGE_SIZE = 200

/**
 * Fetch every row of a list endpoint by paging through it with skip/limit.
 * Use for dropdowns and pickers that must show the complete set; paginated
 * tables should request one page at a time instead.
 */
export default async function fetchAll<T>(
  url: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const rows: T[] = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { data } = await api.get<T[]>(url, { params: { ...params, skip, limit: PAGE_SIZE } })
    rows.push(...data)
    // A short (or empty) page means we've reached the end.
    if (data.length < PAGE_SIZE) return rows
  }
}
