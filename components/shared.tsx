'use client'

import { useEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { AlertTriangle, Check, LoaderCircle, RefreshCw, X } from 'lucide-react'
import type { Resource } from '@/lib/api'

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`glass-panel ${className}`}>{children}</div> }
export function Heading({ title, subtitle, eyebrow, actions }: { title: string; subtitle?: string; eyebrow?: string; actions?: ReactNode }) { return <div className="view-heading"><div>{eyebrow && <p className="eyebrow accent-text">{eyebrow}</p>}<h2>{title}</h2>{subtitle && <p className="subtle">{subtitle}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div> }
export function Button({ children, variant = 'soft', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'soft' | 'primary' | 'danger' }) { return <button type="button" className={`${variant === 'primary' ? 'primary-button' : variant === 'danger' ? 'danger-button' : 'soft-button'} ${className}`} {...props}>{children}</button> }
export function Empty({ children }: { children?: ReactNode }) { return <div className="empty-state">{children || 'Sin registros.'}</div> }
export function Status({ value, tone }: { value: string; tone?: string }) { const color = tone || (/listo|terminado|disponible|entregado|resuelto/i.test(value) ? 'green' : /agotado|crítico|retrasado|suspendido/i.test(value) ? 'rose' : /cola|bajo|pendiente/i.test(value) ? 'amber' : 'blue'); return <span className={`status-pill ${color}`}>{value}</span> }
export function Metric({ label, value, note, tone = 'blue' }: { label: string; value: ReactNode; note?: string; tone?: string }) { return <Panel className="metric-card"><div><p className="eyebrow">{label}</p><p className={`metric-value ${tone}`}>{value}</p></div>{note && <span className="metric-note">{note}</span>}</Panel> }
export function DataState<T>({ resource }: { resource: Resource<T> }) {
  if (resource.loading && !resource.data) return <div className="loading-state" role="status"><LoaderCircle className="spin" /> Cargando…</div>
  return resource.error ? <div className="feedback error" role="alert"><AlertTriangle /> <span>{resource.error}</span><Button onClick={() => void resource.reload()}><RefreshCw /> Reintentar</Button></div> : null
}
export function useTask() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const locked = useRef(false)
  async function run<T>(job: () => Promise<T>, message = ''): Promise<T | undefined> {
    if (locked.current) return undefined
    locked.current = true; setBusy(true); setError(''); setSuccess('')
    try { const result = await job(); setSuccess(message); return result }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo completar la acción'); return undefined }
    finally { locked.current = false; setBusy(false) }
  }
  return { busy, error, success, run, clear: () => { setError(''); setSuccess('') } }
}
export function Feedback({ task }: { task: { error?: string; success?: string } }) { return task.error ? <div className="feedback error" role="alert"><AlertTriangle /><span>{task.error}</span></div> : task.success ? <div className="feedback success" role="status"><Check /><span>{task.success}</span></div> : null }
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId()
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close() }, [])
  return <dialog ref={ref} className={`dialog-shell app-modal ${wide ? 'wide-dialog' : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === ref.current) onClose() }}>
    <button type="button" className="ghost-icon modal-close" aria-label="Cerrar ventana" onClick={onClose}><X aria-hidden="true" /></button>
    <div className="dialog-content"><header className="modal-heading"><h3 id={titleId}>{title}</h3></header>{children}</div>
  </dialog>
}
export function ScrollTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  const top = useRef<HTMLDivElement>(null), bottom = useRef<HTMLDivElement>(null), table = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const content = table.current, viewport = bottom.current
    if (!content || !viewport) return
    const observer = new ResizeObserver(() => setWidth(content.scrollWidth))
    observer.observe(content); observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => { if (from && to && Math.abs(from.scrollLeft - to.scrollLeft) > 1) to.scrollLeft = from.scrollLeft }
  return <div className={`scroll-table ${className}`}><div ref={top} className="table-top-scroll" onScroll={() => sync(top.current, bottom.current)} aria-label="Desplazamiento horizontal superior"><div style={{ width, height: 1 }} /></div><div ref={bottom} className="table-bottom-scroll" onScroll={() => sync(bottom.current, top.current)}><div ref={table} className="table-content">{children}</div></div></div>
}
