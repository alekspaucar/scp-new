'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Barcode, RefreshCw } from 'lucide-react'
import { api, jsonRequest, useResource } from '@/lib/api'
import { fmt, fmtDate } from '@/lib/domain'
import type { Material, Movement } from '@/lib/types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './bodega.css'

// The movements API omits units. Resolve them from the authoritative material,
// rather than assuming that every movement represents rolls.
export function MovementHistory({ movements, materials, sku }: { movements: Movement[]; materials: Material[]; sku?: string }) {
  const units = new Map(materials.map(material => [material.codigo_barras, material.unidad_medida]))
  const rows = movements.slice(0, 50).filter(movement => !sku || movement.sku === sku)
  if (!rows.length) return <Empty>{sku ? 'No hay movimientos de este SKU entre los últimos 50 registros globales.' : 'Todavía no se han registrado movimientos.'}</Empty>
  return <ScrollTable><table className="bodega-table">
    <caption className="bodega-sr-only">{sku ? `Movimientos recientes de ${sku}` : 'Últimos movimientos de bodega'}</caption>
    <thead><tr><th scope="col">Fecha · Ecuador</th><th scope="col">SKU / material</th><th scope="col">Movimiento</th><th scope="col">Cantidad</th><th scope="col">Usuario</th><th scope="col">Observación</th></tr></thead>
    <tbody>{rows.map(movement => <tr key={movement.id}>
      <td>{fmtDate(movement.fecha)}</td>
      <td><span className="mono">{movement.sku}</span><strong className="bodega-block">{movement.nombre_material}</strong></td>
      <td><Status value={movement.tipo_movimiento} tone={movement.tipo_movimiento === 'Entrada' ? 'green' : 'amber'} /></td>
      <td>{fmt(movement.cantidad, 0)} <span className="subtle">{units.get(movement.sku) || 'Unidad no disponible'}</span></td>
      <td>{movement.usuario || '—'}</td><td className="bodega-observation">{movement.observacion || '—'}</td>
    </tr>)}</tbody>
  </table></ScrollTable>
}

export function Operations() {
  const { can } = useSession()
  const allowed = can('operaciones'), editable = can('operaciones', 'editar')
  const history = useResource<Movement[]>(allowed ? 'movimientos' : null)
  // Operations has its own read permission for this auxiliary endpoint.
  const materials = useResource<Material[]>(allowed ? 'materiales' : null)
  const task = useTask()
  const [type, setType] = useState<'Entrada' | 'Salida'>('Entrada')
  const [quickCode, setQuickCode] = useState(''), [manualCode, setManualCode] = useState('')
  const [quantity, setQuantity] = useState('1'), [observation, setObservation] = useState('')
  const [validation, setValidation] = useState(''), [receipt, setReceipt] = useState('')
  const quickInput = useRef<HTMLInputElement>(null), quantityInput = useRef<HTMLInputElement>(null)
  const locked = useRef(false), restoreFocus = useRef(false)

  useEffect(() => { if (editable) quickInput.current?.focus() }, [editable])
  useEffect(() => {
    if (!task.busy && editable && restoreFocus.current) {
      restoreFocus.current = false
      quickInput.current?.focus()
    }
  }, [task.busy, editable])

  async function register(event: FormEvent<HTMLFormElement>, mode: 'quick' | 'manual') {
    event.preventDefault()
    if (!editable || locked.current) return
    setValidation(''); task.clear()
    const code = (mode === 'quick' ? quickCode : manualCode).trim().toUpperCase()
    const amount = mode === 'quick' ? 1 : Number(quantity)
    if (!code) { setValidation('Ingresa o escanea un SKU.'); return }
    if (!Number.isSafeInteger(amount) || amount < 1 || (mode === 'manual' && !quantity.trim())) {
      setValidation('La cantidad debe ser un número entero mayor o igual a 1.'); quantityInput.current?.focus(); return
    }
    locked.current = true
    try {
      await task.run(async () => {
        try {
          const response = await api<{ mensaje: string; material: Material; movimiento: Movement }>('movimientos', jsonRequest('POST', {
            codigo_barras: code, tipo_movimiento: type, cantidad: amount, observacion: observation.trim(),
          }))
          setReceipt(`${response.movimiento.tipo_movimiento} registrada: ${fmt(response.movimiento.cantidad, 0)} ${response.material.unidad_medida} de ${response.material.nombre}. Stock actual: ${fmt(response.material.stock_actual, 0)} ${response.material.unidad_medida}.`)
          setQuickCode(''); setManualCode(''); setQuantity('1'); setObservation('')
          restoreFocus.current = true
          // Refresh errors remain visible on their respective resources; a saved
          // movement must never be offered again merely because its GET failed.
          void history.reload(); void materials.reload()
          return response
        } catch (reason) {
          if (mode === 'quick') { setQuickCode(''); restoreFocus.current = true }
          throw reason
        }
      }, 'Movimiento registrado.')
    } finally { locked.current = false }
  }

  if (!allowed) return <Empty>No tienes permiso para ver Operaciones.</Empty>
  const selectedMaterial = materials.data?.find(material => material.codigo_barras.toUpperCase() === manualCode.trim().toUpperCase())

  return <div className="view-stack bodega">
    <Heading title="Operaciones de bodega" actions={<Button disabled={task.busy || history.loading || materials.loading} onClick={() => { void history.reload(); void materials.reload() }}><RefreshCw /> Actualizar</Button>} />
    <Feedback task={{ error: validation || task.error, success: task.success ? receipt : '' }} />
    {editable ? <>
      <Panel className="bodega-mode">
        <span className="eyebrow">Tipo de movimiento</span>
        <div className="bodega-actions" role="group" aria-label="Tipo de movimiento">
          {(['Entrada', 'Salida'] as const).map(value => <Button key={value} variant={type === value ? 'primary' : 'soft'} aria-pressed={type === value} disabled={task.busy} onClick={() => { setType(value); quickInput.current?.focus() }}>
            {value === 'Entrada' ? <ArrowDownToLine /> : <ArrowUpFromLine />}{value}
          </Button>)}
        </div>
      </Panel>
      <div className="bodega-entry-grid">
        <Panel className="form-card">
          <div className="section-title"><span className="icon-tile blue"><Barcode /></span><h3>Escaneo rápido</h3></div>
          <form onSubmit={event => void register(event, 'quick')} aria-busy={task.busy}>
            <div className="form-grid"><label className="wide">Código de barras / SKU
              <input ref={quickInput} value={quickCode} onChange={event => setQuickCode(event.target.value)} readOnly={task.busy} disabled={!editable} autoComplete="off" spellCheck={false} required aria-describedby="quick-help" />
            </label></div>
            <p id="quick-help" className="subtle">{type} de 1 por Enter, en la unidad del material. Revisa el tipo antes de escanear.</p>
            <Button type="submit" variant="primary" className="full-button" disabled={task.busy}>{task.busy ? 'Guardando…' : `Registrar ${type.toLowerCase()} de 1`}</Button>
          </form>
        </Panel>
        <Panel className="form-card">
          <div className="section-title"><h3>Captura manual</h3></div>
          <form onSubmit={event => void register(event, 'manual')} aria-busy={task.busy}>
            <div className="form-grid">
              <label className="wide">Código de barras / SKU
                <input value={manualCode} onChange={event => setManualCode(event.target.value)} onFocus={() => { if (!task.busy) setQuantity('') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!task.busy) quantityInput.current?.focus() } }} readOnly={task.busy} list="bodega-material-options" autoComplete="off" spellCheck={false} required />
              </label>
              <label>Cantidad{selectedMaterial?.unidad_medida ? ` (${selectedMaterial.unidad_medida})` : ''}
                <input ref={quantityInput} type="number" min="1" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} readOnly={task.busy} required />
              </label>
              <div className="bodega-stock-hint subtle">{selectedMaterial ? `${selectedMaterial.nombre} · Stock: ${fmt(selectedMaterial.stock_actual, 0)} ${selectedMaterial.unidad_medida}` : 'Código y stock se validan al registrar.'}</div>
            </div>
            <Button type="submit" variant="primary" className="full-button" disabled={task.busy}>{task.busy ? 'Guardando…' : `Registrar ${type.toLowerCase()}`}</Button>
          </form>
          <datalist id="bodega-material-options">{materials.data?.map(material => <option key={material.id} value={material.codigo_barras}>{material.nombre}</option>)}</datalist>
        </Panel>
      </div>
      <Panel className="form-card"><div className="form-grid bodega-observation-field"><label className="wide">Observación del próximo movimiento (opcional)<textarea rows={2} value={observation} readOnly={task.busy} onChange={event => setObservation(event.target.value)} /></label></div></Panel>
    </> : <Panel className="form-card"><p className="subtle">Solo consulta. Registrar movimientos requiere permiso de edición de Operaciones.</p></Panel>}
    <Panel className="table-card">
      <div className="table-toolbar"><div><h3 className="strong">Historial de movimientos</h3><p className="subtle">Últimos 50 de bodega · Más recientes primero</p></div></div>
      <DataState resource={history} />
      <DataState resource={materials} />
      {materials.error && <p className="subtle bodega-padding">{materials.data ? 'No se pudo actualizar la lista de materiales. Las unidades y existencias mostradas corresponden a la última consulta recibida.' : 'No se pueden resolver las unidades hasta recuperar la lista de materiales.'}</p>}
      {history.error && history.data && <p className="bodega-note">Se muestran los últimos movimientos recibidos. Reintenta para consultar los registros más recientes.</p>}
      {history.data && <MovementHistory movements={history.data} materials={materials.data || []} />}
    </Panel>
  </div>
}
