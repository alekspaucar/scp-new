'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, download, jsonRequest, useResource } from '@/lib/api'
import { fmt, fmtDate } from '@/lib/domain'
import type { Product } from '@/lib/types'
import { productionFields, type ConsumptionItem, type ConsumptionMaterial, type IndividualConsumption, type MissingData } from '@/lib/consumption-types'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './planning.css'

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
export function ConsumptionDetails({ item, label = 'Rendimientos y fórmulas' }: { item: ConsumptionItem; label?: string }) {
  return <>
    {!!item.advertencias.length && <div className="planning-warning"><strong>Advertencias · {item.cliente || 'Sin cliente'} · {item.codigo}</strong><ul>{item.advertencias.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
    <details className="planning-details"><summary>{label}</summary>
      {!!item.pedidos_origen.length && <p className="planning-note">{item.pedidos_origen.join(' · ')}</p>}
      <dl className="planning-values">{productionFields.map(([key, text]) => <div key={key}><dt>{text} · catálogo</dt><dd>{item.datos_produccion[key] != null && item.datos_produccion[key]! > 0 ? consumptionNumber(item.datos_produccion[key]) : 'Sin dato'}</dd></div>)}</dl>
      <p className="planning-note">Rendimiento aplicado: {item.capacidad_rollo_fraccion} planchas/rollo · {item.fuente_rendimiento_rollo}. Largo: {consumptionNumber(item.largo_plancha_cm)} cm ({item.largo_plancha_calculado ? 'estimado' : 'guardado'}). Ancho: {consumptionNumber(item.ancho_rollo_m)} m.</p>
      <ul className="planning-note">{item.formulas.map((formula, index) => <li key={index}>{formula}</li>)}</ul>
    </details>
  </>
}
export function MaterialAvailability({ materials }: { materials: ConsumptionMaterial[] }) {
  return <Panel className="table-card"><ScrollTable><table className="planning-table"><caption>Disponibilidad por material · stock actual</caption><thead><tr><th>Material / SKU</th><th>Rollos fracción</th><th>Enteros a disponer</th><th>Stock (rollos)</th><th>Disponibilidad</th></tr></thead><tbody>{materials.map(material => <tr key={material.clave}><td>{material.nombre}<br />{material.sku}<details><summary>Medidas y consumo</summary><p>Ancho: {consumptionNumber(material.ancho_m)} m · {consumptionNumber(material.planchas_totales, 0)} planchas · {consumptionNumber(material.metros_lineales)} m · {consumptionNumber(material.metros_cuadrados)} m²</p></details></td><td>{consumptionNumber(material.rollos_estimados)}<br /><small>Exactos: {material.rollos_fraccion}</small></td><td>{consumptionNumber(material.rollos_necesarios, 0)}</td><td>{material.stock_actual_rollos === null ? 'Desconocido' : consumptionNumber(material.stock_actual_rollos, 0)}</td><td><Status value={material.suficiente_stock === null ? 'Desconocida' : material.suficiente_stock ? 'Suficiente' : 'Insuficiente'} tone={material.suficiente_stock === null ? 'blue' : material.suficiente_stock ? 'green' : 'rose'} /></td></tr>)}</tbody></table></ScrollTable>{materials.filter(material => material.advertencias.length > 0).map(material => <div className="planning-warning" key={material.clave}><strong>{material.sku} · {material.nombre}</strong><ul>{material.advertencias.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>)}<p className="planning-note" style={{ padding: '0 12px' }}>Enteros a disponer = techo de la suma por material, suponiendo remanentes compatibles. Disponibilidad sin reservas de otros pedidos.</p></Panel>
}

export function Calculator() {
  const { can } = useSession()
  const allowed = can('calculadora')
  const catalog = useResource<Product[]>(allowed ? 'catalogo' : null)
  const task = useTask(), pdfTask = useTask()
  const busy = task.busy || pdfTask.busy
  const [client, setClient] = useState(''), [search, setSearch] = useState('')
  const [productId, setProductId] = useState(''), [quantity, setQuantity] = useState('1')
  const [result, setResult] = useState<{ calculation: IndividualConsumption; catalogSignature: string } | null>(null)
  const [missing, setMissing] = useState<MissingData[]>([])
  const generation = useRef(0)
  const product = catalog.data?.find(item => String(item.id) === productId)
  const productSignature = product ? JSON.stringify(product) : ''
  const products = (catalog.data || []).filter(item => (!client || (client === '__sin_cliente__' ? !item.cliente : item.cliente === client)) && `${item.codigo} ${item.descripcion}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))
  const clients = [...new Set((catalog.data || []).map(item => item.cliente || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
  const validQuantity = Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0
  function invalidate() { ++generation.current; setResult(null); setMissing([]); task.clear(); pdfTask.clear() }
  useEffect(() => {
    if (result && (result.catalogSignature !== productSignature || !allowed)) { ++generation.current; setResult(null); setMissing([]) }
  }, [productSignature, result, allowed])
  async function calculate(event: FormEvent) {
    event.preventDefault()
    if (!can('calculadora') || !product || !validQuantity || busy || catalog.error) return
    const version = generation.current, signature = productSignature
    setResult(null); setMissing([]); pdfTask.clear()
    const calculation = await task.run(async () => {
      try { return await api<IndividualConsumption>('calculadora/planchas', jsonRequest('POST', { producto_id: product.id, cantidad: Number(quantity) })) }
      catch (error) { if (version === generation.current) setMissing(missingProductionData(error)); throw error }
    })
    if (calculation && version === generation.current) setResult({ calculation, catalogSignature: signature })
  }
  async function pdf() {
    if (!result || result.catalogSignature !== productSignature || busy || !can('calculadora')) return
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
  return <div className="view-stack planning-view">
    <Heading title="Calculadora MRP" actions={<Button onClick={() => { invalidate(); void catalog.reload() }} disabled={busy}>Actualizar catálogo</Button>} />
    <DataState resource={catalog} /><Feedback task={task} /><Feedback task={pdfTask} /><MissingProduction rows={missing} />
    {catalog.data?.length === 0 && <Empty>Sin productos. Agrégalos en Configuración → Catálogo de productos.</Empty>}
    <div className="mrp-layout">
      <Panel className="form-card"><div className="section-title"><h3>Producto y cantidad</h3></div>
        <form onSubmit={event => void calculate(event)}><div className="form-grid">
          <label className="wide">Cliente<select value={client} disabled={busy} onChange={event => { setClient(event.target.value); setProductId(''); invalidate() }}><option value="">Todos los clientes</option>{catalog.data?.some(item => !item.cliente) && <option value="__sin_cliente__">Sin cliente asignado</option>}{clients.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="wide">Buscar código o producto<input type="search" value={search} disabled={busy} placeholder="Código o descripción" onChange={event => { setSearch(event.target.value); setProductId(''); invalidate() }} /></label>
          <label className="wide">Producto<select required value={productId} disabled={busy || !products.length} onChange={event => { setProductId(event.target.value); invalidate() }}><option value="">Selecciona un producto</option>{products.map(item => <option key={item.id} value={item.id}>{item.cliente || 'Sin cliente'} · {item.codigo || '-'} · {item.descripcion}</option>)}</select></label>
          <label className="wide">Cantidad de etiquetas<input type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={quantity} disabled={busy} onChange={event => { setQuantity(event.target.value); invalidate() }} /></label>
        </div>
          {!!catalog.data?.length && !products.length && <Empty>No hay productos con estos filtros.</Empty>}
          {!validQuantity && <p className="planning-inline-error">Ingresa una cantidad entera mayor a cero.</p>}
          <Button type="submit" variant="primary" className="full-button" disabled={busy || !product || !validQuantity || !!catalog.error}>{task.busy ? 'Calculando…' : 'Calcular consumo'}</Button>
        </form>
        <details className="inline-help"><summary>Cómo se calcula</summary><p className="planning-note">Comparte el rendimiento del MRP por lote: etiquetas por rollo, o planchas base / rollos base, o estimación por largos. Los datos que no se puedan derivar deben completarse. Calcular no reserva ni descuenta stock.</p></details>
      </Panel>
      <div className="result-stack" aria-live="polite">{calculation ? <Panel className="planning-panel">
        <h3>{calculation.cliente || 'Sin cliente asignado'} · {calculation.codigo}</h3><p className="planning-note">{calculation.descripcion}</p>
        <dl className="planning-values">
          <div><dt>Etiquetas solicitadas</dt><dd>{consumptionNumber(calculation.cantidad_etiquetas, 0)}</dd></div>
          <div><dt>Planchas a consumir</dt><dd>{consumptionNumber(calculation.planchas_totales, 0)}</dd></div>
          <div><dt>Rollos fraccionarios</dt><dd>{consumptionNumber(calculation.rollos_decimal)} <small>({calculation.rollos_fraccion})</small></dd></div>
          <div><dt>Enteros a disponer (techo)</dt><dd>{consumptionNumber(calculation.rollos_necesarios, 0)}</dd></div>
          <div><dt>Metros lineales</dt><dd>{consumptionNumber(calculation.metros_lineales)} m</dd></div>
          <div><dt>Superficie</dt><dd>{consumptionNumber(calculation.metros_cuadrados)} m²</dd></div>
        </dl>
        <p className="planning-note">{calculation.rollos_completos} rollos completos teóricos + {calculation.planchas_restantes_fraccion} planchas por consumir. Empaque: {calculation.paquetes_200} paquetes de 200 + {calculation.residuo_empaque} etiquetas; {calculation.bultos} bultos.</p>
        <p className="planning-note">{fmtDate(calculation.generado_en_ecuador)} · Ecuador</p>
        <Button disabled={busy || !!catalog.error} onClick={() => void pdf()}>{pdfTask.busy ? 'Descargando…' : 'Descargar PDF de consumo'}</Button>
      </Panel> : <Panel className="planning-panel"><Empty>Elige un producto y calcula su consumo.</Empty></Panel>}</div>
    </div>
    {calculation && <><MaterialAvailability materials={calculation.materiales_bodega} /><Panel className="planning-panel"><ConsumptionDetails item={calculation} /></Panel></>}
  </div>
}
