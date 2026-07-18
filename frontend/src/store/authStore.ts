import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'
import api from '@/lib/api'

interface AuthState {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<User>
  studentLogin: (rollNumber: string, password: string) => Promise<User>
  resetPassword: (newPassword: string) => Promise<void>
  logout: () => void
  isAuthenticated: () => boolean
  mustResetPassword: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      login: async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password })
        localStorage.setItem('token', data.access_token)
        set({ user: data.user, token: data.access_token })
        return data.user as User
      },
      studentLogin: async (rollNumber, password) => {
        const { data } = await api.post('/auth/student/login', {
          roll_number: rollNumber,
          password,
        })
        localStorage.setItem('token', data.access_token)
        set({ user: data.user, token: data.access_token })
        return data.user as User
      },
      resetPassword: async (newPassword) => {
        const { data } = await api.post('/auth/reset-password', { new_password: newPassword })
        set({ user: data })
      },
      logout: () => {
        localStorage.removeItem('token')
        set({ user: null, token: null })
      },
      isAuthenticated: () => !!get().token,
      mustResetPassword: () => !!get().user?.must_reset_password,
    }),
    { name: 'auth-storage', partialize: (s) => ({ user: s.user, token: s.token }) }
  )
)
