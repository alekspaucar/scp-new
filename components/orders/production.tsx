'use client'

import { useState } from 'react'
import { Button, DataState, Empty, Feedback, Heading, Panel, useTask } from '@/components/shared'
import { useSession } from '@/components/session-provider'
import { api, jsonRequest, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import type { Order } from '@/lib/types'
import { OrderBoard, OrderCard, useOrderClock } from './order-board'
import { OrderDetail } from './order-detail'
import { useOrderAction } from './order-action'

export function Production() {
  const { can } = useSession(), allowed = can('produccion'), editable = can('pedidos', 'editar') || can('produccion', 'editar')
  const resource = useResource<Order[]>(allowed ? 'pedidos' : null), task = useTask(), now = useOrderClock()
  const [search, setSearch] = useState(''), [selected, setSelected] = useState<number | null>(null)
  const action = useOrderAction(), busy = task.busy || action.busy
  const orders = (resource.data || []).filter(order => order.cliente.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) || String(order.id) === search.trim())
  async function advance(order: Order) {
    if (!editable || busy || action.isBusy()) return
    await action.run(async () => {
      const estado = order.estado === 'En Cola' ? 'Procesando' : 'Terminado'
      if (!await confirmAction(estado === 'Terminado' ? `¿Terminar el pedido #${order.id}? Sus ítems pendientes se marcarán listos. Los parciales no tienen que estar completos.` : `¿Iniciar producción del pedido #${order.id}?`, { confirmLabel: estado === 'Terminado' ? 'Terminar pedido' : 'Iniciar producción' })) return
      const result = await task.run(() => api(`pedidos/${order.id}/estado`, jsonRequest('PUT', { estado })), `Pedido #${order.id}: ${estado}`)
      if (result) await resource.reload()
    })
  }
  function toggle(id: number) { if (!busy && !action.isBusy()) setSelected(current => current === id ? null : id) }
  function collapse() { if (!busy && !action.isBusy()) setSelected(null) }
  async function refresh() { if (!busy && !action.isBusy()) await resource.reload() }
  function expanded(order: Order) { return <OrderDetail key={order.id} id={order.id} inline production onClose={collapse} onChanged={() => void resource.reload()} /> }
  if (!allowed) return <Empty>No tienes acceso a Producción.</Empty>
  return <div className="view-stack orders-scope"><Heading title="Producción" actions={<Button disabled={busy} onClick={() => void refresh()}>Actualizar</Button>} /><DataState resource={{ ...resource, reload: refresh }} /><Feedback task={task} /><Panel><div className="orders-toolbar"><label>Buscar cliente o pedido<input type="search" disabled={busy} value={search} onChange={event => { if (!busy && !action.isBusy()) setSearch(event.target.value) }} /></label></div></Panel>
    {resource.data && <><OrderBoard orders={orders} now={now} onOpen={toggle} onAdvance={editable ? advance : undefined} busy={busy} expandedId={selected} renderExpanded={expanded} /><section><h3>Retiro en Fábrica</h3><div className="card-list">{orders.filter(order => order.estado === 'Retiro en Fábrica').map(order => <OrderCard key={order.id} order={order} now={now} onOpen={toggle} busy={busy} expanded={selected === order.id}>{selected === order.id && expanded(order)}</OrderCard>)}{!orders.some(order => order.estado === 'Retiro en Fábrica') && <Empty>Sin retiros pendientes.</Empty>}</div></section></>}
  </div>
}
