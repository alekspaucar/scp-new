'use client'

import { useState, type FormEvent } from 'react'
import { Button, Feedback, Modal, Status, useTask } from '@/components/shared'
import { api, jsonRequest } from '@/lib/api'
import { confirmAction } from '@/lib/confirm'
import { fmt, fmtDate } from '@/lib/domain'
import type { OrderItem, Shortage } from '@/lib/types'
import { useCurrentOrderGuard, useOrderAction } from './order-action'
import './orders.css'

export function ShortageForm({ orderId, item, shortage, onClose, onSaved, allowed }: { orderId: number; item: OrderItem; shortage?: Shortage; onClose: () => void; onSaved: () => void; allowed: boolean }) {
  const [quantity, setQuantity] = useState(shortage?.cantidad_faltante || 1), [unit, setUnit] = useState(shortage?.unidad || 'planchas'), [cause, setCause] = useState(shortage?.motivo || ''), [department, setDepartment] = useState(shortage?.departamento_origen || 'Corte')
  const [replacement, setReplacement] = useState<number | null>(null), [validation, setValidation] = useState('')
  const task = useTask(), action = useOrderAction(), busy = task.busy || action.busy
  const guard = useCurrentOrderGuard(allowed && !shortage?.resuelto, `${orderId}:${item.id}:${shortage?.id || 'new'}`)
  async function close() {
    if (busy || action.isBusy()) return
    await action.run(async () => {
      if (replacement && !await confirmAction('La corrección nueva ya está guardada y el reporte anterior sigue pendiente. ¿Cerrar sin completar su eliminación?', { confirmLabel: 'Cerrar de todos modos' })) return
      onClose()
    })
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!allowed || shortage?.resuelto || busy || action.isBusy()) return
    if (!replacement && (!Number.isInteger(quantity) || quantity < 1 || !['etiquetas', 'planchas'].includes(unit) || !department.trim())) { setValidation('Completa cantidad entera positiva, unidad y departamento.'); return }
    setValidation('')
    await action.run(async () => {
      if (!guard()) return
      const result = await task.run(async () => {
        // The backend has create/delete, but no update endpoint. Persist the
        // replacement first and keep its ID so a failed cleanup can be retried.
        if (!replacement) {
          const response = await api<{ faltante: Shortage }>(`pedidos/${orderId}/items/${item.id}/faltantes`, jsonRequest('POST', { cantidad_faltante: quantity, unidad: unit, motivo: cause.trim(), departamento_origen: department.trim() }))
          if (shortage) setReplacement(response.faltante.id)
        }
        if (shortage) { if (!guard()) throw new Error('El reporte nuevo está guardado. Tus permisos cambiaron; actualiza antes de eliminar el anterior.'); await api(`pedidos/faltantes/${shortage.id}`, jsonRequest('DELETE')) }
        return true
      })
      if (result) onSaved()
    })
  }
  return <Modal title={shortage ? 'Corregir faltante' : 'Reportar faltante'} onClose={() => void close()}>
    <form className="orders-form" onSubmit={event => void save(event)}><p>{item.codigo} · {item.descripcion}</p><Feedback task={task} />{validation && <p role="alert" className="feedback error">{validation}</p>}
      {shortage && <p className="orders-note">Corregir crea un reporte y elimina el anterior. Si falla, reintenta aquí para evitar duplicados.</p>}
      {replacement && <p role="status" className="orders-note">Reporte corregido #{replacement} guardado. Falta eliminar el anterior #{shortage?.id}. Reintenta para terminar.</p>}
      <fieldset disabled={!allowed || busy || replacement !== null}><div className="form-grid"><label>Cantidad faltante<input type="number" required min={1} step={1} value={quantity || ''} onChange={event => setQuantity(Number(event.target.value))} /></label><label>Unidad<select value={unit} onChange={event => setUnit(event.target.value)}><option value="planchas">Planchas</option><option value="etiquetas">Etiquetas</option></select></label><label>Departamento de origen<input required value={department} onChange={event => setDepartment(event.target.value)} /></label><div className="wide"><div className="orders-actions" aria-label="Causas frecuentes">{[['Dañadas en corte', 'Dañadas en mesa de corte'], ['Descalibre', 'Falla de registro/descalibre'], ['Troquel', 'Troquel mordido / defectuoso'], ['Faltaron al recibir', 'Faltaron planchas al recibir']].map(([label, value]) => <Button key={label} onClick={() => setCause(value)}>{label}</Button>)}</div><label>Motivo o causa (opcional)<textarea value={cause} onChange={event => setCause(event.target.value)} /></label></div></div></fieldset>
      <Button type="submit" variant="primary" disabled={!allowed || busy || shortage?.resuelto}>{task.busy ? 'Guardando…' : replacement ? 'Eliminar reporte anterior' : shortage ? 'Guardar corrección' : 'Reportar faltante'}</Button>
    </form>
  </Modal>
}

export function ShortageActions({ shortage, allowed, onChanged, onEdit }: { shortage: Shortage; allowed: boolean; onChanged: () => void; onEdit?: () => void }) {
  const task = useTask(), action = useOrderAction(), busy = task.busy || action.busy
  const guard = useCurrentOrderGuard(allowed, `${shortage.id}`)
  async function resolve() {
    if (!allowed || busy || action.isBusy()) return
    await action.run(async () => {
      if (!await confirmAction(`¿Confirmar que Impresión repuso ${fmt(shortage.cantidad_faltante)} ${shortage.unidad} del reporte #${shortage.id}?`, { confirmLabel: 'Confirmar reposición' })) return
      if (!guard()) return
      const result = await task.run(() => api(`pedidos/faltantes/${shortage.id}/resolver`, jsonRequest('PUT', {})), 'Reposición confirmada')
      if (result) onChanged()
    })
  }
  async function remove() {
    if (!allowed || busy || action.isBusy()) return
    await action.run(async () => {
      if (!await confirmAction(`¿Eliminar el reporte de faltante #${shortage.id}?`, { confirmLabel: 'Eliminar reporte', danger: true })) return
      if (!guard()) return
      const result = await task.run(() => api(`pedidos/faltantes/${shortage.id}`, jsonRequest('DELETE')), 'Reporte eliminado')
      if (result) onChanged()
    })
  }
  return <div><div className="orders-actions"><Status value={shortage.resuelto ? 'Resuelto' : 'Pendiente'} />{allowed && <>{!shortage.resuelto && <><Button disabled={busy} onClick={() => void resolve()}>Confirmar reposición</Button>{onEdit && <Button disabled={busy} onClick={onEdit}>Corregir</Button>}</>}<Button variant="danger" disabled={busy} onClick={() => void remove()}>Eliminar</Button></>}</div><Feedback task={task} /></div>
}

export function ShortageDescription({ shortage }: { shortage: Shortage }) {
  return <div><strong>{fmt(shortage.cantidad_faltante)} {shortage.unidad}</strong><p>{shortage.motivo || 'Sin motivo registrado'}</p><p className="subtle">{shortage.departamento_origen} · {fmtDate(shortage.fecha)}{shortage.fecha_resolucion ? ` · Resuelto: ${fmtDate(shortage.fecha_resolucion)}` : ''}</p></div>
}
