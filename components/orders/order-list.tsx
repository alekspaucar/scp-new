'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, DataState, Empty, Feedback, Heading, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import { useSession } from '@/components/session-provider'
import { api, download, jsonRequest, useResource } from '@/lib/api'
import { dateInput, dueTone, fmt, fmtDate, orderStates } from '@/lib/domain'
import { confirmAction } from '@/lib/confirm'
import type { Order } from '@/lib/types'
import { OrderDetail } from './order-detail'
import { OrderEditor } from './order-editor'
import { useCurrentOrderGuard, useOrderAction } from './order-action'
import './orders.css'

export function OrderList() {
  const { can, user } = useSession(), allowed = can('pedidos'), edit = can('pedidos', 'editar')
  const resource = useResource<Order[]>(allowed ? 'pedidos' : null), task = useTask()
  const [search, setSearch] = useState(''), [state, setState] = useState(''), [archive, setArchive] = useState('activos'), [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1), [selected, setSelected] = useState<number | null>(null), [editing, setEditing] = useState<Order | 'new' | null>(null)
  const action = useOrderAction(), busy = task.busy || action.busy
  const guard = useCurrentOrderGuard(edit), handledLink = useRef(false)
  const query = search.trim().toLocaleLowerCase()
  const rows = (resource.data || []).filter(order => {
    const day = dateInput(order.fecha_entrega).slice(0, 10)
    return (archive === 'todos' || (archive === 'archivo' ? order.estado === 'Entregado' : order.estado !== 'Entregado')) && (!state || order.estado === state) && (!from || day >= from) && (!to || Boolean(day) && day <= to) && `${order.id} ${order.cliente} ${order.orden_compra} ${(order.items || []).map(item => `${item.codigo} ${item.descripcion}`).join(' ')}`.toLocaleLowerCase().includes(query)
  })
  const pages = Math.max(1, Math.ceil(rows.length / 25)), currentPage = Math.min(page, pages), visible = rows.slice((currentPage - 1) * 25, currentPage * 25)
  useEffect(() => {
    if (!allowed || !edit || !resource.data || handledLink.current || action.isBusy()) return
    handledLink.current = true
    const params = new URLSearchParams(window.location.search), id = Number(params.get('editar'))
    const target = resource.data.find(order => order.id === id)
    if (Number.isSafeInteger(id) && id > 0 && target && (target.estado !== 'Entregado' || user?.rol === 'jefe')) void editOrder(id)
    else if (params.has('nuevo')) setEditing('new')
  }, [allowed, edit, resource.data, user?.rol, busy])
  async function remove(order: Order) {
    if (!edit || busy || action.isBusy()) return
    await action.run(async () => {
      if (!await confirmAction(`¿Eliminar definitivamente el pedido #${order.id} de ${order.cliente}, con sus ítems, entregas y faltantes?${order.estado === 'Entregado' ? ' Se revertirá el descuento de stock registrado.' : ''}`, { title: 'Eliminar pedido', confirmLabel: 'Eliminar pedido', danger: true })) return
      if (!guard()) return
      const result = await task.run(() => api(`pedidos/${order.id}`, jsonRequest('DELETE')), 'Pedido eliminado')
      if (result) await resource.reload()
    })
  }
  async function editOrder(id: number) {
    if (!guard() || busy || action.isBusy()) return
    const result = await task.run(() => api<Order>(`pedidos/${id}`))
    if (result && guard() && (result.estado !== 'Entregado' || user?.rol === 'jefe')) setEditing(result)
  }
  if (!allowed) return <Empty>No tienes acceso a Pedidos.</Empty>
  return <div className="view-stack orders-scope"><Heading title="Pedidos" actions={<><Button onClick={() => void resource.reload()}>Actualizar</Button>{edit && <Button variant="primary" disabled={busy} onClick={() => setEditing('new')}>Nuevo pedido</Button>}</>} /><DataState resource={resource} /><Feedback task={task} />
    <Panel className="table-card"><div className="orders-toolbar"><label>Buscar<input type="search" value={search} placeholder="Cliente, OC, pedido, código o descripción" onChange={event => { setSearch(event.target.value); setPage(1) }} /></label><label>Vista<select value={archive} onChange={event => { setArchive(event.target.value); setPage(1) }}><option value="activos">Activos</option><option value="todos">Todos</option><option value="archivo">Entregados</option></select></label><label>Estado<select value={state} onChange={event => { setState(event.target.value); setPage(1) }}><option value="">Todos los estados</option>{orderStates.map(value => <option key={value}>{value}</option>)}</select></label><span className="subtle" aria-live="polite">{rows.length} resultados</span></div>
      <details className="orders-filter-dates"><summary>Filtrar por fecha de entrega prometida{from || to ? ' · activo' : ''}</summary><div className="orders-toolbar"><label>Desde (entrega prometida)<input type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setPage(1) }} /></label><label>Hasta (entrega prometida)<input type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setPage(1) }} /></label>{(from || to) && <Button onClick={() => { setFrom(''); setTo(''); setPage(1) }}>Limpiar fechas</Button>}</div></details>
      <ScrollTable><table className="orders-table"><thead><tr><th>Pedido / OC</th><th>Cliente</th><th>Entrega prometida</th><th>Estado</th><th>Unidades</th><th>Acciones</th></tr></thead><tbody>{visible.map(order => <tr key={order.id} data-order-state={order.estado}><td><strong>#{order.id}</strong><p>{order.orden_compra}</p></td><td>{order.cliente}</td><td><Status value={fmtDate(order.fecha_entrega)} tone={order.estado === 'Entregado' ? 'green' : dueTone(order.fecha_entrega)} />{order.fecha_entregado && <p className="subtle">Entregado: {fmtDate(order.fecha_entregado)}</p>}</td><td><Status value={order.estado} /><div className="orders-row-progress"><progress max={100} value={Math.min(100, Math.max(0, order.progreso || 0))} aria-label={`Progreso del pedido #${order.id}`} /><span className="subtle">{fmt(order.progreso || 0, 0)}%</span></div></td><td>{fmt(order.total_unidades)}<p className="subtle">{order.total_items} ítems</p></td><td><div className="orders-actions"><Button disabled={busy} onClick={() => setSelected(order.id)}>Detalle</Button><Button disabled={busy} onClick={() => void task.run(() => download(`pedidos/${order.id}/pdf`, `pedido-${order.id}.pdf`))}>PDF</Button>{edit && <>{(order.estado !== 'Entregado' || user?.rol === 'jefe') && <Button disabled={busy} onClick={() => void editOrder(order.id)}>Editar</Button>}<Button variant="danger" disabled={busy} onClick={() => void remove(order)}>Eliminar</Button></>}</div></td></tr>)}</tbody></table></ScrollTable>
      {resource.data && !rows.length && <Empty>Sin pedidos para estos filtros.</Empty>}
      {rows.length > 0 && <nav className="orders-pagination" aria-label="Páginas de pedidos"><span className="subtle">{(currentPage - 1) * 25 + 1}–{Math.min(currentPage * 25, rows.length)} de {rows.length} · Página {currentPage} de {pages}</span>{pages > 1 && <div className="orders-actions"><Button disabled={currentPage === 1 || busy} onClick={() => setPage(currentPage - 1)}>Anterior</Button><Button disabled={currentPage === pages || busy} onClick={() => setPage(currentPage + 1)}>Siguiente</Button></div>}</nav>}
    </Panel>
    {selected !== null && <OrderDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void resource.reload()} />}
    {editing && <OrderEditor order={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void resource.reload() }} />}
  </div>
}
