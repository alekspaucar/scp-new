'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, download, jsonRequest, useResource } from '@/lib/api'
import { fmt, fmtDate, orderStates } from '@/lib/domain'
import type { Order } from '@/lib/types'
import type { BatchConsumption, MissingData } from '@/lib/consumption-types'
import { ConsumptionDetails, ConsumptionWarnings, MaterialAvailability, MissingProduction, consumptionNumber, missingProductionData } from './calculator'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './planning.css'
import './consumption.css'

interface Filters { desde: string; hasta: string; cliente: string; estado: string }
interface StockRow { material: string; sku: string; unidad_medida?: string | null; total_entradas: number; total_salidas: number; stock_resultante: number }
interface Snapshot<T> { data: T[]; filters: Filters; queriedAt: string }
const emptyFilters: Filters = { desde: '', hasta: '', cliente: '', estado: '' }
function normalizeFilters(value: Filters): Filters { return { desde: value.desde.trim(), hasta: value.hasta.trim(), cliente: value.cliente.trim(), estado: value.estado.trim() } }
function stockUnit(row: StockRow) { return row.unidad_medida?.trim() || 'Sin unidad informada' }
function queryPath(base: string, filters: Filters) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value.trim()) params.set(key, value.trim()) })
  return `${base}${params.size ? `?${params}` : ''}`
}
function filterDescription(filters: Filters) {
  return `Desde: ${filters.desde || 'sin límite'} · Hasta: ${filters.hasta || 'sin límite'} · Cliente: ${filters.cliente || 'todos'} · Estado: ${filters.estado || 'todos'}`
}

// Publish rows and applied filters together only after a successful response.
function useReportQuery<T>(base: string) {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null), generation = useRef(0)
  const attempted = useRef<Filters>(emptyFilters)
  const query = useCallback(async (filters: Filters) => {
    const applied = normalizeFilters(filters)
    attempted.current = applied
    const version = ++generation.current
    controller.current?.abort()
    const active = new AbortController(); controller.current = active
    setLoading(true); setError('')
    try {
      const data = await api<T[]>(queryPath(base, applied), { signal: active.signal })
      if (version === generation.current) setSnapshot({ data, filters: applied, queriedAt: new Date().toISOString() })
    } catch (reason) {
      if (!active.signal.aborted && version === generation.current) setError(reason instanceof Error ? reason.message : 'No se pudo consultar el reporte.')
    } finally { if (version === generation.current) setLoading(false) }
  }, [base])
  useEffect(() => { void query(emptyFilters); return () => { ++generation.current; controller.current?.abort() } }, [query])
  return { snapshot, loading, error, query, retry: () => query(attempted.current) }
}

function ReportFilters({ value, onChange, onSubmit, busy, orders = false }: { value: Filters; onChange: (value: Filters) => void; onSubmit: () => void; busy: boolean; orders?: boolean }) {
  const invalid = !!value.desde && !!value.hasta && value.desde > value.hasta
  function submit(event: FormEvent) { event.preventDefault(); if (!invalid && !busy) onSubmit() }
  return <form onSubmit={submit} className="planning-toolbar consumption-filters">
    <label>Desde<input type="date" value={value.desde} onChange={event => onChange({ ...value, desde: event.target.value })} /></label>
    <label>Hasta (incluido)<input type="date" value={value.hasta} onChange={event => onChange({ ...value, hasta: event.target.value })} /></label>
    {orders && <><label>Cliente (contiene)<input type="search" value={value.cliente} onChange={event => onChange({ ...value, cliente: event.target.value })} /></label><label>Estado<select value={value.estado} onChange={event => onChange({ ...value, estado: event.target.value })}><option value="">Todos</option>{orderStates.map(state => <option key={state}>{state}</option>)}</select></label></>}
    <Button type="submit" variant="primary" disabled={busy || invalid}>{busy ? 'Consultando…' : 'Consultar'}</Button>
    <Button disabled={busy} onClick={() => onChange({ ...emptyFilters })}>Limpiar filtros</Button>
    {invalid && <p role="alert" className="planning-inline-error">Desde debe ser anterior o igual a Hasta.</p>}
  </form>
}

function QueryFeedback({ loading, error, retry }: { loading: boolean; error: string; retry: () => Promise<void> }) {
  return <>{loading && <p role="status" className="planning-note">Consultando reporte…</p>}{error && <div role="alert" className="feedback error"><span>{error}</span><Button onClick={() => void retry()} disabled={loading}>Reintentar</Button></div>}</>
}

function AppliedFilters({ snapshot, draft }: { snapshot: Snapshot<unknown>; draft: Filters }) {
  const pending = (Object.keys(draft) as (keyof Filters)[]).some(key => normalizeFilters(draft)[key] !== snapshot.filters[key])
  return <div className="planning-note"><p><strong>Consulta:</strong> {filterDescription(snapshot.filters)} · {fmtDate(snapshot.queriedAt)}</p>{pending && <p>Cambios sin consultar. Exportar e imprimir usa la última consulta.</p>}</div>
}

function escapeHtml(value: unknown) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value ?? '—').replace(/[&<>"']/g, char => entities[char])
}
function exportStockCSV(snapshot: Snapshot<StockRow>) {
  function cell(value: string | number) {
    const text = typeof value === 'string' && /^\s*[=+@\-\t\r]/.test(value) ? `'${value}` : String(value)
    return `"${text.replace(/"/g, '""')}"`
  }
  const rows: (string | number)[][] = [
    ['SKU', 'Material', 'Unidad', 'Entradas', 'Salidas', 'Stock actual', 'Desde', 'Hasta', 'Consultado'],
    ...snapshot.data.map(row => [row.sku, row.material, stockUnit(row), row.total_entradas, row.total_salidas, row.stock_resultante, snapshot.filters.desde, snapshot.filters.hasta, fmtDate(snapshot.queriedAt)]),
  ]
  const url = URL.createObjectURL(new Blob(['\uFEFF', rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'reporte_stock.csv'; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function printStock(snapshot: Snapshot<StockRow>) {
  const tab = window.open('about:blank', '_blank')
  if (!tab) throw new Error('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes y reintenta.')
  tab.opener = null
  tab.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de stock</title><style>body{font:12px Arial;color:#243044;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd5e5;padding:8px;text-align:left}thead{display:table-header-group}h1{font-size:22px}@media print{button{display:none}}</style></head><body><h1>Reporte de stock</h1><p>${escapeHtml(filterDescription(snapshot.filters))}</p><p>Consultado: ${escapeHtml(fmtDate(snapshot.queriedAt))}. Entradas y salidas del intervalo; stock actual al consultar.</p><table><thead><tr><th>SKU</th><th>Material</th><th>Unidad</th><th>Entradas</th><th>Salidas</th><th>Stock actual</th></tr></thead><tbody>${snapshot.data.map(row => `<tr><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.material)}</td><td>${escapeHtml(stockUnit(row))}</td><td>${escapeHtml(consumptionNumber(row.total_entradas))}</td><td>${escapeHtml(consumptionNumber(row.total_salidas))}</td><td>${escapeHtml(consumptionNumber(row.stock_resultante))}</td></tr>`).join('')}</tbody></table><p>${snapshot.data.length ? '' : 'Sin movimientos en el intervalo.'}</p><button type="button" onclick="window.print()">Imprimir / guardar PDF</button></body></html>`)
  tab.document.close(); tab.focus(); tab.print()
}

export function Reports() {
  const { can } = useSession()
  const [tab, setTab] = useState<'stock' | 'orders' | 'mrp'>('stock')
  if (!can('reportes')) return <Empty>No tienes permiso para consultar Reportes.</Empty>
  return <div className="view-stack planning-view consumption-view"><Heading title="Reportes" />
    <div className="planning-tabs" role="tablist" aria-label="Tipos de reporte">{([['stock', 'Stock'], ['orders', 'Pedidos'], ['mrp', 'MRP por lote']] as const).map(([key, label]) => <Button key={key} role="tab" id={`report-tab-${key}`} aria-controls={`report-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onKeyDown={event => {
      const tabs = ['stock', 'orders', 'mrp'] as const
      const index = tabs.indexOf(key)
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
      if (next >= 0) { event.preventDefault(); setTab(tabs[next]); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#report-tab-${tabs[next]}`)?.focus() }
    }} variant={tab === key ? 'primary' : 'soft'} onClick={() => setTab(key)}>{label}</Button>)}</div>
    <div role="tabpanel" id={`report-panel-${tab}`} aria-labelledby={`report-tab-${tab}`} className="view-stack">{tab === 'stock' ? <StockReport /> : tab === 'orders' ? <OrdersReport /> : <BatchMRP />}</div>
  </div>
}

function StockReport() {
  const { can } = useSession()
  const report = useReportQuery<StockRow>('reportes/stock')
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const task = useTask()
  const snapshot = report.snapshot
  return <>
    <Panel className="planning-panel"><ReportFilters value={draft} onChange={setDraft} onSubmit={() => { task.clear(); void report.query(draft) }} busy={report.loading} />
      <p className="planning-note">Fechas: movimientos del intervalo. Stock: saldo actual, no histórico.</p>
      <QueryFeedback {...report} /><Feedback task={task} />
      {report.error && snapshot && <p className="planning-note">Se conserva la última consulta correcta.</p>}
      {snapshot && <AppliedFilters snapshot={snapshot} draft={draft} />}
      <div className="planning-actions"><Button disabled={task.busy || !snapshot || report.loading} onClick={() => { if (snapshot && can('reportes')) void task.run(async () => exportStockCSV(snapshot)) }}>Exportar CSV</Button><Button disabled={task.busy || !snapshot || report.loading} onClick={() => { if (snapshot && can('reportes')) void task.run(async () => printStock(snapshot)) }}>Imprimir / PDF</Button><Button disabled={task.busy} onClick={() => { if (can('reportes')) void task.run(() => download('exportar/excel', 'inventario_sgp.xlsx')) }}>Inventario completo (Excel)</Button></div>
      {snapshot?.data.some(row => !row.unidad_medida?.trim()) && <p className="planning-warning">El reporte no informa la unidad de algunos materiales. Verifícala en Inventario; no sumes cantidades de unidades distintas.</p>}
      <details className="inline-help"><summary>Ayuda</summary><p className="planning-note">CSV e impresión usan las filas y fechas consultadas. Excel incluye todo el inventario actual, sin filtrar por fechas.</p></details>
    </Panel>
    {snapshot && <Panel className="table-card">{snapshot.data.length ? <ScrollTable><table className="planning-table consumption-table"><caption>Movimientos por material</caption><thead><tr><th>SKU</th><th>Material / unidad</th><th>Entradas en intervalo</th><th>Salidas en intervalo</th><th>Stock actual</th></tr></thead><tbody>{snapshot.data.map((row, index) => <tr key={`${row.sku}-${index}`}><td data-label="SKU">{row.sku}</td><td data-label="Material / unidad">{row.material}<br /><small>{stockUnit(row)}</small></td><td data-label="Entradas en intervalo">{consumptionNumber(row.total_entradas)}</td><td data-label="Salidas en intervalo">{consumptionNumber(row.total_salidas)}</td><td data-label="Stock actual">{consumptionNumber(row.stock_resultante)}</td></tr>)}</tbody></table></ScrollTable> : <Empty>No hay movimientos con los filtros consultados.</Empty>}</Panel>}
  </>
}

function OrdersReport() {
  const { can } = useSession()
  const report = useReportQuery<Order>('reportes/pedidos')
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const task = useTask()
  const snapshot = report.snapshot
  function pdf(inline: boolean) {
    if (!snapshot || !can('reportes') || report.loading || task.busy) return
    void task.run(() => download('reportes/pedidos/pdf', 'reporte_pedidos.pdf', jsonRequest('POST', snapshot.filters), inline))
  }
  return <>
    <Panel className="planning-panel"><ReportFilters value={draft} onChange={setDraft} onSubmit={() => { task.clear(); void report.query(draft) }} busy={report.loading} orders />
      <p className="planning-note">Fechas de entrega efectiva. Si eliges fechas, se excluyen pedidos sin entrega efectiva.</p>
      <QueryFeedback {...report} /><Feedback task={task} />
      {report.error && snapshot && <p className="planning-note">Se conserva la última consulta correcta.</p>}
      {snapshot && <AppliedFilters snapshot={snapshot} draft={draft} />}
      <div className="planning-actions"><Button disabled={!snapshot || report.loading || task.busy} onClick={() => pdf(false)}>Descargar PDF</Button><Button disabled={!snapshot || report.loading || task.busy} onClick={() => pdf(true)}>Abrir PDF</Button></div>
      <details className="inline-help"><summary>Ayuda</summary><p className="planning-note">Sin fechas se incluyen los pedidos que coincidan con cliente y estado. El PDF usa los filtros de la última consulta correcta y los datos actuales al generarlo; puede reflejar cambios posteriores a la tabla. Imprime desde el PDF o descárgalo si se bloquea la ventana.</p></details>
    </Panel>
    {snapshot && <Panel className="table-card">{snapshot.data.length ? <ScrollTable><table className="planning-table consumption-table"><caption>Pedidos consultados · {snapshot.data.length}</caption><thead><tr><th>Pedido / OC</th><th>Cliente</th><th>Estado</th><th>Entrega prometida</th><th>Entrega efectiva</th><th>Ítems / unidades</th></tr></thead><tbody>{snapshot.data.map(order => <tr key={order.id}><td data-label="Pedido / OC">#ORD-{order.id}<br />{order.orden_compra || 'S/N'}</td><td data-label="Cliente">{order.cliente}</td><td data-label="Estado"><Status value={order.estado} /></td><td data-label="Entrega prometida">{fmtDate(order.fecha_entrega)}</td><td data-label="Entrega efectiva">{fmtDate(order.fecha_entregado)}</td><td data-label="Ítems / unidades">{fmt(order.total_items, 0)} / {fmt(order.total_unidades, 0)}<details><summary>Ver ítems</summary><ul>{order.items.map(item => <li key={item.id}>{item.codigo || 'S/C'} · {item.descripcion} · {fmt(item.cantidad, 0)} · {item.estado_item}{item.observacion ? ` · ${item.observacion}` : ''}</li>)}</ul></details></td></tr>)}</tbody></table></ScrollTable> : <Empty>No hay pedidos con los filtros consultados.</Empty>}</Panel>}
  </>
}

function BatchMRP() {
  const { can } = useSession()
  const orders = useResource<Order[]>(can('reportes') ? 'pedidos' : null)
  const task = useTask(), pdfTask = useTask()
  const busy = task.busy || pdfTask.busy
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<{ calculation: BatchConsumption; sourceSignature: string } | null>(null)
  const [missing, setMissing] = useState<MissingData[]>([])
  const generation = useRef(0)
  const queue = (orders.data || []).filter(order => order.estado === 'En Cola')
  const visible = queue.filter(order => `${order.id} ${order.cliente} ${order.orden_compra}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))
  const unavailable = [...selected].filter(id => !queue.some(order => order.id === id))
  const validSelection = selected.size > 0 && !unavailable.length && !!orders.data
  const allVisible = !!visible.length && visible.every(order => selected.has(order.id))
  const sourceSignature = JSON.stringify((orders.data || []).filter(order => selected.has(order.id)).sort((a, b) => a.id - b.id))
  const allowed = can('reportes')
  const latestSource = useRef(sourceSignature); latestSource.current = sourceSignature
  useEffect(() => { ++generation.current; setResult(null); setMissing([]) }, [sourceSignature, allowed])
  useEffect(() => () => { ++generation.current }, [])
  function selection(next: Set<number>) { ++generation.current; setSelected(next); setResult(null); setMissing([]); task.clear(); pdfTask.clear() }
  function toggle(id: number) { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); selection(next) }
  function selectAll() { const next = new Set(selected); visible.forEach(order => { if (allVisible) next.delete(order.id); else next.add(order.id) }); selection(next) }
  async function calculate() {
    if (!can('reportes') || !validSelection || busy || orders.error) return
    const version = ++generation.current, ids = [...selected].sort((a, b) => a - b), signature = sourceSignature
    setResult(null); setMissing([]); pdfTask.clear()
    const response = await task.run(async () => {
      try { return await api<BatchConsumption>('reportes/mrp-lote', jsonRequest('POST', { pedidos_ids: ids })) }
      catch (error) { if (version === generation.current && signature === latestSource.current) setMissing(missingProductionData(error)); throw error }
    })
    if (response && version === generation.current && signature === latestSource.current) setResult({ calculation: response, sourceSignature: signature })
  }
  async function pdf() {
    if (!result || result.sourceSignature !== sourceSignature || !validSelection || busy || orders.error || !can('reportes')) return
    const snapshot = result.calculation, version = generation.current
    await pdfTask.run(async () => {
      try { await download('reportes/mrp-lote/pdf', 'consumo_lote.pdf', jsonRequest('POST', { ...snapshot.parametros, revision_calculo: snapshot.revision_calculo })) }
      catch (error) {
        if (version === generation.current && error instanceof ApiError && [400, 404, 409].includes(error.status)) { setResult(null); setMissing(missingProductionData(error)) }
        throw error
      }
    })
  }
  const calculation = result?.sourceSignature === sourceSignature && validSelection ? result.calculation : null
  return <>
    <Panel className="planning-panel"><h3>Selecciona pedidos En Cola</h3><p className="planning-note">Selecciona pedidos para calcular consumo por cliente y producto. No reserva ni descuenta stock.</p>
      <DataState resource={orders} />
      <div className="planning-toolbar"><label>Buscar cliente, pedido u OC<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><Button disabled={busy || orders.loading} onClick={() => { selection(new Set(selected)); void orders.reload() }}>Actualizar</Button><Button disabled={busy || !visible.length} onClick={selectAll}>{allVisible ? 'Quitar visibles' : 'Seleccionar visibles'}</Button><Button disabled={busy || !selected.size} onClick={() => selection(new Set())}>Limpiar selección</Button><Button disabled={busy || orders.loading || !queue.length} onClick={() => selection(new Set(queue.map(order => order.id)))}>Seleccionar toda la cola</Button><span className="planning-note">{selected.size} seleccionados · {visible.length} visibles / {queue.length} En Cola{selected.size > visible.filter(order => selected.has(order.id)).length ? ` · ${selected.size - visible.filter(order => selected.has(order.id)).length} fuera de la búsqueda` : ''}</span></div>
      {!!unavailable.length && orders.data && <div className="planning-warning"><p>Estos pedidos ya no están disponibles En Cola. Retíralos para recalcular.</p><div className="planning-actions">{unavailable.map(id => <Button key={id} disabled={busy} onClick={() => toggle(id)}>Quitar #ORD-{id}</Button>)}</div></div>}
      {orders.data && (visible.length ? <div className="consumption-selection">
        <label className="consumption-select-all"><input type="checkbox" aria-label="Seleccionar todos los pedidos visibles" checked={allVisible} disabled={busy || orders.loading} onChange={selectAll} />Seleccionar pedidos visibles</label>
        <ul className="consumption-orders">{visible.map(order => <li key={order.id}><label className={`consumption-order ${selected.has(order.id) ? 'is-selected' : ''}`}>
          <input type="checkbox" aria-label={`Seleccionar pedido ${order.id} de ${order.cliente}`} checked={selected.has(order.id)} disabled={busy || orders.loading} onChange={() => toggle(order.id)} />
          <span><strong>#ORD-{order.id} · {order.cliente}</strong><span>OC {order.orden_compra || 'S/N'} · {fmt(order.total_items, 0)} ítems · {fmt(order.total_unidades, 0)} etiquetas</span><span>Entrega: {fmtDate(order.fecha_entrega)}</span></span>
        </label></li>)}</ul>
      </div> : <Empty>{queue.length ? 'No hay pedidos con esta búsqueda.' : 'No hay pedidos En Cola.'}</Empty>)}
      <div className="planning-actions"><Button variant="primary" disabled={busy || !validSelection || !!orders.error} onClick={() => void calculate()}>{task.busy ? 'Calculando…' : 'Calcular MRP del lote'}</Button><Button disabled={busy || !calculation || !!orders.error} onClick={() => void pdf()}>{pdfTask.busy ? 'Descargando…' : 'Descargar PDF del lote'}</Button></div>
      <Feedback task={task} /><Feedback task={pdfTask} /><MissingProduction rows={missing} />
    </Panel>
    {calculation && <MRPOutput result={calculation} />}
  </>
}

function MRPOutput({ result }: { result: BatchConsumption }) {
  const { can } = useSession()
  const totals = result.totales
  const itemKey = (item: BatchConsumption['items_agrupados'][number]) => JSON.stringify([item.cliente, item.codigo, item.producto.id, item.descripcion])
  return <>
    <Panel className="planning-panel"><h3>Consumo del lote</h3><p className="planning-note">{fmtDate(result.generado_en_ecuador)} · Ecuador · {totals.total_pedidos} pedidos · {result.items_agrupados.length} productos</p>
      <dl className="planning-values consumption-summary"><div className="consumption-primary"><dt>Planchas totales</dt><dd>{consumptionNumber(totals.total_planchas, 0)}</dd></div><div><dt>Etiquetas</dt><dd>{consumptionNumber(totals.total_etiquetas, 0)}</dd></div><div><dt>Enteros a disponer por material</dt><dd>{consumptionNumber(totals.total_rollos_necesarios, 0)} rollos</dd></div><div><dt>Metros lineales</dt><dd>{consumptionNumber(totals.total_metros_lineales)} m</dd></div><div><dt>Superficie</dt><dd>{consumptionNumber(totals.total_metros_cuadrados)} m²</dd></div><div><dt>Empaque por producto</dt><dd>{consumptionNumber(totals.total_bultos_empaque, 0)} bultos</dd></div></dl>
      <p className="planning-note">Consumo fraccionario: {consumptionNumber(totals.total_rollos)} rollos (exactos: {totals.total_rollos_fraccion}). Los enteros se redondean por material; no sumes los enteros por producto.</p>
      <details className="planning-details"><summary>Pedidos incluidos</summary><ul>{result.pedidos_seleccionados.map(order => <li key={order.id}>#ORD-{order.id} · {order.cliente} · OC {order.orden_compra || 'S/N'}</li>)}</ul></details>
    </Panel>
    {result.items_agrupados.map(item => <ConsumptionWarnings key={itemKey(item)} item={item} />)}
    <MaterialAvailability materials={result.materiales_bodega} />
    <Panel className="planning-panel"><h3>Consumo por cliente y producto</h3>
      <ScrollTable><table className="planning-table consumption-table"><caption>Desglose del lote</caption><thead><tr><th>Cliente / código</th><th>Producto / material</th><th>Etiquetas / planchas</th><th>Consumo en rollos</th><th>Metros / m²</th><th>Empaque de 200</th></tr></thead><tbody>{result.items_agrupados.map(item => <tr key={itemKey(item)}>
        <td data-label="Cliente / código">{item.cliente || 'Sin cliente'}<br />{item.codigo}</td><td data-label="Producto / material">{item.descripcion}<br /><small>{item.material_sku || 'Sin SKU'} · {item.material_nombre}</small>{can('calculadora') && <a className="soft-button consumption-product-link" href={`/calculadora?${new URLSearchParams({ producto_id: String(item.producto.id), cantidad: String(item.cantidad_total) })}`}>Calcular este producto</a>}</td>
        <td data-label="Etiquetas / planchas">{consumptionNumber(item.cantidad_total, 0)} etiquetas<br />{consumptionNumber(item.planchas_totales, 0)} planchas</td>
        <td data-label="Consumo en rollos">{consumptionNumber(item.rollos_decimal)} (exactos: {item.rollos_fraccion})<details><summary>Desglose de rollos</summary><p>{consumptionNumber(item.rollos_necesarios, 0)} enteros por producto, antes de consolidar material.</p><p>{item.rollos_completos} completos teóricos + {item.planchas_restantes_fraccion} planchas por consumir; no son sobrantes de inventario.</p></details></td>
        <td data-label="Metros / m²">{consumptionNumber(item.metros_lineales)} m<br />{consumptionNumber(item.metros_cuadrados)} m²</td><td data-label="Empaque de 200">{item.paquetes_200} paquetes + {item.residuo_empaque} etiquetas<br />{item.bultos} bultos</td>
      </tr>)}</tbody></table></ScrollTable>
      {result.items_agrupados.map(item => <ConsumptionDetails key={itemKey(item)} item={item} label={`${item.cliente || 'Sin cliente'} · ${item.codigo} · Origen y rendimiento`} />)}
    </Panel>
  </>
}
