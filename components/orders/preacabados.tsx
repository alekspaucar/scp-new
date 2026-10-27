'use client'

import { useState } from 'react'
import { Button, DataState, Empty, Heading, Metric, Panel, ScrollTable } from '@/components/shared'
import { useSession } from '@/components/session-provider'
import { useResource } from '@/lib/api'
import type { Order, OrderItem, Shortage } from '@/lib/types'
import { OrderDetail } from './order-detail'
import { ShortageActions, ShortageDescription, ShortageForm } from './shortages'
import './orders.css'

export function Preacabados() {
  const { can } = useSession(), allowed = can('produccion') || can('pedidos'), edit = can('pedidos', 'editar') || can('produccion', 'editar')
  const resource = useResource<Order[]>(allowed ? 'pedidos' : null)
  const [filter, setFilter] = useState('pendientes'), [search, setSearch] = useState(''), [selected, setSelected] = useState<number | null>(null), [editing, setEditing] = useState<{ order: Order; item: OrderItem; shortage: Shortage } | null>(null)
  const all = (resource.data || []).flatMap(order => order.items.flatMap(item => (item.faltantes || []).map(shortage => ({ order, item, shortage }))))
  const rows = all.filter(({ order, item, shortage }) => (filter === 'todos' || (filter === 'resueltos' ? shortage.resuelto : !shortage.resuelto)) && `${order.id} ${order.cliente} ${item.codigo} ${item.descripcion} ${shortage.motivo}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => b.shortage.id - a.shortage.id)
  if (!allowed) return <Empty>No tienes acceso a Pre-acabados.</Empty>
  return <div className="view-stack orders-scope"><Heading title="Pre-acabados" actions={<Button onClick={() => void resource.reload()}>Actualizar</Button>} /><DataState resource={resource} />
    <div className="metrics-grid"><Metric label="Reportes pendientes" value={resource.data ? all.filter(row => !row.shortage.resuelto).length : '—'} tone="amber" /><Metric label="Reportes resueltos" value={resource.data ? all.filter(row => row.shortage.resuelto).length : '—'} tone="green" /></div>
    <Panel className="table-card"><div className="orders-toolbar"><label>Estado<select value={filter} onChange={event => setFilter(event.target.value)}><option value="pendientes">Pendientes</option><option value="resueltos">Resueltos</option><option value="todos">Todos</option></select></label><label>Buscar pedido, cliente o ítem<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <ScrollTable><table className="orders-table"><thead><tr><th>Pedido / cliente</th><th>Ítem</th><th>Faltante y causa</th><th>Estado y acciones</th></tr></thead><tbody>{rows.map(({ order, item, shortage }) => <tr key={shortage.id} data-shortage-state={shortage.resuelto ? 'resolved' : 'pending'}><td><Button onClick={() => setSelected(order.id)}>Pedido #{order.id}</Button><p>{order.cliente}</p></td><td><strong>{item.codigo}</strong><p>{item.descripcion}</p></td><td><ShortageDescription shortage={shortage} /></td><td><ShortageActions shortage={shortage} allowed={edit} onChanged={() => void resource.reload()} onEdit={() => setEditing({ order, item, shortage })} /></td></tr>)}</tbody></table></ScrollTable>{resource.data && !rows.length && <Empty>Sin faltantes para estos filtros.</Empty>}
    </Panel>
    <Panel className="orders-panel-pad"><details className="inline-help"><summary>Ayuda</summary><p className="subtle">Faltantes y mermas de Corte, con reposición por Impresión. Repórtalos desde el detalle del pedido. La inspección AQL formal aún no está disponible: faltan la matriz de muestreo y los criterios de aceptación.</p></details></Panel>
    {selected !== null && <OrderDetail id={selected} production onClose={() => setSelected(null)} onChanged={() => void resource.reload()} />}
    {editing && <ShortageForm orderId={editing.order.id} item={editing.item} shortage={editing.shortage} allowed={edit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void resource.reload() }} />}
  </div>
}
