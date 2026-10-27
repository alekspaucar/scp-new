'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, FileUp, ScanBarcode } from 'lucide-react'
import { Button, DataState, Empty, Feedback, Modal, Panel, ScrollTable, useTask } from '@/components/shared'
import { useSession } from '@/components/session-provider'
import { api, ApiError, jsonRequest, upload, useResource } from '@/lib/api'
import { dateInput, fmt, fmtDate } from '@/lib/domain'
import { confirmAction } from '@/lib/confirm'
import type { Client, Order, Product } from '@/lib/types'
import { useCurrentOrderGuard, useOrderAction } from './order-action'
import { productForItem, ProductReference } from './order-reference'
import './orders.css'

interface DraftItem { key: string; id?: number; codigo: string; descripcion: string; cantidad: number; minimum?: number }
interface ReadDocument { cliente?: string | null; orden_compra?: string | null; fecha_entrega?: string | null; items?: { codigo: string; descripcion: string; cantidad: number }[] }
const newRow = (): DraftItem => ({ key: crypto.randomUUID(), codigo: '', descripcion: '', cantidad: 1 })
const norm = (value: string) => value.trim().toLocaleUpperCase()
const isBlankRow = (item: DraftItem) => item.id === undefined && !item.codigo.trim() && !item.descripcion.trim() && item.cantidad === 1 && item.minimum === undefined
const describeRow = (item: DraftItem, index: number) => `ítem ${index + 1}${item.id !== undefined ? ` (#${item.id})` : ''}: ${(item.descripcion.trim() || item.codigo.trim() || 'sin descripción').slice(0, 60)} · cantidad ${item.cantidad}`
const clearClientCodes = (rows: DraftItem[]) => rows.map(item => ({ ...item, codigo: '' }))
const draftItems = (order: Order): DraftItem[] => order.items.length ? order.items.map(item => ({ key: `item-${item.id}`, id: item.id, codigo: item.codigo, descripcion: item.descripcion, cantidad: item.cantidad, minimum: item.cantidad_entregada_total || 1 })) : [newRow()]

export function OrderEditor({ order, onClose, onSaved }: { order?: Order; onClose: () => void; onSaved: () => void }) {
  const { can, user } = useSession()
  const [referenceOrder, setReferenceOrder] = useState(order), [revision, setRevision] = useState(order?.revision), [conflict, setConflict] = useState(false)
  const allowed = can('pedidos', 'editar') && (referenceOrder?.estado !== 'Entregado' || user?.rol === 'jefe')
  const guard = useCurrentOrderGuard(allowed, `${referenceOrder?.id || 'new'}`)
  // Catalogs are only requested while an authorized editor is actually open.
  const products = useResource<Product[]>(allowed ? 'catalogo' : null, 0), clients = useResource<Client[]>(allowed ? 'clientes' : null, 0)
  const [client, setClient] = useState(order?.cliente || ''), [oc, setOc] = useState(order?.orden_compra || ''), [date, setDate] = useState(dateInput(order?.fecha_entrega))
  const [items, setItems] = useState<DraftItem[]>(() => order ? draftItems(order) : [newRow()])
  const [review, setReview] = useState(false), [validation, setValidation] = useState(''), [imported, setImported] = useState(false), [reviewed, setReviewed] = useState(false), [importNote, setImportNote] = useState('')
  const [scan, setScan] = useState(''), [scanQty, setScanQty] = useState(1), [rowCount, setRowCount] = useState<string | null>(null), [document, setDocument] = useState<File | null>(null)
  const task = useTask(), reader = useTask(), reloader = useTask(), scanRef = useRef<HTMLInputElement>(null), documentRef = useRef<HTMLInputElement>(null), action = useOrderAction()
  const blocked = task.busy || reader.busy || reloader.busy || action.busy, captureId = useId()
  const [captureTool, setCaptureTool] = useState<'document' | 'scan' | null>(null)
  function isBlocked() { return action.isBusy() || task.busy || reader.busy || reloader.busy }
  const catalog = (products.data || []).filter(product => norm(product.cliente || '') === norm(client))
  const dirty = useRef(false)
  function selectDocument(file: File | null) { if (!allowed || isBlocked()) return; setDocument(file); reader.clear(); setValidation('') }
  function change() { dirty.current = true; setReview(false); setReviewed(false) }
  function changeClient(value: string, fromImport = false) {
    if (!fromImport && isBlocked()) return
    change()
    if (norm(value) !== norm(client)) {
      setItems(current => clearClientCodes(current))
      setScan(''); setScanQty(1); setValidation('')
    }
    setClient(value)
  }
  async function close() {
    if (isBlocked()) return
    await action.run(async () => {
      if ((dirty.current || scan.trim() || document) && !await confirmAction('¿Cerrar y descartar los cambios sin guardar?', { confirmLabel: 'Descartar cambios', danger: true })) return
      onClose()
    })
  }
  async function reloadDraft() {
    if (!referenceOrder || isBlocked()) return
    await action.run(async () => {
      if (!await confirmAction('¿Recargar el pedido vigente y descartar todos los cambios de este borrador?', { confirmLabel: 'Recargar y descartar', danger: true })) return
      const fresh = await reloader.run(async () => {
        const current = await api<Order>(`pedidos/${referenceOrder.id}`)
        if (!Number.isInteger(current.revision)) throw new Error('La respuesta no incluye una revisión válida. Se conservó tu borrador; vuelve a intentar cuando el servicio esté actualizado.')
        return current
      })
      if (!fresh) return
      setClient(fresh.cliente); setOc(fresh.orden_compra); setDate(dateInput(fresh.fecha_entrega)); setItems(draftItems(fresh))
      setReferenceOrder(fresh); setRevision(fresh.revision); setConflict(false); setReview(false); setValidation('')
      setScan(''); setScanQty(1); setRowCount(null); setDocument(null); setImported(false); setReviewed(false); setImportNote('')
      dirty.current = false; task.clear(); reader.clear(); setCaptureTool(null)
    })
  }
  function update(key: string, patch: Partial<DraftItem>) { if (isBlocked()) return; change(); setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item)) }
  function selectProduct(key: string, productId: string) {
    const product = catalog.find(entry => String(entry.id) === productId)
    if (product) update(key, { codigo: product.codigo, descripcion: product.descripcion })
  }
  async function resizeRows(value: string) {
    if (isBlocked()) return
    if (value === '') { setRowCount(''); return }
    setRowCount(null)
    const requested = Number(value)
    if (!Number.isInteger(requested)) return
    const count = Math.max(1, Math.min(50, requested))
    if (count === items.length) return
    await action.run(async () => {
      if (count < items.length) {
        const populated = items.slice(count).map((item, index) => ({ item, index: count + index })).filter(({ item }) => !isBlankRow(item))
        if (populated.length) {
          const detail = populated.slice(0, 3).map(({ item, index }) => describeRow(item, index)).join('\n')
          const more = populated.length > 3 ? `\nY ${populated.length - 3} filas con datos más.` : ''
          const saved = populated.some(({ item }) => item.id !== undefined) ? '\nSus entregas y faltantes asociados se eliminarán al guardar.' : ''
          if (!await confirmAction(`¿Reducir de ${items.length} a ${count} filas? Se quitarán ${populated.length} con datos:\n${detail}${more}${saved}`, { confirmLabel: 'Reducir filas', danger: true })) return
        }
      }
      change()
      setItems(current => count < current.length ? current.slice(0, count) : [...current, ...Array.from({ length: count - current.length }, newRow)])
    })
  }
  async function removeRow(item: DraftItem, index: number) {
    if (items.length <= 1 || isBlocked()) return
    await action.run(async () => {
      const saved = item.id !== undefined ? '\nSus entregas y faltantes asociados se eliminarán al guardar.' : ''
      if (!isBlankRow(item) && !await confirmAction(`¿Quitar ${describeRow(item, index)}?${saved}`, { confirmLabel: 'Quitar ítem', danger: true })) return
      change(); setItems(current => current.length > 1 ? current.filter(entry => entry.key !== item.key) : current)
    })
  }
  function addScan() {
    if (isBlocked()) return
    if (!client.trim()) { setValidation('Selecciona un cliente primero.'); return }
    const code = norm(scan)
    if (!code || !Number.isInteger(scanQty) || scanQty < 1) { setValidation('Indica un código y una cantidad entera positiva.'); return }
    const match = catalog.filter(product => norm(product.codigo) === code)
    if (match.length > 1) { setValidation('Hay varios productos con este código. Selecciona la descripción correcta desde el catálogo.'); return }
    // A repeated code may refer to a different manually described job. Only
    // combine an unambiguous catalog match with the same description.
    const candidates = match.length === 1 && !['S/C', '-'].includes(code) ? items.filter(item => norm(item.codigo) === code && norm(item.descripcion) === norm(match[0].descripcion)) : []
    const existing = candidates.length === 1 ? candidates[0] : undefined
    const blank = items.find(isBlankRow)
    if (!existing && !blank && items.length >= 50) { setValidation('Se alcanzó el límite de 50 ítems.'); return }
    change()
    if (existing) setItems(current => current.map(item => item.key === existing.key ? { ...item, cantidad: item.cantidad + scanQty } : item))
    else {
      const row = { codigo: code, descripcion: match.length === 1 ? match[0].descripcion : '', cantidad: scanQty }
      setItems(current => blank ? current.map(item => item.key === blank.key ? { ...item, ...row } : item) : [...current, { ...newRow(), ...row }])
    }
    setValidation(''); setScan(''); setScanQty(1); scanRef.current?.focus()
  }
  async function readDocument() {
    if (order || !allowed || !document || isBlocked()) return
    await action.run(async () => {
      if (dirty.current && !await confirmAction('¿Aplicar los datos detectados? Se actualizarán cliente, OC y fecha detectados. Los ítems coincidentes se actualizarán y los nuevos se agregarán; revisa el resultado.', { confirmLabel: 'Aplicar datos' })) return
      if (!guard()) return
      const data = await reader.run(() => upload<ReadDocument>('pedidos/leer-documento', document))
      if (!data || !guard()) return
      change(); setImported(true); setReviewed(false); setDocument(null)
      if (documentRef.current) documentRef.current.value = ''
      const clientChanged = Boolean(data.cliente && norm(data.cliente) !== norm(client))
      if (data.cliente) changeClient(data.cliente, true)
      if (data.orden_compra) setOc(data.orden_compra)
      if (data.fecha_entrega) setDate(data.fecha_entrega.length === 10 ? `${data.fecha_entrega}T00:00` : dateInput(data.fecha_entrega))
      let omitted = 0
      const retained = items.filter(item => !isBlankRow(item))
      const merged = clientChanged ? clearClientCodes(retained) : retained.map(item => ({ ...item }))
      const used = new Set<string>()
      for (const incoming of data.items || []) {
        const previous = merged.find(item => !used.has(item.key) && (clientChanged || norm(item.codigo || 'S/C') === norm(incoming.codigo || 'S/C')) && norm(item.descripcion) === norm(incoming.descripcion))
        if (previous) { previous.codigo = incoming.codigo; previous.cantidad = incoming.cantidad; used.add(previous.key) }
        else if (merged.length < 50) {
          const row = { ...newRow(), ...incoming }
          merged.push(row)
          used.add(row.key)
        }
        else omitted++
      }
      setItems(merged.length ? merged : [newRow()])
      setImportNote(`Revisa cliente, OC, fecha y hora, códigos, descripciones y cantidades. ${data.fecha_entrega?.length === 10 ? 'El documento solo indicó el día: debes confirmar la hora (se muestra 00:00).' : ''} ${!(data.items || []).length ? 'No se detectaron ítems; completa las filas manualmente.' : ''} ${omitted ? `${omitted} filas no se agregaron por el límite de 50.` : ''}`)
    })
  }
  function validate(event: FormEvent) {
    event.preventDefault(); setValidation('')
    if (!allowed || isBlocked() || conflict) return
    if (scan.trim()) { setValidation('Agrega el escaneo pendiente o limpia el código antes de revisar.'); return }
    if (document) { setValidation('Hay un documento seleccionado pendiente de lectura. Léelo o descártalo antes de revisar.'); return }
    if (!client.trim() || !date || items.length < 1 || items.length > 50) { setValidation('Completa cliente, fecha y entre 1 y 50 ítems.'); return }
    if (items.some(item => !item.descripcion.trim() || !Number.isInteger(item.cantidad) || item.cantidad < Math.max(1, item.minimum || 1))) { setValidation('Cada ítem necesita descripción y cantidad entera positiva, al menos igual a sus entregas registradas.'); return }
    if (imported && !reviewed) { setValidation('Confirma la revisión manual de los datos leídos del documento.'); return }
    setReview(true)
  }
  async function save() {
    if (!allowed || !review || conflict || isBlocked()) return
    if (referenceOrder && !Number.isInteger(revision)) { setConflict(true); setValidation('Este borrador no tiene una revisión válida. Recarga el pedido vigente antes de guardar.'); return }
    await action.run(async () => {
      if (referenceOrder && !await confirmAction(`¿Guardar las correcciones del pedido #${referenceOrder.id}?${referenceOrder.estado === 'Entregado' ? ' El servidor ajustará su impacto en stock.' : ''}`, { confirmLabel: 'Guardar correcciones' })) return
      if (!guard()) return
      const result = await task.run(async () => {
        try {
          return await api<{ pedido: Order }>(referenceOrder ? `pedidos/${referenceOrder.id}` : 'pedidos', jsonRequest(referenceOrder ? 'PUT' : 'POST', {
            ...(referenceOrder ? { revision } : {}), cliente: client.trim(), orden_compra: oc.trim() || 'S/N', fecha_entrega: date,
            items: items.map(item => ({ ...(item.id !== undefined ? { id: item.id } : {}), codigo: norm(item.codigo) || 'S/C', descripcion: item.descripcion.trim(), cantidad: item.cantidad })),
          }))
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) setConflict(true)
          throw error
        }
      })
      if (result && guard()) { dirty.current = false; onSaved() }
    })
  }
  return <Modal wide title={order ? `Editar pedido #${order.id}` : 'Nuevo pedido'} onClose={() => void close()}>
    <div className="orders-form orders-scope"><Feedback task={task} /><Feedback task={reader} /><Feedback task={reloader} />{validation && <div role="alert" className="feedback error">{validation}</div>}
      {conflict && <p className="orders-note" role="alert">El pedido cambió desde que abriste este borrador. Tus cambios se conservaron y no se enviarán con una revisión nueva. Para seguir, recarga la versión vigente y descarta este borrador. Si ahora está Entregado, solo el jefe podrá editarlo.</p>}
      {referenceOrder && <Button disabled={blocked} onClick={() => void reloadDraft()}>{reloader.busy ? 'Recargando pedido…' : 'Recargar pedido y descartar este borrador'}</Button>}
      {!allowed ? <Empty>{referenceOrder?.estado === 'Entregado' && user?.rol !== 'jefe' ? 'El pedido vigente está Entregado. Solo el jefe puede editarlo; puedes cerrar esta ventana.' : 'No tienes permiso para editar este pedido.'}</Empty> : <fieldset className="orders-form" disabled={blocked} style={{ border: 0, padding: 0, minWidth: 0 }}>
      {review ? <><Panel className="orders-panel-pad"><h4>Revisión antes de guardar</h4><dl className="orders-summary"><div><dt>Cliente</dt><dd>{client}</dd></div><div><dt>Orden de compra</dt><dd>{oc.trim() || 'S/N'}</dd></div><div><dt>Entrega</dt><dd>{fmtDate(date)}</dd></div><div><dt>Ítems</dt><dd>{items.length}</dd></div><div><dt>Unidades</dt><dd>{fmt(items.reduce((sum, item) => sum + item.cantidad, 0))}</dd></div></dl></Panel>
        <ScrollTable><table className="orders-table"><thead><tr><th>Código</th><th>Descripción</th><th>Cantidad</th></tr></thead><tbody>{items.map(item => <tr key={item.key}><td>{item.codigo.trim() || 'S/C'}</td><td>{item.descripcion}</td><td>{fmt(item.cantidad)}</td></tr>)}</tbody></table></ScrollTable>
        <div className="orders-actions"><Button disabled={blocked} onClick={() => setReview(false)}>Volver a editar</Button><Button disabled={blocked || conflict} variant="primary" onClick={() => void save()}>{task.busy ? 'Guardando…' : task.error ? 'Reintentar guardar' : 'Confirmar y guardar'}</Button></div></> : <>
        <div className="orders-capture-tools">
          {!order && <Button className="orders-capture-tool" aria-expanded={captureTool === 'document'} aria-controls={`${captureId}-document`} onClick={() => setCaptureTool(current => current === 'document' ? null : 'document')}><FileUp aria-hidden="true" /><span>Importar documento{document ? ' · pendiente' : ''}</span><ChevronDown aria-hidden="true" /></Button>}
          <Button className="orders-capture-tool" aria-expanded={captureTool === 'scan'} aria-controls={`${captureId}-scan`} onClick={() => setCaptureTool(current => current === 'scan' ? null : 'scan')}><ScanBarcode aria-hidden="true" /><span>Escáner{scan.trim() ? ' · código pendiente' : ''}</span><ChevronDown aria-hidden="true" /></Button>
        </div>
        {!order && <section id={`${captureId}-document`} hidden={captureTool !== 'document'} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectDocument(event.dataTransfer.files?.[0] || null) }}><fieldset className="orders-capture-panel" disabled={blocked}><legend>Importar documento</legend><p className="subtle">Arrastra un PDF o una foto aquí, o selecciona el archivo.</p><div className="orders-actions"><label>Seleccionar PDF o imagen<input ref={documentRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={event => selectDocument(event.target.files?.[0] || null)} /></label><Button variant="primary" disabled={!document || blocked} onClick={() => void readDocument()}>{reader.busy ? 'Leyendo…' : reader.error ? 'Reintentar lectura' : 'Leer y completar'}</Button>{document && <Button disabled={blocked} onClick={() => { setDocument(null); if (documentRef.current) documentRef.current.value = '' }}>Descartar documento seleccionado</Button>}</div>{document && <p className="subtle">Documento pendiente: {document.name}</p>}</fieldset></section>}
        {imported && <div className="orders-note">{importNote}</div>}
        <DataState resource={clients} /><DataState resource={products} />
        <form onSubmit={validate} className="orders-form"><fieldset disabled={blocked}><legend>Datos del pedido</legend><div className="form-grid"><label>Cliente<input required list="order-clients" value={client} onChange={event => changeClient(event.target.value)} /><datalist id="order-clients">{(clients.data || []).map(entry => <option key={entry.id} value={entry.nombre} />)}</datalist><span className="subtle">Cambiar cliente limpia los códigos y el escáner.</span>{client.trim() && clients.data && !clients.data.some(entry => norm(entry.nombre) === norm(client)) && <span className="orders-shortage-alert">Nuevo cliente: se creará al guardar.</span>}</label><label>Orden de compra (opcional)<input value={oc} onChange={event => { if (isBlocked()) return; change(); setOc(event.target.value) }} placeholder="S/N" /></label><label>Fecha y hora de entrega (Ecuador)<input type="datetime-local" required value={date} onChange={event => { if (isBlocked()) return; change(); setDate(event.target.value) }} /></label></div></fieldset>
          <section id={`${captureId}-scan`} hidden={captureTool !== 'scan'}>{captureTool === 'scan' && <fieldset className="orders-capture-panel" disabled={blocked}><legend>Escáner</legend><div className="orders-actions"><label>Código de barras o manual<input aria-label="Código para escanear" autoFocus ref={scanRef} value={scan} onChange={event => { if (!isBlocked()) setScan(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addScan() } }} /></label><label>Cantidad<input type="number" min={1} step={1} value={scanQty || ''} onChange={event => { if (!isBlocked()) setScanQty(Number(event.target.value)) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addScan() } }} /></label><Button onClick={addScan}>Agregar escaneo</Button>{(scan.trim() || scanQty !== 1) && <Button onClick={() => { if (isBlocked()) return; setScan(''); setScanQty(1); setValidation(''); scanRef.current?.focus() }}>Cancelar escaneo</Button>}</div></fieldset>}</section>
          <fieldset disabled={blocked}><legend>Ítems ({items.length}/50)</legend>
            <div className="orders-actions orders-row-control"><label>Filas<input type="number" min={1} max={50} step={1} value={rowCount ?? items.length} onChange={event => void resizeRows(event.target.value)} onBlur={() => setRowCount(null)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation() } }} /></label></div>
            {items.map((item, index) => <div key={item.key}>
            <label>Ítem {index + 1} · Producto<select value="" onChange={event => selectProduct(item.key, event.target.value)}><option value="">Catálogo del cliente</option>{catalog.map(product => <option key={product.id} value={product.id}>{product.codigo === '-' ? 'S/C' : product.codigo} · {product.descripcion}</option>)}</select></label>
            <div className="orders-draft-row"><label>Código<input aria-label={`Código del ítem ${index + 1}`} list={`codes-${item.key}`} value={item.codigo} placeholder="S/C" onChange={event => { const code = event.target.value; const matches = catalog.filter(product => norm(product.codigo) === norm(code)); update(item.key, { codigo: code, ...(matches.length === 1 ? { descripcion: matches[0].descripcion } : {}) }) }} /><datalist id={`codes-${item.key}`}>{catalog.filter(product => product.codigo !== '-').map(product => <option key={product.id} value={product.codigo}>{product.descripcion}</option>)}</datalist></label><label>Descripción<input required value={item.descripcion} onChange={event => update(item.key, { descripcion: event.target.value })} /></label><label>Cantidad<input required type="number" min={Math.max(1, item.minimum || 1)} step={1} value={item.cantidad || ''} onChange={event => update(item.key, { cantidad: Number(event.target.value) })} /></label><Button variant="danger" disabled={items.length <= 1} onClick={() => void removeRow(item, index)}>Quitar</Button></div>
            <ProductReference product={productForItem(catalog, client, item)} />
          </div>)}<details className="orders-editor-details"><summary>Ayuda de captura</summary><p className="subtle">Filas indica el total visible. El catálogo corresponde al cliente escrito; también puedes completar los campos manualmente. Un cliente nuevo se crea al guardar y un código vacío se guarda como S/C.</p></details></fieldset>
          {imported && <label className="orders-tick"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />Revisé manualmente todos los datos del documento y confirmé la hora de entrega.</label>}
          <div className="orders-actions"><Button onClick={() => void close()} disabled={blocked}>Cancelar</Button><Button type="submit" variant="primary" disabled={blocked || conflict}>Revisar pedido</Button></div>
        </form></>}
    </fieldset>}</div>
  </Modal>
}
