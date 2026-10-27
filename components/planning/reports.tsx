'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, download, jsonRequest, useResource } from '@/lib/api'
import { fmt, fmtDate, orderStates } from '@/lib/domain'
import type { Order } from '@/lib/types'
import type { BatchConsumption, MissingData } from '@/lib/consumption-types'
import { ConsumptionDetails, MaterialAvailability, MissingProduction, consumptionNumber, missingProductionData } from './calculator'
import { useSession } from '@/components/session-provider'
import { Button, DataState, Empty, Feedback, Heading, Panel, ScrollTable, Status, useTask } from '@/components/shared'
import './planning.css'

interface Filters { desde: string; hasta: string; cliente: string; estado: string }
interface StockRow { material: string; sku: string; total_entradas: number; total_salidas: number; stock_resultante: number }
interface Snapshot<T> { data: T[]; filters: Filters; queriedAt: string }
const emptyFilters: Filters = { desde: '', hasta: '', cliente: '', estado: '' }
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
    attempted.current = { ...filters }
    const version = ++generation.current
    controller.current?.abort()
    const active = new AbortController(); controller.current = active
    setLoading(true); setError('')
    try {
      const data = await api<T[]>(queryPath(base, filters), { signal: active.signal })
      if (version === generation.current) setSnapshot({ data, filters: { ...filters }, queriedAt: new Date().toISOString() })
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
  return <form onSubmit={submit} className="planning-toolbar">
    <label>Desde<input type="date" value={value.desde} onChange={event => onChange({ ...value, desde: event.target.value })} /></label>
    <label>Hasta (incluido)<input type="date" value={value.hasta} onChange={event => onChange({ ...value, hasta: event.target.value })} /></label>
    {orders && <><label>Cliente (contiene)<input type="search" value={value.cliente} onChange={event => onChange({ ...value, cliente: event.target.value })} /></label><label>Estado<select value={value.estado} onChange={event => onChange({ ...value, estado: event.target.value })}><option value="">Todos</option>{orderStates.map(state => <option key={state}>{state}</option>)}</select></label></>}
    <Button type="submit" variant="primary" disabled={busy || invalid}>{busy ? 'Consultando…' : 'Consultar'}</Button>
    {invalid && <p role="alert" className="planning-inline-error">Desde debe ser anterior o igual a Hasta.</p>}
  </form>
}

function QueryFeedback({ loading, error, retry }: { loading: boolean; error: string; retry: () => Promise<void> }) {
  return <>{loading && <p role="status" className="planning-note">Consultando reporte…</p>}{error && <div role="alert" className="feedback error"><span>{error}</span><Button onClick={() => void retry()} disabled={loading}>Reintentar</Button></div>}</>
}

function AppliedFilters({ snapshot, draft }: { snapshot: Snapshot<unknown>; draft: Filters }) {
  const pending = (Object.keys(draft) as (keyof Filters)[]).some(key => draft[key] !== snapshot.filters[key])
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
    ['SKU', 'Material', 'Entradas', 'Salidas', 'Stock actual', 'Desde', 'Hasta', 'Consultado'],
    ...snapshot.data.map(row => [row.sku, row.material, row.total_entradas, row.total_salidas, row.stock_resultante, snapshot.filters.desde, snapshot.filters.hasta, fmtDate(snapshot.queriedAt)]),
  ]
  const url = URL.createObjectURL(new Blob(['\uFEFF', rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'reporte_stock.csv'; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function printStock(snapshot: Snapshot<StockRow>) {
  const tab = window.open('about:blank', '_blank')
  if (!tab) throw new Error('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes y reintenta.')
  tab.opener = null
  tab.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de stock</title><style>body{font:12px Arial;color:#243044;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd5e5;padding:8px;text-align:left}thead{display:table-header-group}h1{font-size:22px}@media print{button{display:none}}</style></head><body><h1>Reporte de stock</h1><p>${escapeHtml(filterDescription(snapshot.filters))}</p><p>Consultado: ${escapeHtml(fmtDate(snapshot.queriedAt))}. Entradas y salidas del intervalo; stock actual al consultar.</p><table><thead><tr><th>SKU</th><th>Material</th><th>Entradas</th><th>Salidas</th><th>Stock actual</th></tr></thead><tbody>${snapshot.data.map(row => `<tr><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.material)}</td><td>${escapeHtml(fmt(row.total_entradas))}</td><td>${escapeHtml(fmt(row.total_salidas))}</td><td>${escapeHtml(fmt(row.stock_resultante))}</td></tr>`).join('')}</tbody></table><p>${snapshot.data.length ? '' : 'Sin movimientos en el intervalo.'}</p><button type="button" onclick="window.print()">Imprimir / guardar PDF</button></body></html>`)
  tab.document.close(); tab.focus(); tab.print()
}

export function Reports() {
  const { can } = useSession()
  const [tab, setTab] = useState<'stock' | 'orders' | 'mrp'>('stock')
  if (!can('reportes')) return <Empty>No tienes permiso para consultar Reportes.</Empty>
  return <div className="view-stack planning-view"><Heading title="Reportes" />
    <div className="planning-tabs" role="tablist" aria-label="Tipos de reporte">{([['stock', 'Stock'], ['orders', 'Pedidos'], ['mrp', 'MRP por lote']] as const).map(([key, label]) => <Button key={key} role="tab" id={`report-tab-${key}`} aria-controls={`report-panel-${key}`} aria-selected={tab === key} variant={tab === key ? 'primary' : 'soft'} onClick={() => setTab(key)}>{label}</Button>)}</div>
    <div role="tabpanel" id={`report-panel-${tab}`} aria-labelledby={`report-tab-${tab}`} className="view-stack">{tab === 'stock' ? <StockReport /> : tab === 'orders' ? <OrdersReport /> : <BatchMRP />}</div>
  </div>
}

function StockReport() {
  const report = useReportQuery<StockRow>('reportes/stock')
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const task = useTask()
  const snapshot = report.snapshot
  return <>
    <Panel className="planning-panel"><ReportFilters value={draft} onChange={setDraft} onSubmit={() => { task.clear(); void report.query(draft) }} busy={report.loading} />
      <p className="planning-note">Fechas: movimientos del intervalo. Stock: saldo actual, no histórico.</p>
      <QueryFeedback {...report} /><Feedback task={task} />
      {snapshot && <AppliedFilters snapshot={snapshot} draft={draft} />}
      <div className="planning-actions"><Button disabled={task.busy || !snapshot || report.loading} onClick={() => { if (snapshot) void task.run(async () => exportStockCSV(snapshot)) }}>Exportar CSV</Button><Button disabled={task.busy || !snapshot || report.loading} onClick={() => { if (snapshot) void task.run(async () => printStock(snapshot)) }}>Imprimir / PDF</Button><Button disabled={task.busy} onClick={() => void task.run(() => download('exportar/excel', 'inventario_sgp.xlsx'))}>Inventario completo (Excel)</Button></div>
      <details className="inline-help"><summary>Ayuda</summary><p className="planning-note">CSV e impresión usan las filas y fechas consultadas. Excel incluye todo el inventario actual, sin filtrar por fechas.</p></details>
    </Panel>
    {snapshot && <Panel className="table-card">{snapshot.data.length ? <ScrollTable><table className="planning-table"><caption>Movimientos por material</caption><thead><tr><th>SKU</th><th>Material</th><th>Entradas en intervalo</th><th>Salidas en intervalo</th><th>Stock actual</th></tr></thead><tbody>{snapshot.data.map((row, index) => <tr key={`${row.sku}-${index}`}><td>{row.sku}</td><td>{row.material}</td><td>{fmt(row.total_entradas)}</td><td>{fmt(row.total_salidas)}</td><td>{fmt(row.stock_resultante)}</td></tr>)}</tbody></table></ScrollTable> : <Empty>No hay movimientos con los filtros consultados.</Empty>}</Panel>}
  </>
}

function OrdersReport() {
  const report = useReportQuery<Order>('reportes/pedidos')
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const task = useTask()
  const snapshot = report.snapshot
  function pdf(inline: boolean) {
    if (!snapshot) return
    void task.run(() => download('reportes/pedidos/pdf', 'reporte_pedidos.pdf', jsonRequest('POST', snapshot.filters), inline))
  }
  return <>
    <Panel className="planning-panel"><ReportFilters value={draft} onChange={setDraft} onSubmit={() => { task.clear(); void report.query(draft) }} busy={report.loading} orders />
      <p className="planning-note">Fechas de entrega efectiva. Si eliges fechas, se excluyen pedidos sin entrega efectiva.</p>
      <QueryFeedback {...report} /><Feedback task={task} />
      {snapshot && <AppliedFilters snapshot={snapshot} draft={draft} />}
      <div className="planning-actions"><Button disabled={!snapshot || report.loading || task.busy} onClick={() => pdf(false)}>Descargar PDF</Button><Button disabled={!snapshot || report.loading || task.busy} onClick={() => pdf(true)}>Abrir PDF</Button></div>
      <details className="inline-help"><summary>Ayuda</summary><p className="planning-note">Sin fechas se incluyen los pedidos que coincidan con cliente y estado. El PDF usa los filtros de la última consulta correcta. Imprime desde el PDF o descárgalo si se bloquea la ventana.</p></details>
    </Panel>
    {snapshot && <Panel className="table-card">{snapshot.data.length ? <ScrollTable><table className="planning-table"><caption>Pedidos consultados · {snapshot.data.length}</caption><thead><tr><th>Pedido / OC</th><th>Cliente</th><th>Estado</th><th>Entrega prometida</th><th>Entrega efectiva</th><th>Ítems / unidades</th></tr></thead><tbody>{snapshot.data.map(order => <tr key={order.id}><td>#ORD-{order.id}<br />{order.orden_compra || 'S/N'}</td><td>{order.cliente}</td><td><Status value={order.estado} /></td><td>{fmtDate(order.fecha_entrega)}</td><td>{fmtDate(order.fecha_entregado)}</td><td>{fmt(order.total_items, 0)} / {fmt(order.total_unidades, 0)}<details><summary>Ver ítems</summary><ul>{order.items.map(item => <li key={item.id}>{item.codigo || 'S/C'} · {item.descripcion} · {fmt(item.cantidad, 0)} · {item.estado_item}{item.observacion ? ` · ${item.observacion}` : ''}</li>)}</ul></details></td></tr>)}</tbody></table></ScrollTable> : <Empty>No hay pedidos con los filtros consultados.</Empty>}</Panel>}
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
  const visible = queue.filter(order => `${order.id} ${order.cliente} ${order.orden_compra}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))
  const unavailable = [...selected].filter(id => !queue.some(order => order.id === id))
  const validSelection = selected.size > 0 && !unavailable.length && !!orders.data
  const allVisible = !!visible.length && visible.every(order => selected.has(order.id))
  const sourceSignature = JSON.stringify((orders.data || []).filter(order => selected.has(order.id)).sort((a, b) => a.id - b.id))
  const allowed = can('reportes')
  useEffect(() => {
    if (result && (result.sourceSignature !== sourceSignature || !allowed)) { ++generation.current; setResult(null); setMissing([]) }
  }, [sourceSignature, result, allowed])
  function selection(next: Set<number>) { ++generation.current; setSelected(next); setResult(null); setMissing([]); task.clear(); pdfTask.clear() }
  function toggle(id: number) { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); selection(next) }
  function selectAll() { const next = new Set(selected); visible.forEach(order => { if (allVisible) next.delete(order.id); else next.add(order.id) }); selection(next) }
  async function calculate() {
    if (!can('reportes') || !validSelection || busy || orders.error) return
    const version = generation.current, ids = [...selected], signature = sourceSignature
    setResult(null); setMissing([]); pdfTask.clear()
    const response = await task.run(async () => {
      try { return await api<BatchConsumption>('reportes/mrp-lote', jsonRequest('POST', { pedidos_ids: ids })) }
      catch (error) { if (version === generation.current) setMissing(missingProductionData(error)); throw error }
    })
    if (response && version === generation.current) setResult({ calculation: response, sourceSignature: signature })
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
    <Panel className="planning-panel"><h3>Pedidos En Cola</h3><p className="planning-note">Selecciona pedidos para calcular consumo por cliente y producto. No reserva ni descuenta stock.</p>
      <DataState resource={orders} />
      <div className="planning-toolbar"><label>Buscar cliente, pedido u OC<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><Button disabled={busy || orders.loading} onClick={() => { selection(new Set(selected)); void orders.reload() }}>Actualizar</Button><Button disabled={busy || !visible.length} onClick={selectAll}>{allVisible ? 'Quitar visibles' : 'Seleccionar visibles'}</Button><Button disabled={busy || !selected.size} onClick={() => selection(new Set())}>Limpiar selección</Button><span className="planning-note">{selected.size} seleccionados · {visible.length} visibles / {queue.length} En Cola</span></div>
      {!!unavailable.length && orders.data && <div className="planning-warning"><p>Estos pedidos ya no están disponibles En Cola. Retíralos para recalcular.</p><div className="planning-actions">{unavailable.map(id => <Button key={id} disabled={busy} onClick={() => toggle(id)}>Quitar #ORD-{id}</Button>)}</div></div>}
      {orders.data && (visible.length ? <ScrollTable><table className="planning-table"><caption>Selección de pedidos</caption><thead><tr><th><input type="checkbox" aria-label="Seleccionar todos los pedidos visibles" checked={allVisible} disabled={busy} onChange={selectAll} /></th><th>Pedido / OC</th><th>Cliente</th><th>Entrega prometida</th><th>Ítems</th><th>Etiquetas</th></tr></thead><tbody>{visible.map(order => <tr key={order.id}><td><input type="checkbox" aria-label={`Seleccionar pedido ${order.id} de ${order.cliente}`} checked={selected.has(order.id)} disabled={busy} onChange={() => toggle(order.id)} /></td><td>#ORD-{order.id}<br />{order.orden_compra || 'S/N'}</td><td>{order.cliente}</td><td>{fmtDate(order.fecha_entrega)}</td><td>{fmt(order.total_items, 0)}</td><td>{fmt(order.total_unidades, 0)}</td></tr>)}</tbody></table></ScrollTable> : <Empty>{queue.length ? 'No hay pedidos con esta búsqueda.' : 'No hay pedidos En Cola.'}</Empty>)}
      <div className="planning-actions"><Button variant="primary" disabled={busy || !validSelection || !!orders.error} onClick={() => void calculate()}>{task.busy ? 'Calculando…' : 'Calcular MRP'}</Button><Button disabled={busy || !calculation || !!orders.error} onClick={() => void pdf()}>{pdfTask.busy ? 'Descargando…' : 'Descargar PDF del lote'}</Button></div>
      <Feedback task={task} /><Feedback task={pdfTask} /><MissingProduction rows={missing} />
    </Panel>
    {calculation && <MRPOutput result={calculation} />}
  </>
}

function MRPOutput({ result }: { result: BatchConsumption }) {
  const totals = result.totales
  return <>
    <Panel className="planning-panel"><h3>Consumo del lote</h3><p className="planning-note">{fmtDate(result.generado_en_ecuador)} · Ecuador · {totals.total_pedidos} pedidos</p>
      <dl className="planning-values"><div><dt>Etiquetas</dt><dd>{consumptionNumber(totals.total_etiquetas, 0)}</dd></div><div><dt>Planchas</dt><dd>{consumptionNumber(totals.total_planchas, 0)}</dd></div><div><dt>Rollos fraccionarios</dt><dd>{consumptionNumber(totals.total_rollos)}</dd></div><div><dt>Enteros a disponer por material</dt><dd>{consumptionNumber(totals.total_rollos_necesarios, 0)}</dd></div><div><dt>Metros lineales</dt><dd>{consumptionNumber(totals.total_metros_lineales)} m</dd></div><div><dt>Superficie</dt><dd>{consumptionNumber(totals.total_metros_cuadrados)} m²</dd></div><div><dt>Bultos por producto</dt><dd>{consumptionNumber(totals.total_bultos_empaque, 0)}</dd></div></dl>
      <details className="planning-details"><summary>Pedidos incluidos</summary><ul>{result.pedidos_seleccionados.map(order => <li key={order.id}>#ORD-{order.id} · {order.cliente} · OC {order.orden_compra || 'S/N'}</li>)}</ul></details>
    </Panel>
    <Panel className="table-card"><ScrollTable><table className="planning-table"><caption>Consumo por cliente y producto</caption><thead><tr><th>Cliente / código</th><th>Producto / material</th><th>Etiquetas / planchas</th><th>Rollos teóricos / enteros a disponer</th><th>Metros / m²</th><th>Empaque de 200</th></tr></thead><tbody>{result.items_agrupados.map(item => <tr key={item.producto.id}><td>{item.cliente || 'Sin cliente'}<br />{item.codigo}</td><td>{item.descripcion}<br /><small>{item.material_sku || 'Sin SKU'} · {item.material_nombre}</small></td><td>{consumptionNumber(item.cantidad_total, 0)} etiquetas<br />{consumptionNumber(item.planchas_totales, 0)} planchas</td><td>{consumptionNumber(item.rollos_decimal)} ≈ {item.rollos_fraccion}<br />{item.rollos_necesarios} enteros a disponer<details><summary>Desglose</summary>{item.rollos_completos} completos teóricos + {item.planchas_restantes_fraccion} planchas por consumir</details></td><td>{consumptionNumber(item.metros_lineales)} m<br />{consumptionNumber(item.metros_cuadrados)} m²</td><td>{item.paquetes_200} paquetes + {item.residuo_empaque} etiquetas<br />{item.bultos} bultos</td></tr>)}</tbody></table></ScrollTable></Panel>
    <MaterialAvailability materials={result.materiales_bodega} />
    <Panel className="planning-panel"><h3>Rendimientos y fórmulas</h3>{result.items_agrupados.map(item => <ConsumptionDetails key={item.producto.id} item={item} label={`${item.cliente || 'Sin cliente'} · ${item.codigo}`} />)}</Panel>
  </>
}
