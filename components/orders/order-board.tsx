'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, Empty, Panel, Status } from '@/components/shared'
import { dueTone, fmt, fmtDate, parseEcuadorDate } from '@/lib/domain'
import type { Order, OrderState } from '@/lib/types'
import './orders.css'

export function useOrderClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return now
}

export function orderCountdown(value: string, now: number): string {
  const date = parseEcuadorDate(value)
  if (!date) return 'Sin fecha'
  const remaining = date.getTime() - now
  if (remaining <= 0) return 'Retrasado'
  const seconds = Math.floor(remaining / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24)
  return `${days ? `${days} d ` : ''}${hours % 24} h ${minutes % 60} min ${seconds % 60} s`
}

const stateClasses: Record<OrderState, string> = { 'En Cola': 'queue', Procesando: 'processing', Terminado: 'finished', Facturado: 'invoiced', 'Retiro en Fábrica': 'pickup', Entregado: 'delivered' }

export function orderDeadlineTone(order: Order, now: number, monitor = false) {
  if (!monitor) return dueTone(order.fecha_entrega, now)
  if (['Terminado', 'Facturado', 'Retiro en Fábrica', 'Entregado'].includes(order.estado)) return 'neutral'
  const date = parseEcuadorDate(order.fecha_entrega)
  if (!date) return 'neutral'
  const remaining = date.getTime() - now
  return remaining > 86400000 ? 'green' : remaining > 0 ? 'amber' : 'rose'
}

export function OrderCard({ order, onOpen, now, onAdvance, busy = false, expanded, children, monitor = false }: { order: Order; onOpen: (id: number) => void; now: number; onAdvance?: (order: Order) => void; busy?: boolean; expanded?: boolean; children?: ReactNode; monitor?: boolean }) {
  const contentId = useId(), expandable = expanded !== undefined
  return <Panel className={`order-card orders-state-${stateClasses[order.estado]}${expanded ? ' orders-card-expanded' : ''}`}>
    <button type="button" className="orders-card-button" disabled={busy} onClick={() => { if (!busy) onOpen(order.id) }} aria-expanded={expanded} aria-controls={expandable ? contentId : undefined} aria-label={`${expandable ? expanded ? 'Contraer ítems del' : 'Desplegar ítems del' : 'Abrir'} pedido ${order.id} de ${order.cliente}`}>
      <div className="order-top"><div className="order-name">{order.logo_url && <img className="orders-logo" src={order.logo_url} alt="" />}<div><strong>{order.cliente}</strong><span className="mono">#ORD-{order.id} · OC {order.orden_compra}</span></div></div><Status value={order.estado} /></div>
      <div className="orders-card-meta"><Status value={orderCountdown(order.fecha_entrega, now)} tone={orderDeadlineTone(order, now, monitor)} /><span>{fmtDate(order.fecha_entrega)}</span></div>
      <div className="orders-card-progress"><progress max={100} value={order.progreso || 0} aria-label="Progreso del pedido" /><span>{fmt(order.progreso || 0, 0)}%</span></div>
      <p className="subtle">{fmt(order.total_items)} ítems · {fmt(order.total_unidades)} unidades{order.tiene_faltantes_activos ? ' · Faltantes pendientes' : ''}</p>
      {expandable && <span className="orders-card-toggle">{expanded ? 'Ocultar ítems' : 'Ver ítems'}<ChevronDown aria-hidden="true" /></span>}
    </button>
    {onAdvance && !expanded && ['En Cola', 'Procesando'].includes(order.estado) && <div className="orders-actions orders-card-actions"><Button disabled={busy} onClick={() => onAdvance(order)}>{order.estado === 'En Cola' ? 'Iniciar producción' : 'Terminar pedido'}</Button></div>}
    {expandable && <div id={contentId} hidden={!expanded} className="orders-card-content">{expanded && children}</div>}
  </Panel>
}

export function OrderBoard({ orders, onOpen, now, onAdvance, busy, expandedId, renderExpanded, monitor = false }: { orders: Order[]; onOpen: (id: number) => void; now: number; onAdvance?: (order: Order) => void; busy?: boolean; expandedId?: number | null; renderExpanded?: (order: Order) => ReactNode; monitor?: boolean }) {
  const columns = [{ title: 'En Cola', states: ['En Cola'], tone: 'amber' }, { title: 'Procesando', states: ['Procesando'], tone: 'blue' }, { title: 'Por entregar', states: ['Terminado', 'Facturado'], tone: 'green' }]
  const sorted = [...orders].sort((a, b) => (parseEcuadorDate(a.fecha_entrega)?.getTime() ?? Infinity) - (parseEcuadorDate(b.fecha_entrega)?.getTime() ?? Infinity) || a.id - b.id)
  return <div className="kanban-grid">{columns.map(column => {
    const rows = sorted.filter(order => column.states.includes(order.estado))
    return <section className="kanban-column" key={column.title}><div className="column-heading"><div className="title-line"><i className={`column-dot ${column.tone}`} /><h3>{column.title}</h3></div><span className="count-badge">{rows.length}</span></div><div className="card-list">{rows.map(order => <OrderCard key={order.id} order={order} onOpen={onOpen} now={now} onAdvance={onAdvance} busy={busy} monitor={monitor} expanded={renderExpanded ? expandedId === order.id : undefined}>{expandedId === order.id && renderExpanded?.(order)}</OrderCard>)}{!rows.length && <Empty>Sin pedidos.</Empty>}</div></section>
  })}</div>
}
