import axios from 'axios'
import { getSubdomain } from '@/lib/tenant'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  // Signal the tenant explicitly; the dev proxy rewrites Host so the backend
  // can't infer the college from it in development.
  const tenant = getSubdomain()
  if (tenant) config.headers['X-Tenant'] = tenant
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only force a redirect when an *existing* session goes stale. A 401 from the
    // login request itself carries no token — let the login page show its own
    // error instead of hard-reloading (which would reset the staff/student tab).
    if (err.response?.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
