'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, download, jsonRequest, useResource } from '@/lib/api'
import { fmt, fmtDate } from '@/lib/domain'
import type { Product } from '@/lib/types'
import { productionFields, type ConsumptionItem, type ConsumptionMaterial, type IndividualConsumption, type MissingData } from '@/lib/consumption-types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './planning.css'
import './consumption.css'

// No convertir null en cero ni ocultar consumos positivos pequeños al formatear.
export function consumptionNumber(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return 'Sin dato'
  if (value !== 0 && Math.abs(value) < 10 ** -digits) return new Intl.NumberFormat('es-EC', { notation: 'scientific', maximumSignificantDigits: 5 }).format(value)
  return fmt(value, digits)
}
export function missingProductionData(error: unknown): MissingData[] {
  if (!(error instanceof ApiError) || !Array.isArray(error.details.datos_faltantes)) return []
  return error.details.datos_faltantes.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    return [{ cliente: typeof row.cliente === 'string' ? row.cliente : null, codigo: typeof row.codigo === 'string' ? row.codigo : 'S/C', descripcion: typeof row.descripcion === 'string' ? row.descripcion : '', campos: Array.isArray(row.campos) ? row.campos.filter((field): field is string => typeof field === 'string') : [] }]
  })
}
export function MissingProduction({ rows }: { rows: MissingData[] }) {
  if (!rows.length) return null
  return <div className="planning-warning" role="alert"><strong>Datos que debes completar o corregir</strong>{rows.map((row, index) => <div key={`${row.cliente}-${row.codigo}-${index}`}><p>{row.cliente || 'Sin cliente asignado'} · {row.codigo} · {row.descripcion}</p><ul>{row.campos.map((field, i) => <li key={i}>{field}</li>)}</ul></div>)}<p>Revisa el catálogo de producción o los ítems del pedido y vuelve a calcular.</p></div>
}
export function ConsumptionWarnings({ item }: { item: ConsumptionItem }) {
  return item.advertencias.length ? <div className="planning-warning"><strong>Revisar · {item.cliente || 'Sin cliente'} · {item.codigo}</strong><ul>{item.advertencias.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div> : null
}
export function ConsumptionDetails({ item, label = 'Rendimientos y fórmulas' }: { item: ConsumptionItem; label?: string }) {
  return <details className="planning-details"><summary>{label}</summary>
    {!!item.pedidos_origen.length && <p className="planning-note">{item.pedidos_origen.join(' · ')}</p>}
    <dl className="planning-values">{productionFields.map(([key, text]) => <div key={key}><dt>{text} · catálogo</dt><dd>{item.datos_produccion[key] != null && item.datos_produccion[key]! > 0 ? consumptionNumber(item.datos_produccion[key]) : 'Sin dato'}</dd></div>)}</dl>
    <p className="planning-note">Rendimiento aplicado: {item.capacidad_rollo_fraccion} planchas/rollo · {item.fuente_rendimiento_rollo}. Largo: {consumptionNumber(item.largo_plancha_cm)} cm ({item.largo_plancha_calculado ? 'estimado' : 'guardado'}). Ancho: {consumptionNumber(item.ancho_rollo_m)} m.</p>
    <ul className="planning-note">{item.formulas.map((formula, index) => <li key={index}>{formula}</li>)}</ul>
  </details>
}
export function MaterialAvailability({ materials }: { materials: ConsumptionMaterial[] }) {
  return <Panel className="planning-panel consumption-materials"><h3>Disponibilidad en bodega</h3>
    <p className="planning-note">Stock al calcular, sin reservas de otros pedidos. El cálculo no reserva ni descuenta materiales.</p>
    <ScrollTable><table className="planning-table consumption-table"><caption>Consumo y stock por material</caption><thead><tr><th>Material / SKU</th><th>Consumo en rollos</th><th>Enteros a disponer</th><th>Stock en rollos</th><th>Disponibilidad</th></tr></thead><tbody>{materials.map(material => <tr key={material.clave}>
      <td data-label="Material / SKU"><strong>{material.nombre}</strong><br />{material.sku}<details><summary>Medidas y consumo</summary><p>Ancho: {consumptionNumber(material.ancho_m)} m · {consumptionNumber(material.planchas_totales, 0)} planchas · {consumptionNumber(material.metros_lineales)} m · {consumptionNumber(material.metros_cuadrados)} m²</p></details></td>
      <td data-label="Consumo en rollos">{consumptionNumber(material.rollos_estimados)}<br /><small>Exactos: {material.rollos_fraccion}</small></td>
      <td data-label="Enteros a disponer">{consumptionNumber(material.rollos_necesarios, 0)}</td>
      <td data-label="Stock en rollos">{material.stock_actual_rollos == null ? 'Desconocido' : consumptionNumber(material.stock_actual_rollos)}</td>
      <td data-label="Disponibilidad"><Status value={material.suficiente_stock == null ? 'Desconocida' : material.suficiente_stock ? 'Suficiente' : 'Insuficiente'} tone={material.suficiente_stock == null ? 'blue' : material.suficiente_stock ? 'green' : 'rose'} /></td>
    </tr>)}</tbody></table></ScrollTable>
    {materials.filter(material => material.advertencias.length > 0).map(material => <div className="planning-warning" key={material.clave}><strong>{material.sku} · {material.nombre}</strong><ul>{material.advertencias.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>)}
    <details className="inline-help"><summary>Cómo interpretar los rollos</summary><p className="planning-note">Enteros a disponer = techo de la suma por material, suponiendo remanentes compatibles. La disponibilidad desconocida debe verificarse en bodega antes de producir.</p></details>
  </Panel>
}

function increasedQuantity(value: string, delta: number): string | null {
  const current = value.trim() ? Number(value) : 0
  const next = current + delta
  return Number.isSafeInteger(current) && current >= 0 && Number.isSafeInteger(next) && next > 0 ? String(next) : null
}

export function Calculator() {
  const { can } = useSession()
  const allowed = can('calculadora')
  const catalog = useResource<Product[]>(allowed ? 'catalogo' : null)
  const task = useTask(), pdfTask = useTask()
  const busy = task.busy || pdfTask.busy
  const [client, setClient] = useState(''), [search, setSearch] = useState('')
  const [productId, setProductId] = useState(''), [quantity, setQuantity] = useState('1')
  const [prefillNote, setPrefillNote] = useState('')
  const prefilled = useRef(false), generation = useRef(0)
  const [result, setResult] = useState<{ calculation: IndividualConsumption; catalogSignature: string } | null>(null)
  const [missing, setMissing] = useState<MissingData[]>([])
  const product = catalog.data?.find(item => String(item.id) === productId)
  const productSignature = product ? JSON.stringify(product) : ''
  const inputSignature = JSON.stringify([productSignature, quantity, allowed])
  const latestInput = useRef(inputSignature); latestInput.current = inputSignature
  const term = search.trim().toLocaleLowerCase('es')
  const products = (catalog.data || []).filter(item => (!client || (client === '__sin_cliente__' ? !item.cliente : item.cliente === client)) && `${item.codigo} ${item.descripcion} ${item.cliente || ''}`.toLocaleLowerCase('es').includes(term))
  const clients = [...new Set((catalog.data || []).map(item => item.cliente || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
  const validQuantity = Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0
  function invalidate() { ++generation.current; setResult(null); setMissing([]); task.clear(); pdfTask.clear() }
  useEffect(() => { ++generation.current; setResult(null); setMissing([]) }, [productSignature, allowed])
  useEffect(() => () => { ++generation.current }, [])
  useEffect(() => {
    if (!allowed || !catalog.data || prefilled.current) return
    prefilled.current = true
    const params = new URLSearchParams(window.location.search)
    const id = params.get('producto_id'), code = params.get('codigo')?.trim(), customer = params.get('cliente')?.trim()
    if (params.has('cantidad')) setQuantity(params.get('cantidad')!.trim())
    if (!id && !code) return
    const matches = catalog.data.filter(item => id ? String(item.id) === id : item.codigo?.trim().toLocaleUpperCase('es') === code?.toLocaleUpperCase('es') && (!customer || item.cliente?.trim().toLocaleUpperCase('es') === customer.toLocaleUpperCase('es')))
    if (matches.length === 1) { setProductId(String(matches[0].id)); setClient(matches[0].cliente || '__sin_cliente__') }
    else { setSearch(code || ''); setPrefillNote(matches.length > 1 ? 'El código coincide con varios productos. Selecciona el cliente y producto correctos.' : 'El producto del enlace no está en el catálogo. Busca y selecciona uno disponible.') }
  }, [allowed, catalog.data])
  async function calculate(event: FormEvent) {
    event.preventDefault()
    if (!can('calculadora') || !product || !validQuantity || busy || catalog.error) return
    const version = ++generation.current, signature = productSignature, input = inputSignature
    setResult(null); setMissing([]); pdfTask.clear()
    const calculation = await task.run(async () => {
      try { return await api<IndividualConsumption>('calculadora/planchas', jsonRequest('POST', { producto_id: product.id, cantidad: Number(quantity) })) }
      catch (error) { if (version === generation.current && input === latestInput.current) setMissing(missingProductionData(error)); throw error }
    })
    if (calculation && version === generation.current && input === latestInput.current) setResult({ calculation, catalogSignature: signature })
  }
  async function pdf() {
    if (!result || result.catalogSignature !== productSignature || busy || catalog.error || !can('calculadora')) return
    const snapshot = result.calculation, version = generation.current
    await pdfTask.run(async () => {
      try { await download('calculadora/planchas/pdf', 'consumo_individual.pdf', jsonRequest('POST', { ...snapshot.parametros, revision_calculo: snapshot.revision_calculo })) }
      catch (error) {
        if (version === generation.current && error instanceof ApiError && [400, 404, 409].includes(error.status)) { setResult(null); setMissing(missingProductionData(error)) }
        throw error
      }
    })
  }
  if (!allowed) return <Empty>No tienes permiso para consultar la Calculadora.</Empty>
  const calculation = result?.catalogSignature === productSignature ? result.calculation : null
  return <div className="view-stack planning-view consumption-view">
    <Heading title="Calculadora MRP" subtitle="Calcula material y empaque para un producto." actions={<Button onClick={() => { invalidate(); void catalog.reload() }} disabled={busy}>Actualizar catálogo</Button>} />
    <DataState resource={catalog} /><Feedback task={task} /><Feedback task={pdfTask} /><MissingProduction rows={missing} />
    {catalog.data?.length === 0 && <Empty>Sin productos. Solicita agregarlos en Configuración → Catálogo de productos.</Empty>}
    <div className="mrp-layout">
      <Panel className="form-card"><div className="section-title"><h3>Producto y cantidad</h3></div>
        <form onSubmit={event => void calculate(event)}><div className="form-grid">
          <label className="wide">Cliente<select value={client} disabled={busy} onChange={event => { setClient(event.target.value); setProductId(''); setPrefillNote(''); invalidate() }}><option value="">Todos los clientes</option>{catalog.data?.some(item => !item.cliente) && <option value="__sin_cliente__">Sin cliente asignado</option>}{clients.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="wide">Buscar código, producto o cliente<input type="search" value={search} disabled={busy} placeholder="Código, descripción o cliente" onChange={event => { setSearch(event.target.value); setProductId(''); setPrefillNote(''); invalidate() }} /></label>
          <label className="wide">Producto<select aria-label="Producto" required value={productId} disabled={busy || !products.length} onChange={event => { setProductId(event.target.value); setPrefillNote(''); invalidate() }}><option value="">Selecciona un producto</option>{products.map(item => <option key={item.id} value={item.id}>{item.cliente || 'Sin cliente'} · {item.codigo || '-'} · {item.descripcion}</option>)}</select></label>
          <label className="wide">Cantidad de etiquetas<input type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={quantity} disabled={busy} onChange={event => { setQuantity(event.target.value); invalidate() }} /></label>
        </div>
          <div className="consumption-quantity" role="group" aria-label="Aumentar cantidad">{[500, 1000, 5000].map(delta => <Button key={delta} disabled={busy || increasedQuantity(quantity, delta) === null} onClick={() => { const next = increasedQuantity(quantity, delta); if (next !== null) { setQuantity(next); invalidate() } }}>+{fmt(delta, 0)}</Button>)}</div>
          {prefillNote && <p role="status" className="planning-warning">{prefillNote}</p>}
          {!!catalog.data?.length && !products.length && <Empty>No hay productos con estos filtros.</Empty>}
          {product && <p className="planning-note">{product.cliente || 'Sin cliente asignado'} · {product.codigo} · {product.descripcion}</p>}
          {!validQuantity && <p role="alert" className="planning-inline-error">Ingresa una cantidad entera mayor a cero y hasta {fmt(Number.MAX_SAFE_INTEGER, 0)}.</p>}
          <Button type="submit" variant="primary" className="full-button" disabled={busy || !product || !validQuantity || !!catalog.error}>{task.busy ? 'Calculando…' : 'Calcular consumo'}</Button>
          <Button className="consumption-reset" disabled={busy} onClick={() => { setClient(''); setSearch(''); setProductId(''); setQuantity(''); setPrefillNote(''); invalidate() }}>Limpiar selección</Button>
        </form>
        <p className="planning-note">Consultar no reserva ni descuenta stock.</p>
        <details className="inline-help"><summary>Cómo se calcula</summary><p className="planning-note">Usa el mismo rendimiento que el MRP por lote: etiquetas por rollo, o planchas base / rollos base, o estimación por largos. Completa los datos que no se puedan derivar.</p></details>
      </Panel>
      <div className="result-stack" aria-live="polite">{calculation ? <Panel className="planning-panel">
        <h3>{calculation.cliente || 'Sin cliente asignado'} · {calculation.codigo}</h3><p className="planning-note">{calculation.descripcion} · {consumptionNumber(calculation.cantidad_etiquetas, 0)} etiquetas</p>
        <dl className="planning-values consumption-summary">
          <div className="consumption-primary"><dt>Planchas totales</dt><dd>{consumptionNumber(calculation.planchas_totales, 0)}</dd></div>
          <div><dt>Enteros a disponer</dt><dd>{consumptionNumber(calculation.rollos_necesarios, 0)} rollos</dd></div>
          <div><dt>Metros lineales</dt><dd>{consumptionNumber(calculation.metros_lineales)} m</dd></div>
          <div><dt>Superficie</dt><dd>{consumptionNumber(calculation.metros_cuadrados)} m²</dd></div>
          <div><dt>Empaque de 200</dt><dd>{consumptionNumber(calculation.bultos, 0)} bultos</dd></div>
        </dl>
        <ConsumptionWarnings item={calculation} />
        <details className="planning-details"><summary>Consumo fraccionario y empaque</summary><p className="planning-note">Consumo: {consumptionNumber(calculation.rollos_decimal)} rollos (exactos: {calculation.rollos_fraccion}). {calculation.rollos_completos} rollos completos teóricos + {calculation.planchas_restantes_fraccion} planchas por consumir.</p><p className="planning-note">{calculation.paquetes_200} paquetes completos de 200 + {calculation.residuo_empaque} etiquetas. Las planchas restantes son consumo, no sobrantes de inventario.</p></details>
        <p className="planning-note">{fmtDate(calculation.generado_en_ecuador)} · Ecuador</p>
        <Button disabled={busy || !!catalog.error} onClick={() => void pdf()}>{pdfTask.busy ? 'Descargando…' : 'Descargar PDF de consumo'}</Button>
      </Panel> : <Panel className="planning-panel"><Empty>Elige un producto, indica la cantidad y calcula su consumo.</Empty></Panel>}</div>
    </div>
    {calculation && <><MaterialAvailability materials={calculation.materiales_bodega} /><Panel className="planning-panel"><ConsumptionDetails item={calculation} /></Panel></>}
  </div>
}
