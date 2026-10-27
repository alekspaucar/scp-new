'use client'

import { useState, type DragEvent, type FormEvent } from 'react'
import { api, jsonRequest, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import { dateInput, fmt, fmtDate, parseEcuadorDate } from '@/lib/domain'
import type { Order, Planner } from '@/lib/types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Modal, Panel, Status, useTask } from '@/components/shared'
import { useOrderAction } from '@/components/orders/order-action'
import './planning.css'

const machines = ['M1', 'M2', 'Mesp'] as const
const time = (value?: string | null) => parseEcuadorDate(value)?.getTime() ?? null
const duration = (order: Order) => {
  if (order.error_planificacion) return null
  const start = time(order.fecha_inicio_produccion), end = time(order.fecha_fin_produccion)
  return start !== null && end !== null && end > start ? (end - start) / 60000 : order.minutos_estimados || order.minutos_calculados || 10
}
const clock = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false })
const shortDate = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'short' })
const sorted = (orders: Order[]) => [...orders].sort((a, b) => (time(a.fecha_inicio_produccion) ?? Infinity) - (time(b.fecha_inicio_produccion) ?? Infinity) || a.id - b.id)
function reservationWindow(order: Order) {
  const start = time(order.fecha_inicio_produccion), end = time(order.fecha_fin_produccion)
  if (start === null || end === null || end <= start) return 'Sin fechas válidas'
  const sameYear = dateInput(order.fecha_inicio_produccion).slice(0, 4) === dateInput(order.fecha_fin_produccion).slice(0, 4)
  const startDay = sameYear ? shortDate.format(start) : fmtDate(order.fecha_inicio_produccion, false)
  const endDay = sameYear ? shortDate.format(end) : fmtDate(order.fecha_fin_produccion, false)
  return `${startDay}, ${clock.format(start)} – ${startDay === endDay ? '' : `${endDay}, `}${clock.format(end)}`
}
function timelineTracks(orders: Order[]) {
  const tracks: Order[][] = [], ends: number[] = [], invalid: Order[] = []
  for (const order of sorted(orders)) {
    const start = time(order.fecha_inicio_produccion), end = time(order.fecha_fin_produccion)
    if (start === null || end === null || end <= start) { invalid.push(order); continue }
    const available = ends.findIndex(value => value <= start)
    const index = available < 0 ? tracks.length : available
    if (!tracks[index]) tracks[index] = []
    tracks[index].push(order)
    ends[index] = end
  }
  return { tracks, invalid }
}
interface Assignment { pedido_id: number; maquina: string | null; fecha_inicio?: string; duracion_minutos?: number }
interface AutoAssignment { mensaje: string; total_asignados: number; makespan_horas: number }

export function Gantt() {
  const { can } = useSession()
  const allowed = can('produccion'), editable = can('produccion', 'editar')
  const resource = useResource<Planner>(allowed ? 'produccion/planificador' : null)
  const task = useTask(), action = useOrderAction(), busy = task.busy || action.busy
  const [editor, setEditor] = useState<Order | null>(null)
  const [dragged, setDragged] = useState<Order | null>(null)
  const [scale, setScale] = useState(48)
  const [day, setDay] = useState('')
  const [autoResult, setAutoResult] = useState<AutoAssignment | null>(null)
  const data = resource.data
  const assigned = data ? machines.flatMap(machine => data.lineas_tiempo[machine] || []) : []
  const all = [...assigned, ...(data?.sin_asignar || [])]
  const now = time(data?.ahora) ?? Date.now()
  const planDay = day || dateInput(data?.ahora || new Date(now).toISOString()).slice(0, 10)
  const origin = time(`${planDay}T00:00:00`) ?? now
  const end = origin + 24 * 3600000
  const width = Math.max(720, 24 * scale), pixelsPerHour = width / 24
  const position = (value: number) => (value - origin) / 3600000 * pixelsPerHour
  const tickHours = scale >= 48 ? 4 : scale >= 12 ? 12 : 24
  const ticks = Array.from({ length: Math.ceil(24 / tickHours) }, (_, i) => origin + i * tickHours * 3600000)

  async function assign(body: Assignment) {
    if (!can('produccion', 'editar') || busy || action.isBusy()) return false
    const result = await action.run(() => task.run(async () => {
      try { return await api<{ mensaje: string }>('produccion/asignar-manual', jsonRequest('PUT', body)) }
      finally { await resource.reload() }
    }, body.maquina ? 'Reserva guardada.' : 'Pedido devuelto a la cola sin asignar.'))
    if (result) setAutoResult(null)
    return !!result
  }
  function drag(event: DragEvent, order: Order) {
    event.dataTransfer.setData('application/x-sgp-order', String(order.id))
    event.dataTransfer.effectAllowed = 'move'
    setDragged(order)
  }
  function acceptsDrop(machine: string | null) {
    return editable && !busy && !!dragged && (!machine || !dragged.error_planificacion) && (dragged.maquina_asignada || null) !== machine && (!machine || !dragged.maquina_requerida_fija || dragged.maquina_requerida_fija === machine)
  }
  function drop(event: DragEvent, machine: string | null) {
    event.preventDefault()
    setDragged(null)
    if (!editable || busy || action.isBusy()) return
    const id = Number(event.dataTransfer.getData('application/x-sgp-order'))
    const order = all.find(value => value.id === id)
    if (!order || (order.maquina_asignada || null) === machine || (machine && (order.error_planificacion || (order.maquina_requerida_fija && order.maquina_requerida_fija !== machine)))) return
    void assign({ pedido_id: id, maquina: machine, ...(machine ? { duracion_minutos: duration(order) ?? undefined } : {}) })
  }
  async function autoAssign() {
    if (!can('produccion', 'editar') || busy || action.isBusy()) return
    await action.run(async () => {
      if (!await confirmAction('Se organizarán los pedidos En Cola y se recalcularán sus reservas. Los pedidos en proceso conservan su espacio.', { title: 'Organizar cola', confirmLabel: 'Organizar' })) return
      const result = await task.run(async () => {
        try { return await api<AutoAssignment>('produccion/auto-asignar', jsonRequest('POST', {})) }
        finally { await resource.reload() }
      })
      if (result) setAutoResult(result)
    })
  }
  function orderRow(order: Order, pending = false) {
    const window = reservationWindow(order)
    return <li key={order.id} className="planning-reservation" draggable={editable && !busy && !order.error_planificacion} onDragStart={event => drag(event, order)} onDragEnd={() => setDragged(null)}>
      <div className="planning-reservation-body">
        <div className="planning-reservation-heading"><strong>#ORD-{order.id}</strong><span className="planning-client">{order.cliente}</span></div>
        <div className="planning-reservation-meta">
          {!pending && <span className={window === 'Sin fechas válidas' ? 'planning-inline-error' : ''} title={`Inicio: ${fmtDate(order.fecha_inicio_produccion)}. Fin: ${fmtDate(order.fecha_fin_produccion)}.`}>{window}</span>}
          <div className="planning-reservation-footer"><span>{duration(order) === null ? 'Revisar datos de producción' : `${fmt(duration(order))} min`}{order.maquina_requerida_fija ? ` · Requiere ${order.maquina_requerida_fija}` : ''}</span><Status value={order.estado} /></div>
          {order.error_planificacion && <p className="planning-inline-error">{order.error_planificacion}</p>}
        </div>
      </div>
      {editable && <Button className="planning-row-action" variant={pending ? 'primary' : 'soft'} disabled={busy || (pending && !!order.error_planificacion)} aria-label={`${pending ? 'Asignar pedido' : 'Editar reserva del pedido'} ${order.id} de ${order.cliente}`} onClick={() => { task.clear(); setEditor(order) }}>{pending ? 'Asignar' : 'Editar'}</Button>}
    </li>
  }
  if (!allowed) return <Empty>No tienes permiso para consultar Producción.</Empty>
  return <div className="view-stack planning-view planning-agenda-view">
    <Heading title="Planificador" subtitle={data ? `${assigned.length} programados · ${data.sin_asignar.length} pendientes` : undefined} actions={<><Button onClick={() => void resource.reload()} disabled={busy}>Actualizar</Button>{editable && <Button variant="primary" disabled={busy || !data || !!resource.error || !all.some(order => order.estado === 'En Cola')} onClick={() => void autoAssign()}>Organizar cola</Button>}</>} />
    <DataState resource={resource} /><Feedback task={task} />
    {task.error && <p className="planning-note">Se solicitó una actualización del plan. Revisa la ocupación y vuelve a guardar; el formulario conserva tus cambios.</p>}
    {autoResult && <Panel className="planning-panel"><p role="status">{autoResult.mensaje} · Horizonte: {fmt(autoResult.makespan_horas)} h desde la asignación.</p></Panel>}
    {data && <>
      <div className="planning-agenda" aria-label="Agenda por máquina">
        {machines.map(machine => {
          const orders = sorted(data.lineas_tiempo[machine] || [])
          return <section key={machine} className="planning-machine-agenda" data-drop-ready={acceptsDrop(machine) || undefined} onDragOver={event => { if (acceptsDrop(machine)) event.preventDefault() }} onDrop={event => drop(event, machine)} aria-label={`Agenda de ${machine}`}>
            <header className="planning-agenda-heading"><h3>{data.maquinas.find(value => value.id === machine)?.nombre || machine}</h3><span className="planning-count">{orders.length} {orders.length === 1 ? 'reserva' : 'reservas'}</span></header>
            {orders.length ? <ul className="planning-reservations">{orders.map(order => orderRow(order))}</ul> : <p className="planning-agenda-empty">Sin reservas{editable ? '. Asigna un pedido o arrástralo aquí.' : '.'}</p>}
          </section>
        })}
      </div>
      <div className="planning-fold-panel" data-drop-ready={acceptsDrop(null) || undefined} onDragOver={event => { if (acceptsDrop(null)) event.preventDefault() }} onDrop={event => drop(event, null)}>
        <details className="planning-fold planning-pending" open>
          <summary><span>Pendientes sin asignar</span><span className="planning-count">{data.sin_asignar.length} {data.sin_asignar.length === 1 ? 'pedido' : 'pedidos'}</span></summary>
          {data.sin_asignar.length ? <ul className="planning-reservations">{data.sin_asignar.map(order => orderRow(order, true))}</ul> : <p className="planning-agenda-empty">No hay pedidos pendientes de asignación.</p>}
        </details>
      </div>
      <div className="planning-fold-panel">
        <details className="planning-fold planning-timeline">
          <summary><span>Línea de tiempo</span><span className="planning-fold-hint">Ver escala horaria</span></summary>
          <div className="planning-timeline-content">
            <div className="planning-toolbar"><label>Día del plan<input type="date" value={planDay} onChange={event => setDay(event.target.value)} /></label><label>Escala<select value={scale} onChange={event => setScale(Number(event.target.value))}><option value={48}>4 horas</option><option value={12}>12 horas</option><option value={4}>24 horas</option></select></label><Button onClick={() => setDay('')}>Hoy</Button><p className="planning-note">Hora de Ecuador · La línea coral marca el momento actual.</p></div>
            <div className="planning-scroll" tabIndex={0} role="region" aria-label="Línea de tiempo de producción, desplazamiento horizontal">
              <div style={{ width }}>
                <div className="planning-axis">{ticks.map(tick => <span key={tick} style={{ left: position(tick) }}>{fmtDate(new Date(tick).toISOString(), false)}<br />{clock.format(tick)}</span>)}</div>
                {machines.map(machine => {
                  const orders = (data.lineas_tiempo[machine] || []).filter(order => {
                    const start = time(order.fecha_inicio_produccion), finish = time(order.fecha_fin_produccion)
                    return start === null || finish === null || (start < end && finish > origin)
                  })
                  const { tracks, invalid } = timelineTracks(orders)
                  return <section key={machine} className="planning-machine" data-drop-ready={acceptsDrop(machine) || undefined} onDragOver={event => { if (acceptsDrop(machine)) event.preventDefault() }} onDrop={event => drop(event, machine)} aria-label={`Cronograma de ${machine}`}>
                    <h3>{data.maquinas.find(value => value.id === machine)?.nombre || machine} · {orders.length} reservas</h3>
                    {(tracks.length ? tracks : [[]]).map((track, index) => <div key={index} className="planning-track" style={{ backgroundSize: `${tickHours * pixelsPerHour}px 100%` }}>
                      {track.map(order => {
                        const start = time(order.fecha_inicio_produccion)!, finish = time(order.fecha_fin_produccion)!
                        return <button key={order.id} type="button" className="planning-bar" disabled={!editable || busy} onClick={() => { task.clear(); setEditor(order) }} style={{ left: position(Math.max(start, origin)), width: (Math.min(finish, end) - Math.max(start, origin)) / 3600000 * pixelsPerHour }} aria-label={`Editar reserva del pedido ${order.id} en la línea de tiempo`} title={`#ORD-${order.id} · ${order.cliente} · ${reservationWindow(order)} · ${fmt(duration(order))} min`}><span>#ORD-{order.id} · {order.cliente}</span></button>
                      })}
                      {!orders.length && <p className="planning-note">Sin reservas este día</p>}
                      {now >= origin && now < end && <i className="planning-now" style={{ left: position(now) }} />}
                    </div>)}
                    {!!invalid.length && <p className="planning-inline-error">Sin fechas válidas: {invalid.map(order => `#ORD-${order.id}`).join(', ')}. Edita la reserva en la agenda.</p>}
                  </section>
                })}
              </div>
            </div>
          </div>
        </details>
      </div>
      <details className="inline-help planning-agenda-help"><summary>Cómo planificar</summary><p className="planning-note">{editable ? 'Usa Asignar o Editar para elegir máquina, inicio y duración, también con teclado. Arrastra pedidos entre máquinas compatibles para reservar al final de su cola; suéltalos en Pendientes para quitar la reserva. Las restricciones y los conflictos se validan al guardar.' : 'Consulta todas las reservas en la agenda de cada máquina.'} Operación continua 24/7.</p></details>
      {!all.length && <Empty>No hay pedidos En Cola o Procesando para planificar.</Empty>}
    </>}
    {editor && editable && <AssignmentEditor key={editor.id} order={editor} now={data?.ahora} busy={busy} error={task.error} onClose={() => { if (!busy && !action.isBusy()) setEditor(null) }} onSave={async body => { if (await assign(body)) setEditor(null) }} onUnassign={async () => { if (await assign({ pedido_id: editor.id, maquina: null })) setEditor(null) }} />}
  </div>
}

function AssignmentEditor({ order, now, busy, error, onClose, onSave, onUnassign }: { order: Order; now?: string; busy: boolean; error: string; onClose: () => void; onSave: (body: Assignment) => Promise<void>; onUnassign: () => Promise<void> }) {
  const [machine, setMachine] = useState(order.maquina_asignada || order.maquina_requerida_fija || 'M1')
  const [start, setStart] = useState(dateInput(order.fecha_inicio_produccion || now))
  const [minutes, setMinutes] = useState(String(duration(order) ?? ''))
  const [manual, setManual] = useState(!!order.maquina_asignada)
  const valid = !order.error_planificacion && (!manual || (time(start) !== null && Number.isFinite(Number(minutes)) && Number(minutes) > 0)) && machines.some(value => value === machine) && (!order.maquina_requerida_fija || order.maquina_requerida_fija === machine)
  function submit(event: FormEvent) { event.preventDefault(); if (valid && !busy) void onSave({ pedido_id: order.id, maquina: machine, ...(manual ? { fecha_inicio: `${start}-05:00`, duracion_minutos: Number(minutes) } : {}) }) }
  return <Modal title={`${order.maquina_asignada ? 'Editar reserva' : 'Asignar pedido'} #${order.id}`} onClose={onClose}><form className="planning-editor" onSubmit={submit}>
    <p className="subtle">{order.cliente} · OC {order.orden_compra || 'S/N'}{order.maquina_requerida_fija ? ` · Requiere ${order.maquina_requerida_fija}` : ''}</p>
    {order.error_planificacion && <p role="alert" className="feedback error">{order.error_planificacion} Corrige los datos del pedido o catálogo antes de asignar.</p>}
    <label>Máquina<select value={machine} disabled={busy} onChange={event => setMachine(event.target.value)}>{machines.map(value => <option key={value} value={value} disabled={!!order.maquina_requerida_fija && order.maquina_requerida_fija !== value}>{value}</option>)}</select></label>
    <details className="planning-schedule-options" open={manual} onToggle={event => setManual(event.currentTarget.open)}><summary>Elegir fecha y duración</summary><div className="planning-editor"><label>Inicio (Ecuador)<input type="datetime-local" required={manual} value={start} disabled={busy || !manual} onChange={event => setStart(event.target.value)} /></label><label>Duración (minutos)<input type="number" min="0.01" step="any" required={manual} value={minutes} disabled={busy || !manual} onChange={event => setMinutes(event.target.value)} /></label></div></details>
    {!manual && <p className="subtle">Se reservará el siguiente espacio libre con la duración del pedido.</p>}
    {error && <p role="alert" className="feedback error">{error} Revisa el plan actualizado y reintenta.</p>}
    <div className="planning-actions"><Button disabled={busy} onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" disabled={busy || !valid}>{busy ? 'Guardando…' : manual ? 'Guardar reserva' : 'Asignar al siguiente espacio'}</Button></div>
    {order.maquina_asignada && <div className="planning-unassign"><Button disabled={busy} onClick={() => void onUnassign()}>Volver a pendientes</Button></div>}
  </form></Modal>
}
