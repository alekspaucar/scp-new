'use client'

import { useId, useState, type FormEvent } from 'react'
import { Button, DataState, Empty, Feedback, Modal, Panel, Status, useTask } from '@/components/shared'
import { useSession } from '@/components/session-provider'
import { api, download, jsonRequest, upload, useResource } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import { countdown, dueTone, fmt, fmtDate } from '@/lib/domain'
import type { Order, OrderItem, OrderState, Shortage } from '@/lib/types'
import { useOrderClock } from './order-board'
import { OrderEditor } from './order-editor'
import { ShortageActions, ShortageDescription, ShortageForm } from './shortages'
import { useOrderAction } from './order-action'

const transitions: Record<OrderState, OrderState[]> = { 'En Cola': ['Procesando'], Procesando: ['Terminado'], Terminado: ['Facturado'], Facturado: ['Retiro en Fábrica', 'Entregado'], 'Retiro en Fábrica': ['Entregado'], Entregado: [] }

function OrderProgress({ value }: { value: number }) {
  const progress = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  return <span className="orders-progress-ring" data-complete={progress === 100} role="progressbar" aria-label="Progreso del pedido" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
    <svg viewBox="0 0 32 32" aria-hidden="true"><circle className="ring-track" cx="16" cy="16" r="12" /><circle className="ring-value" cx="16" cy="16" r="12" pathLength="100" strokeDasharray={`${progress} 100`} /></svg><span>{fmt(progress, 0)}%</span>
  </span>
}

function InvoiceForm({ order, allowed, onClose, onChanged }: { order: Order; allowed: boolean; onClose: () => void; onChanged: () => void }) {
  const [file, setFile] = useState<File | null>(null), [savedUrl, setSavedUrl] = useState(order.url_factura || ''), [authorize, setAuthorize] = useState(false), [warning, setWarning] = useState('')
  const task = useTask(), action = useOrderAction(), busy = task.busy || action.busy
  const needsTransition = order.estado === 'Terminado'
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!allowed || busy || action.isBusy()) return
    if (!file && !savedUrl && (!needsTransition || !authorize)) { setWarning('Selecciona una factura o confirma la autorización sin documento.'); return }
    await action.run(async () => {
      if (needsTransition && !await confirmAction(`¿Autorizar el pedido #${order.id} como Facturado${!file && !savedUrl ? ' sin adjuntar factura' : ''}?`, { confirmLabel: 'Autorizar Facturado' })) return
      setWarning('')
      const result = await task.run(async () => {
        if (file) {
          const response = await upload<{ pedido: Order }>(`pedidos/${order.id}/factura`, file)
          setSavedUrl(response.pedido.url_factura || ''); setFile(null)
          // Persisted upload survives a failed transition and is shown immediately.
          onChanged()
        }
        if (needsTransition) await api(`pedidos/${order.id}/estado`, jsonRequest('PUT', { estado: 'Facturado' }))
        return true
      })
      if (result) { onChanged(); onClose() }
    })
  }
  return <Modal title={needsTransition ? 'Facturar pedido' : 'Adjuntar factura'} onClose={() => { if (!busy && !action.isBusy()) onClose() }}><form onSubmit={event => void save(event)} className="orders-form"><Feedback task={task} />{warning && <p role="alert" className="feedback error">{warning}</p>}
    <p>Pedido #{order.id} · {order.cliente}</p>{savedUrl && <p className="orders-note">Factura guardada. Si falla la autorización, reintenta sin volver a subirla.</p>}
    <label>Factura PDF o imagen<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={busy || !allowed} onChange={event => { setFile(event.target.files?.[0] || null); setWarning('') }} /></label>{file && <p>{file.name}</p>}
    {needsTransition && !savedUrl && !file && <label className="orders-tick"><input type="checkbox" checked={authorize} disabled={busy || !allowed} onChange={event => setAuthorize(event.target.checked)} />Autorizo Facturado sin PDF ni imagen.</label>}
    <div className="orders-actions"><Button disabled={busy} onClick={onClose}>Cerrar</Button><Button type="submit" variant="primary" disabled={!allowed || busy}>{task.busy ? 'Guardando…' : task.error ? 'Reintentar' : needsTransition ? 'Confirmar Facturado' : 'Guardar factura'}</Button></div>
  </form></Modal>
}

function ItemDetail({ item, order, editable, onChanged }: { item: OrderItem; order: Order; editable: boolean; onChanged: () => void }) {
  const task = useTask(), action = useOrderAction(), busy = task.busy || action.busy, panelId = useId()
  const [panel, setPanel] = useState<'state' | 'delivery' | null>(null), [note, setNote] = useState(''), [state, setState] = useState(''), [quantity, setQuantity] = useState(1), [deliveryNote, setDeliveryNote] = useState(''), [validation, setValidation] = useState(''), [report, setReport] = useState<Shortage | 'new' | null>(null)
  const active = editable && order.estado === 'Procesando', remaining = Math.max(0, item.cantidad - (item.cantidad_entregada_total || 0))
  const pendingShortages = (item.faltantes || []).filter(shortage => !shortage.resuelto).length
  const path = `pedidos/${order.id}/items/${item.id}`
  function toggle(next: 'state' | 'delivery') { if (active && !busy && !action.isBusy()) { setPanel(current => current === next ? null : next); setValidation('') } }
  async function saveState(event: FormEvent) {
    event.preventDefault()
    if (!active || !state || busy || action.isBusy()) return
    if (state === 'suspendido' && !note.trim()) { setValidation('La suspensión necesita una observación.'); return }
    setValidation('')
    await action.run(async () => {
      if (!await confirmAction(`¿Cambiar el ítem ${item.codigo} a ${state}?`, { confirmLabel: 'Cambiar estado' })) return
      const result = await task.run(() => api(`${path}/estado`, jsonRequest('PUT', { estado: state, ...(state === 'suspendido' ? { observacion: note.trim() } : {}) })), 'Estado del ítem actualizado')
      if (result) { setState(''); setNote(''); setPanel(null); onChanged() }
    })
  }
  async function partial() {
    if (!active || busy || action.isBusy()) return
    await action.run(async () => {
      if (!await confirmAction(item.modo_entregas_parciales ? '¿Desactivar el modo parcial? Se conservará el historial y el avance volverá a depender del estado del ítem.' : '¿Activar el modo parcial? El avance dependerá de las cantidades entregadas.', { confirmLabel: item.modo_entregas_parciales ? 'Desactivar parciales' : 'Activar parciales' })) return
      const result = await task.run(() => api(`${path}/modo-parcial`, jsonRequest('PATCH', { activo: !item.modo_entregas_parciales })), 'Modo parcial actualizado')
      if (result) onChanged()
    })
  }
  async function deliver(event: FormEvent) {
    event.preventDefault()
    if (!active || !item.modo_entregas_parciales || item.estado_item === 'suspendido' || busy || action.isBusy()) return
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > remaining) { setValidation(`La cantidad debe ser entera entre 1 y ${remaining}.`); return }
    await action.run(async () => {
      if (!await confirmAction(`¿Registrar salida de ${fmt(quantity)} unidades del ítem ${item.codigo}?`, { confirmLabel: 'Registrar entrega' })) return
      setValidation('')
      const result = await task.run(() => api(`${path}/entregas`, jsonRequest('POST', { cantidad_entregada: quantity, observacion: deliveryNote.trim() })), 'Entrega parcial registrada')
      if (result) { setQuantity(1); setDeliveryNote(''); setPanel(null); onChanged() }
    })
  }
  async function deleteDelivery(id: number) {
    if (!active || busy || action.isBusy()) return
    await action.run(async () => {
      if (!await confirmAction('¿Eliminar esta entrega parcial? El ítem puede regresar a pendiente y el pedido a Procesando.', { confirmLabel: 'Eliminar entrega', danger: true })) return
      const result = await task.run(() => api(`${path}/entregas/${id}`, jsonRequest('DELETE')), 'Entrega parcial eliminada')
      if (result) onChanged()
    })
  }
  return <Panel className={`orders-item orders-item-${item.estado_item}`}>
    <div className="orders-item-head"><div className="orders-item-title"><h4><span className="orders-item-code">{item.codigo}</span> {item.descripcion}</h4><p className="subtle">{fmt(item.cantidad)} unidades{item.modo_entregas_parciales || item.cantidad_entregada_total > 0 ? ` · ${fmt(item.cantidad_entregada_total)} entregadas · ${fmt(remaining)} pendientes` : ''}{item.modo_entregas_parciales ? ' · Parciales activos' : ''}</p></div><Status value={item.estado_item === 'entregado_parcial' ? 'Entrega parcial' : item.estado_item} /></div>
    {pendingShortages > 0 && <p className="orders-shortage-alert">{pendingShortages} {pendingShortages === 1 ? 'faltante pendiente' : 'faltantes pendientes'}</p>}
    {item.observacion && <p className="orders-item-observation">{item.observacion}</p>}
    <Feedback task={task} />{validation && <p className="feedback error" role="alert">{validation}</p>}
    {active && <div className="orders-actions orders-item-actions">
      <Button disabled={busy} aria-expanded={panel === 'state'} aria-controls={`${panelId}-state`} onClick={() => toggle('state')}>Estado</Button><Button disabled={busy} aria-expanded={panel === 'delivery'} aria-controls={`${panelId}-delivery`} onClick={() => toggle('delivery')}>Entrega</Button>
      <Button disabled={busy} onClick={() => setReport('new')}>Faltante</Button>
    </div>}
    <div id={`${panelId}-state`} hidden={panel !== 'state'}>{active && panel === 'state' && <form onSubmit={event => void saveState(event)} className="orders-form orders-item-form"><fieldset disabled={busy}><legend>Cambiar estado</legend><div className="orders-actions"><label>Nuevo estado<select value={state} onChange={event => setState(event.target.value)}><option value="">Seleccionar…</option><option value="pendiente">Pendiente</option><option value="listo" disabled={item.estado_item === 'entregado_parcial'}>Listo</option><option value="suspendido">Suspendido</option><option value="entregado_parcial">Entrega parcial (estado)</option></select></label>{state === 'suspendido' && <label>Observación obligatoria<textarea required value={note} onChange={event => setNote(event.target.value)} /></label>}<Button type="submit" variant="primary" disabled={!state}>Guardar estado</Button><Button onClick={() => setPanel(null)}>Cancelar</Button></div></fieldset></form>}</div>
    <div id={`${panelId}-delivery`} hidden={panel !== 'delivery'}>{active && panel === 'delivery' && <div className="orders-form orders-item-form">
      <div className="orders-actions"><span className="subtle">{item.modo_entregas_parciales ? 'Modo parcial activo' : 'Modo parcial inactivo'}</span><Button disabled={busy} onClick={() => void partial()}>{item.modo_entregas_parciales ? 'Desactivar parciales' : 'Activar parciales'}</Button></div>
      {item.modo_entregas_parciales && remaining > 0 && item.estado_item !== 'suspendido' && <form onSubmit={event => void deliver(event)}><fieldset disabled={busy}><legend>Entrega parcial · Restan {fmt(remaining)} uds</legend><div className="orders-actions"><label>Cantidad de salida<input type="number" required min={1} max={remaining} step={1} value={quantity || ''} onChange={event => setQuantity(Number(event.target.value))} /></label><label>Observación de entrega<input value={deliveryNote} onChange={event => setDeliveryNote(event.target.value)} /></label><Button type="submit" variant="primary">Registrar entrega parcial</Button></div></fieldset></form>}
      {item.modo_entregas_parciales && (item.estado_item === 'suspendido' || remaining === 0) && <p className="subtle">{item.estado_item === 'suspendido' ? 'Cambia el estado del ítem para registrar una entrega.' : 'Todas las unidades están entregadas.'}</p>}
      <div className="orders-actions"><Button disabled={busy} onClick={() => setPanel(null)}>Cerrar entrega</Button></div>
    </div>}</div>
    {(!!item.entregas?.length || !!item.faltantes?.length) && <details className="orders-history orders-item-references"><summary>Historial · {(item.entregas || []).length} entregas · {(item.faltantes || []).length} faltantes</summary>
      {item.fecha_estado && <p className="subtle">Último cambio de estado: {fmtDate(item.fecha_estado)}</p>}
      <h5>Entregas</h5>{!item.entregas?.length ? <p className="subtle">Sin entregas registradas.</p> : <ul>{item.entregas.map(delivery => <li key={delivery.id}><strong>{fmt(delivery.cantidad_entregada)} uds</strong><span>{fmtDate(delivery.fecha)}</span><span>{delivery.observacion || 'Sin observación'}</span>{active && <Button variant="danger" disabled={busy} onClick={() => void deleteDelivery(delivery.id)}>Eliminar entrega</Button>}</li>)}</ul>}
      <h5>Pre-acabados / faltantes</h5>{!(item.faltantes || []).length ? <p className="subtle">Sin faltantes reportados.</p> : <ul>{item.faltantes.map(shortage => <li key={shortage.id}><ShortageDescription shortage={shortage} />{active && <ShortageActions shortage={shortage} allowed={active} onChanged={onChanged} onEdit={() => setReport(shortage)} />}</li>)}</ul>}
    </details>}
    {active && report && <ShortageForm orderId={order.id} item={item} shortage={report === 'new' ? undefined : report} allowed={active} onClose={() => setReport(null)} onSaved={() => { setReport(null); onChanged() }} />}
  </Panel>
}

export function OrderDetail({ id, onClose, onChanged, production = false, inline = false }: { id: number; onClose: () => void; onChanged?: () => void; production?: boolean; inline?: boolean }) {
  const { can, user } = useSession(), allowed = can('pedidos') || can('produccion') || can('reportes'), editItems = can('pedidos', 'editar') || can('produccion', 'editar'), editHeader = can('pedidos', 'editar')
  const resource = useResource<Order>(allowed ? `pedidos/${id}` : null), task = useTask(), action = useOrderAction(), now = useOrderClock(), busy = task.busy || action.busy
  const [editing, setEditing] = useState(false), [invoice, setInvoice] = useState(false), [back, setBack] = useState(false), [reason, setReason] = useState(''), [validation, setValidation] = useState('')
  const order = resource.data
  function changed() { void resource.reload(); onChanged?.() }
  async function transition(estado: OrderState) {
    if (!order || !editItems || busy || action.isBusy() || (estado === 'Facturado' && !editHeader) || (production && !['En Cola', 'Procesando'].includes(order.estado))) return
    if (estado === 'Facturado') { setInvoice(true); return }
    await action.run(async () => {
      const message = estado === 'Terminado' ? 'Se marcarán listos todos los ítems pendientes. Los parciales pueden quedar incompletos.' : estado === 'Entregado' ? 'Se confirmará la entrega y se descontará el stock correspondiente.' : estado === 'Retiro en Fábrica' ? 'El pedido quedará esperando que el cliente lo retire en planta.' : 'El pedido ingresará a producción.'
      if (!await confirmAction(`¿Cambiar el pedido #${id} de ${order.estado} a ${estado}? ${message}`, { confirmLabel: 'Confirmar cambio' })) return
      const result = await task.run(() => api(`pedidos/${id}/estado`, jsonRequest('PUT', { estado })), `Pedido actualizado: ${estado}`)
      if (result) changed()
    })
  }
  async function goBack(event: FormEvent) {
    event.preventDefault()
    if (!order || !editItems || busy || action.isBusy() || (production && order.estado !== 'Procesando')) return
    if (reason.trim().length < 10) { setValidation('El motivo debe tener al menos 10 caracteres.'); return }
    await action.run(async () => {
      if (!await confirmAction(`¿Retroceder el pedido #${id} al estado anterior?`, { confirmLabel: 'Retroceder pedido' })) return
      const result = await task.run(() => api(`pedidos/${id}/retroceder`, jsonRequest('PUT', { observacion: reason.trim() })), 'Pedido retrocedido')
      if (result) { setBack(false); setReason(''); setValidation(''); changed() }
    })
  }
  async function pdf(open: boolean) { if (!busy && !action.isBusy()) await task.run(() => download(`pedidos/${id}/pdf`, `pedido-${id}.pdf`, undefined, open)) }
  const summary = order && <dl className="orders-summary"><div><dt>Entrega prometida</dt><dd>{fmtDate(order.fecha_entrega)}</dd></div><div><dt>Cuenta regresiva</dt><dd><Status value={order.estado === 'Entregado' ? 'Entregado' : countdown(order.fecha_entrega, now)} tone={order.estado === 'Entregado' ? 'green' : dueTone(order.fecha_entrega, now)} /></dd></div><div><dt>Cantidad</dt><dd>{fmt(order.total_unidades)} uds · {order.total_items} ítems</dd></div><div><dt>Progreso</dt><dd><OrderProgress value={order.progreso} /></dd></div>{order.fecha_entregado && <div><dt>Entregado</dt><dd>{fmtDate(order.fecha_entregado)}</dd></div>}{order.maquina_asignada && <div><dt>Máquina</dt><dd>{order.maquina_asignada}</dd></div>}</dl>
  const content = <div className={`orders-form orders-scope orders-detail${inline ? ' orders-detail-inline' : ''}`} aria-busy={busy}>
    {!allowed ? <Empty>No tienes acceso a este pedido.</Empty> : <><DataState resource={resource} /><Feedback task={task} />{order && <>
      {!inline && <><div className="orders-item-head"><div><h3>{order.cliente}</h3><p className="subtle">OC {order.orden_compra} · Emitido: {fmtDate(order.fecha_emision)}</p></div><Status value={order.estado} /></div>{summary}</>}
      <div className="orders-items">{order.items.length ? order.items.map(item => <ItemDetail key={item.id} item={item} order={order} editable={editItems} onChanged={changed} />) : <Empty>Este pedido no tiene ítems.</Empty>}</div>
      <div className="orders-actions orders-order-actions">
        {editItems && (!production || ['En Cola', 'Procesando'].includes(order.estado)) && transitions[order.estado].filter(next => next !== 'Facturado' || editHeader).map(next => <Button key={next} variant="primary" disabled={busy} onClick={() => void transition(next)}>{next === 'Procesando' ? 'Iniciar producción' : next === 'Terminado' ? 'Terminar pedido' : next === 'Facturado' ? 'Facturar / autorizar' : next === 'Entregado' ? 'Confirmar entrega' : 'Retiro en Fábrica'}</Button>)}
        {editItems && (production ? order.estado === 'Procesando' : ['Procesando', 'Terminado', 'Facturado'].includes(order.estado)) && <Button disabled={busy} onClick={() => setBack(true)}>Retroceder</Button>}
      </div>
      <details className="orders-order-references"><summary>{inline ? 'Datos del pedido y documentos' : 'Documentos y opciones'}</summary><div className="orders-form">
        {inline && <><p className="subtle">OC {order.orden_compra} · Emitido: {fmtDate(order.fecha_emision)}</p>{summary}</>}
        <div className="orders-actions"><Button disabled={busy} onClick={() => void resource.reload()}>Actualizar</Button><Button disabled={busy} onClick={() => void pdf(false)}>Descargar PDF</Button><Button disabled={busy} onClick={() => void pdf(true)}>Abrir PDF</Button>{editHeader && (order.estado !== 'Entregado' || user?.rol === 'jefe') && <Button disabled={busy} onClick={() => setEditing(true)}>Editar pedido</Button>}</div>
        <div className="orders-actions">{order.url_factura ? <Button disabled={busy} onClick={() => void task.run(() => download(order.url_factura!, `factura-${id}`, undefined, true))}>Abrir factura</Button> : <p className="subtle">Sin factura adjunta.</p>}{editHeader && <Button disabled={busy} onClick={() => setInvoice(true)}>{order.url_factura ? 'Reemplazar factura' : 'Adjuntar factura'}</Button>}</div>
      </div></details>
      {editing && <OrderEditor order={order} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); changed() }} />}
      {invoice && <InvoiceForm order={order} allowed={editHeader} onClose={() => setInvoice(false)} onChanged={changed} />}
      {back && <Modal title="Motivo del retroceso" onClose={() => { if (!busy && !action.isBusy()) setBack(false) }}><form className="orders-form" onSubmit={event => void goBack(event)}><p>Retroceder conserva el estado individual de los ítems.</p><Feedback task={task} />{validation && <p className="feedback error" role="alert">{validation}</p>}<label>Motivo (mínimo 10 caracteres)<textarea required minLength={10} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label><Button type="submit" variant="primary" disabled={busy || !editItems}>Confirmar retroceso</Button></form></Modal>}
    </>}</>}
  </div>
  return inline ? <section aria-label={`Ítems del pedido #${id}`}>{content}</section> : <Modal wide title={`Pedido #${id}${production ? ' · Producción' : ''}`} onClose={() => { if (!busy && !action.isBusy()) onClose() }}>{content}</Modal>
}
