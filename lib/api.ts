'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export class ApiError extends Error {
  status: number
  details: Record<string, unknown>
  constructor(message: string, status: number, details: Record<string, unknown> = {}) { super(message); this.name = 'ApiError'; this.status = status; this.details = details }
}
const urlFor = (path: string) => path.startsWith('/') ? path : `/api/${path}`
async function checkedResponse(path: string, init: RequestInit = {}) {
  let response: Response
  try { response = await fetch(urlFor(path), { credentials: 'same-origin', cache: 'no-store', ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) }) }
  catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; throw new ApiError('No se pudo conectar. Comprueba que el servicio de esta instalación esté encendido y vuelve a intentar.', 0) }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (typeof window !== 'undefined' && [401, 403].includes(response.status) && !['login', 'sesion', 'instalacion'].includes(path.replace(/^\/api\//, ''))) window.dispatchEvent(new CustomEvent('sgp:session-change', { detail: response.status }))
    throw new ApiError(typeof body.error === 'string' ? body.error : response.status === 401 ? 'La sesión terminó. Ingresa nuevamente.' : response.status === 403 ? 'Tu cuenta no tiene permiso para esta acción.' : `No se pudo completar la solicitud (${response.status}).`, response.status, body)
  }
  if (typeof window !== 'undefined' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(init.method || '') && !/^(?:\/api\/)?(?:reportes\/|calculadora\/|login$|instalacion$|pedidos\/leer-documento$)/.test(path)) window.dispatchEvent(new Event('sgp:data-change'))
  return response
}
export async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await checkedResponse(path, init)
  if (response.status === 204) return {} as T
  return response.json() as Promise<T>
}
export const jsonRequest = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
export async function upload<T = Record<string, unknown>>(path: string, file: File): Promise<T> {
  const body = new FormData(); body.append('archivo', file)
  return api<T>(path, { method: 'POST', body })
}
export async function download(path: string, name: string, init?: RequestInit, inline = false): Promise<void> {
  // Open synchronously so browsers permit the print window after the request.
  const tab = inline ? window.open('about:blank', '_blank') : null
  try {
    const response = await checkedResponse(path, init)
    const url = URL.createObjectURL(await response.blob())
    if (inline && tab) { tab.opener = null; tab.location.href = url }
    else { const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click() }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (error) { tab?.close(); throw error }
}
export interface Resource<T> { data: T | null; loading: boolean; error: string; reload: () => Promise<void> }
export function useResource<T>(path: string | null, interval = 12000): Resource<T> {
  const [data, setData] = useState<T | null>(null), [loading, setLoading] = useState(Boolean(path)), [error, setError] = useState('')
  const generation = useRef(0), controller = useRef<AbortController | null>(null), pending = useRef(false)
  const reload = useCallback(async () => {
    if (!path) return
    const current = ++generation.current
    controller.current?.abort(); const active = new AbortController(); controller.current = active; pending.current = true
    try { const result = await api<T>(path, { signal: active.signal }); if (current === generation.current) { setData(result); setError('') } }
    catch (reason) { if (current === generation.current && !active.signal.aborted) setError(reason instanceof Error ? reason.message : 'Error de conexión') }
    finally { if (current === generation.current) { pending.current = false; setLoading(false) } }
  }, [path])
  useEffect(() => {
    setData(null); setError(''); setLoading(Boolean(path)); void reload()
    const timer = path && interval > 0 ? window.setInterval(() => { if (!document.hidden && !pending.current) void reload() }, interval) : null
    return () => { if (timer) clearInterval(timer); ++generation.current; controller.current?.abort() }
  }, [path, interval, reload])
  return { data, loading, error, reload }
}
