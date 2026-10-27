'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, ApiError, jsonRequest } from '@/lib/api'
import { canAccess } from '@/lib/domain'
import type { Access, Module, SessionUser } from '@/lib/types'

interface SessionContextValue {
  user: SessionUser | null; loading: boolean; error: string; isManager: boolean
  refresh: () => Promise<void>; can: (module: Module, level?: Access) => boolean
  login: (username: string, password: string, initial?: boolean) => Promise<void>
  logout: () => Promise<void>
}
const SessionContext = createContext<SessionContextValue | null>(null)
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const epoch = useRef(0), changingIdentity = useRef(false)
  const refresh = useCallback(async () => {
    if (changingIdentity.current) return
    const requestEpoch = ++epoch.current
    try { const result = await api<SessionUser>('sesion'); if (requestEpoch === epoch.current) { setUser(result); setError('') } }
    catch (reason) {
      if (requestEpoch !== epoch.current) return
      if (reason instanceof ApiError && reason.status === 401) { setUser(null); setError('') }
      else setError(reason instanceof Error ? reason.message : 'No se pudo comprobar la sesión')
    }
    finally { if (requestEpoch === epoch.current) setLoading(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const onChange = () => { void refresh() }
    const timer = window.setInterval(onChange, 30000)
    window.addEventListener('sgp:session-change', onChange)
    return () => { ++epoch.current; clearInterval(timer); window.removeEventListener('sgp:session-change', onChange) }
  }, [refresh])
  const login = async (username: string, password: string, initial = false) => {
    const requestEpoch = ++epoch.current; changingIdentity.current = true
    try { const result = await api<SessionUser>(initial ? 'instalacion' : 'login', jsonRequest('POST', { username, password })); if (requestEpoch === epoch.current) { setUser(result); setError('') } }
    finally { changingIdentity.current = false }
  }
  const logout = async () => {
    const requestEpoch = ++epoch.current; changingIdentity.current = true
    try { await api('/logout'); if (requestEpoch === epoch.current) { setUser(null); setError('') } }
    finally { changingIdentity.current = false }
  }
  return <SessionContext.Provider value={{ user, loading, error, isManager: !!user && ['admin', 'jefe'].includes(user.rol), refresh, can: (module, level = 'ver') => canAccess(user, module, level), login, logout }}>{children}</SessionContext.Provider>
}
export function useSession() { const context = useContext(SessionContext); if (!context) throw new Error('Falta SessionProvider'); return context }
