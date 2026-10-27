'use client'

import { useState } from 'react'
import { Button, DataState, Empty, Feedback, Heading, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import { useSession } from '@/components/session-provider'
import { api, download, jsonRequest, useResource } from '@/lib/api'
import { dueTone, fmt, fmtDate, orderStates } from '@/lib/domain'
import { confirmAction } from '@/lib/confirm'
import type { Order } from '@/lib/types'
import { OrderDetail } from './order-detail'
import { OrderEditor } from './order-editor'
import { useOrderAction } from './order-action'
import './orders.css'

export function OrderList() {
  const { can, user } = useSession(), allowed = can('pedidos'), edit = can('pedidos', 'editar')
  const resource = useResource<Order[]>(allowed ? 'pedidos' : null), task = useTask()
  const [search, setSearch] = useState(''), [state, setState] = useState(''), [archive, setArchive] = useState('activos'), [selected, setSelected] = useState<number | null>(null), [editing, setEditing] = useState<Order | 'new' | null>(null)
  const action = useOrderAction(), busy = task.busy || action.busy
  const rows = (resource.data || []).filter(order => (archive === 'todos' || (archive === 'archivo' ? order.estado === 'Entregado' : order.estado !== 'Entregado')) && (!state || order.estado === state) && `${order.id} ${order.cliente} ${order.orden_compra}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  async function remove(order: Order) {
    if (!edit || busy || action.isBusy()) return
    await action.run(async () => {
      if (!await confirmAction(`¿Eliminar definitivamente el pedido #${order.id} de ${order.cliente}, con sus ítems, entregas y faltantes?${order.estado === 'Entregado' ? ' Se revertirá el descuento de stock registrado.' : ''}`, { title: 'Eliminar pedido', confirmLabel: 'Eliminar pedido', danger: true })) return
      const result = await task.run(() => api(`pedidos/${order.id}`, jsonRequest('DELETE')), 'Pedido eliminado')
      if (result) await resource.reload()
    })
  }
  async function editOrder(id: number) {
    if (busy || action.isBusy()) return
    const result = await task.run(() => api<Order>(`pedidos/${id}`))
    if (result) setEditing(result)
  }
  if (!allowed) return <Empty>No tienes acceso a Pedidos.</Empty>
  return <div className="view-stack orders-scope"><Heading title="Pedidos" actions={<><Button onClick={() => void resource.reload()}>Actualizar</Button>{edit && <Button variant="primary" disabled={busy} onClick={() => setEditing('new')}>Nuevo pedido</Button>}</>} /><DataState resource={resource} /><Feedback task={task} />
    <Panel className="table-card"><div className="orders-toolbar"><label>Buscar<input type="search" value={search} placeholder="Cliente, OC o pedido" onChange={event => setSearch(event.target.value)} /></label><label>Vista<select value={archive} onChange={event => setArchive(event.target.value)}><option value="activos">Activos</option><option value="todos">Todos</option><option value="archivo">Entregados</option></select></label><label>Estado<select value={state} onChange={event => setState(event.target.value)}><option value="">Todos los estados</option>{orderStates.map(value => <option key={value}>{value}</option>)}</select></label><span className="subtle">{rows.length} resultados</span></div>
      <ScrollTable><table className="orders-table"><thead><tr><th>Pedido / OC</th><th>Cliente</th><th>Entrega prometida</th><th>Estado</th><th>Unidades</th><th>Acciones</th></tr></thead><tbody>{rows.map(order => <tr key={order.id} data-order-state={order.estado}><td><strong>#{order.id}</strong><p>{order.orden_compra}</p></td><td>{order.cliente}</td><td><Status value={fmtDate(order.fecha_entrega)} tone={order.estado === 'Entregado' ? 'green' : dueTone(order.fecha_entrega)} />{order.fecha_entregado && <p className="subtle">Entregado: {fmtDate(order.fecha_entregado)}</p>}</td><td><Status value={order.estado} /></td><td>{fmt(order.total_unidades)}<p className="subtle">{order.total_items} ítems</p></td><td><div className="orders-actions"><Button disabled={busy} onClick={() => setSelected(order.id)}>Detalle</Button><Button disabled={busy} onClick={() => void task.run(() => download(`pedidos/${order.id}/pdf`, `pedido-${order.id}.pdf`))}>PDF</Button>{edit && <>{(order.estado !== 'Entregado' || user?.rol === 'jefe') && <Button disabled={busy} onClick={() => void editOrder(order.id)}>Editar</Button>}<Button variant="danger" disabled={busy} onClick={() => void remove(order)}>Eliminar</Button></>}</div></td></tr>)}</tbody></table></ScrollTable>
      {resource.data && !rows.length && <Empty>Sin pedidos para estos filtros.</Empty>}
    </Panel>
    {selected !== null && <OrderDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void resource.reload()} />}
    {editing && <OrderEditor order={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void resource.reload() }} />}
  </div>
}
