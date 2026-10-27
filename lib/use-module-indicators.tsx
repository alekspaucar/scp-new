'use client'

import { useEffect } from 'react'
import { useResource } from './api'
import { useSession } from '@/components/session-provider'
import type { Permissions } from './types'

interface Indicator { cantidad: number; etiqueta: string }
interface Indicators { contadores: Record<string, Indicator>; cuenta_id: number; permisos: Permissions }
const permissionScope = (permissions?: Permissions) => Object.entries(permissions || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}`).join(',')

export function useModuleIndicators() {
  const { user } = useSession()
  const scope = permissionScope(user?.permisos)
  const resource = useResource<Indicators>(user ? `indicadores?alcance=${encodeURIComponent(`${user.id}:${scope}`)}` : null, 6000)
  useEffect(() => {
    const refresh = () => { void resource.reload() }
    window.addEventListener('sgp:data-change', refresh)
    return () => window.removeEventListener('sgp:data-change', refresh)
  }, [resource.reload])
  const sameAccount = resource.data?.cuenta_id === user?.id && permissionScope(resource.data?.permisos) === scope
  return { ...resource, data: sameAccount ? resource.data : null }
}

export function ModuleCount({ value, label, className = '' }: { value?: Indicator; label?: string; className?: string }) {
  return value && value.cantidad > 0 ? <span className={`nav-count ${className}`} title={`${value.etiqueta}: ${value.cantidad}`} aria-label={`${label || value.etiqueta}: ${value.cantidad}`}>{value.cantidad > 99 ? '99+' : value.cantidad}</span> : null
}
