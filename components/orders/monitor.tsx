'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, DataState, Empty, Feedback, Heading, Metric, Panel, useTask } from '@/components/shared'
import { useSession } from '@/components/session-provider'
import { useResource } from '@/lib/api'
import { fmtDate } from '@/lib/domain'
import type { MonitorData } from '@/lib/types'
import { OrderBoard, OrderCard, useOrderClock } from './order-board'
import { OrderDetail } from './order-detail'

export function Monitor() {
  const { can } = useSession(), resource = useResource<MonitorData>(can('pedidos') ? 'pedidos/monitor-tv' : null, 5000)
  const [search, setSearch] = useState(''), [pickup, setPickup] = useState(false), [selected, setSelected] = useState<number | null>(null), [full, setFull] = useState(false)
  const container = useRef<HTMLDivElement>(null), task = useTask(), now = useOrderClock()
  const [clockColor, setClockColor] = useState('#dc2626')
  useEffect(() => { try { const color = window.localStorage.getItem('monitor_color_reloj'); if (color && /^#[\da-f]{6}$/i.test(color)) setClockColor(color) } catch {} }, [])
  function changeClockColor(color: string) { if (!/^#[\da-f]{6}$/i.test(color)) return; setClockColor(color); try { window.localStorage.setItem('monitor_color_reloj', color) } catch {} }
  useEffect(() => { const update = () => setFull(document.fullscreenElement === container.current); document.addEventListener('fullscreenchange', update); return () => document.removeEventListener('fullscreenchange', update) }, [])
  const orders = (resource.data?.pedidos || []).filter(order => order.cliente.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const pickups = orders.filter(order => order.estado === 'Retiro en Fábrica')
  if (!can('pedidos')) return <Empty>No tienes acceso al monitor de pedidos.</Empty>
  return <div className="view-stack orders-scope orders-tv" ref={container}>
    <Heading title="Monitor de pedidos" subtitle={fmtDate(new Date(now).toISOString())} actions={<><Button onClick={() => void resource.reload()}>Actualizar</Button><Button aria-label={full ? 'Salir de pantalla completa' : 'Pantalla completa'} onClick={() => void task.run(async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await container.current?.requestFullscreen(); return true })}>{full ? 'Salir' : 'Pantalla completa'}</Button></>} />
    <DataState resource={resource} /><Feedback task={task} />
    <div className="orders-clock-row"><time className="orders-clock" dateTime={new Date(now).toISOString()} style={{ color: clockColor }} aria-label="Hora de Ecuador">{new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now)}</time><details><summary>Color del reloj</summary><label>Color<input aria-label="Color del reloj" type="color" value={clockColor} onChange={event => changeClockColor(event.target.value)} /></label></details></div>
    <div className="metrics-grid"><Metric label="Pedidos activos" value={resource.data?.activos ?? '—'} /><Metric label="En riesgo" value={resource.data?.en_riesgo ?? '—'} tone="rose" note="Atrasados sin terminar" /><Metric label="Para hoy" value={resource.data?.para_hoy ?? '—'} tone="amber" /><Metric label="Completados hoy" value={resource.data?.completados_hoy ?? '—'} tone="green" /></div>
    <Panel><div className="orders-toolbar"><label>Buscar cliente<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre del cliente" /></label><Button variant={!pickup ? 'primary' : 'soft'} onClick={() => setPickup(false)}>Tablero</Button><Button variant={pickup ? 'primary' : 'soft'} onClick={() => setPickup(true)}>Retiros ({pickups.length})</Button><span className="subtle">Indicadores de toda la planta.</span></div></Panel>
    {resource.data && (pickup ? <div className="kanban-grid">{pickups.map(order => <OrderCard key={order.id} order={order} now={now} onOpen={setSelected} monitor />)}{!pickups.length && <Empty>No hay retiros para este filtro.</Empty>}</div> : <OrderBoard orders={orders} onOpen={setSelected} now={now} monitor />)}
    {selected !== null && <OrderDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void resource.reload()} />}
  </div>
}
