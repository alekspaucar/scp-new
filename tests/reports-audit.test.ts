import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

// In-memory TSX execution: real handlers, report query, API and task hook;
// deterministic hook lifecycle and catalog/queue fixtures, no browser or service.
const require = createRequire(import.meta.url)
type Element = { type: string | ((props: any) => any); props: any }
const products = [
  { id: 1, codigo: 'DUP', cliente: 'Acme', descripcion: 'Etiqueta A', cant_etiquetas_plancha: 10, ancho_rollo: 1.5 },
  { id: 2, codigo: 'DUP', cliente: 'Beta', descripcion: 'Etiqueta B', cant_etiquetas_plancha: 20, ancho_rollo: 1.2 },
]
const order = (id: number, estado = 'En Cola') => ({ id, revision: 1, cliente: 'Acme', estado, orden_compra: `OC-${id}`, fecha_entrega: '2026-10-27T10:00:00', total_items: 1, total_unidades: 100, items: [] })
const item = {
  producto: products[0], codigo: 'DUP', cliente: 'Acme', descripcion: 'Etiqueta A', cantidad_total: 100, cantidad_etiquetas: 100,
  pedidos_origen: ['#ORD-1 (Acme, OC OC-1)'], cant_etiquetas_plancha: 10, planchas_por_rollo: 30, capacidad_rollo_fraccion: '30',
  planchas_totales: 10, etiquetas_capacidad: 100, etiquetas_excedentes: 0, rollos_decimal: 1 / 3, rollos_fraccion: '1/3', rollos_completos: 0,
  rollos_necesarios: 1, planchas_sobrantes: 10, planchas_restantes_fraccion: '10', largo_plancha_cm: 50, ancho_rollo_m: 1.5,
  metros_lineales: 5, metros_cuadrados: 7.5, datos_produccion: {}, fuente_rendimiento_rollo: 'cant_etiquetas_rollo', largo_plancha_calculado: false,
  advertencias: ['Confirma el rendimiento en planta.'], formulas: ['Rendimiento validado del servidor'], paquetes_200: 0, residuo_empaque: 100, bultos: 1, total_bultos: 1,
  material_id: 1, material_sku: 'MAT-1', material_nombre: 'Sustrato',
}
const material = { clave: 'material-1', sku: 'MAT-1', nombre: 'Sustrato', ancho_m: 1.5, planchas_totales: 10, metros_lineales: 5, metros_cuadrados: 7.5, stock_actual_rollos: 0.25, rollos_estimados: 1 / 3, rollos_fraccion: '1/3', rollos_necesarios: 1, suficiente_stock: false, advertencias: [] }
const individual = { ...item, revision_calculo: 'rev-individual', generado_en_ecuador: '2026-10-27T10:00:00-05:00', parametros: { producto_id: 1, cantidad: 100 }, materiales_bodega: [material] }
const batch = { revision_calculo: 'rev-lote', generado_en_ecuador: '2026-10-27T10:00:00-05:00', parametros: { pedidos_ids: [1] }, pedidos_seleccionados: [order(1)], items_agrupados: [item], materiales_bodega: [material], totales: { total_pedidos: 1, total_etiquetas: 100, total_planchas: 10, total_rollos: 1 / 3, total_rollos_fraccion: '1/3', total_rollos_necesarios: 1, total_metros_lineales: 5, total_metros_cuadrados: 7.5, total_bultos_empaque: 1 } }
const filters = { desde: '', hasta: '', cliente: '', estado: '' }

function harness(file: 'calculator' | 'reports', component: string) {
  let cursor = 0, dirty = false, effects: (() => void)[] = []
  const slots: any[] = [], cleanups: (() => void)[] = [], modules = new Map<string, any>()
  const requests: { path: string; init: RequestInit }[] = [], downloads: { href: string; download: string }[] = [], blobs = new Map<string, Blob>()
  const resources: Record<string, any> = { catalogo: { data: products, loading: false, error: '', reload: async () => {} }, pedidos: { data: [order(1), order(2), order(3, 'Procesando')], loading: false, error: '', reload: async () => {} } }
  const printed: string[] = []
  const state = { allowed: true, search: '', popupBlocked: false, responder: async (_path: string, _init: RequestInit): Promise<Response> => new Response('[]', { headers: { 'Content-Type': 'application/json' } }) }
  const same = (a: any[] | undefined, b: any[] | undefined) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next: any) => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true } }] },
    useRef(value: any) { const index = cursor++; return slots[index] ||= { current: value } },
    useCallback(callback: any, deps: any[]) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback }; return slots[index].callback },
    useEffect(effect: () => any, deps?: any[]) { const index = cursor++; if (!same(slots[index], deps)) { slots[index] = deps; effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() }) } },
    useId: () => 'test-id',
  }
  const jsx = (type: any, props: any) => ({ type, props })
  const window = { location: { get search() { return state.search } }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, setTimeout() {}, open: () => state.popupBlocked ? null : ({ opener: null, document: { write(content: string) { printed.push(content) }, close() {} }, focus() {}, print() {}, location: { href: '' }, close() {} }) }
  const document = { createElement: () => { const anchor = { href: '', download: '', click() { downloads.push({ href: anchor.href, download: anchor.download }) } }; return anchor } }
  const Url = class extends URL { static createObjectURL(blob: Blob) { const value = `blob:test-${blobs.size}`; blobs.set(value, blob); return value } static revokeObjectURL() {} }
  const load = (name: string): any => {
    if (modules.has(name)) return modules.get(name)
    const module = { exports: {} as any }; modules.set(name, module.exports)
    const path = new URL(`../${name}`, import.meta.url)
    let source = readFileSync(path, 'utf8')
    // Expose private functions only in the in-memory copy for behavioral tests.
    source = source.replace(/^function /gm, 'export function ')
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
    const resolve = (id: string): any => {
      if (id === 'react') return hooks
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
      if (id === 'lucide-react') return new Proxy({}, { get: () => () => null })
      if (id.endsWith('.css')) return {}
      if (id === '@/components/session-provider') return { useSession: () => ({ can: () => state.allowed }) }
      if (id === '@/lib/api') return { ...load('lib/api.ts'), useResource: (resource: string | null) => resources[resource || ''] || { data: null, loading: false, error: '', reload: async () => {} } }
      if (id === './calculator') return load('components/planning/calculator.tsx')
      if (id.startsWith('@/')) return load(`${id.slice(2)}${id.includes('/components/') || id === '@/components/shared' ? '.tsx' : '.ts'}`)
      return require(id)
    }
    vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { URL: Url, URLSearchParams, Blob, Date, Intl, Number, Set, AbortController, AbortSignal, Error, window, document, setTimeout, clearTimeout, fetch: async (path: string, init: RequestInit = {}) => { requests.push({ path, init }); return state.responder(path, init) } }, { filename: name })(resolve, module, module.exports)
    return module.exports
  }
  const exports = load(`components/planning/${file}.tsx`)
  let lastProps: any = {}
  const render = (props: any = lastProps) => {
    lastProps = props
    let tree: Element
    let attempts = 0
    do { dirty = false; cursor = 0; effects = []; const target = component === 'CalculatorForm' ? exports.CalculatorForm || exports.Calculator : exports[component]; tree = target(props); effects.forEach(effect => effect()); assert.ok(++attempts < 20, 'render should settle') } while (dirty)
    return tree!
  }
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); return render() }
  return { state, resources, exports, requests, downloads, blobs, printed, render, flush, dispose: () => cleanups.forEach(cleanup => cleanup?.()) }
}
function nodes(tree: any): Element[] {
  if (tree == null || typeof tree === 'boolean') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (typeof tree !== 'object') return []
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props))
  return [tree, ...nodes(tree.props?.children)]
}
function textOf(tree: any): string {
  if (tree == null || typeof tree === 'boolean') return ''
  if (Array.isArray(tree)) return tree.map(textOf).join(' ')
  if (typeof tree !== 'object') return String(tree)
  if (typeof tree.type === 'function') return textOf(tree.type(tree.props))
  return textOf(tree.props?.children)
}
const button = (tree: any, text: RegExp) => { const value = nodes(tree).find(node => node.type === 'button' && text.test(textOf(node))); assert.ok(value, `button ${text} exists`); return value }
const selectProduct = (tree: any) => { const value = nodes(tree).find(node => node.type === 'select' && nodes(node).some(child => child.type === 'option' && typeof child.props.value === 'number')); assert.ok(value, 'product selector exists'); return value }
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

test('calculator searches client names and trims search whitespace', () => {
  const h = harness('calculator', 'CalculatorForm'); let tree = h.render()
  nodes(tree).find(node => node.type === 'input' && node.props.type === 'search')!.props.onChange({ target: { value: '  beta  ' } })
  tree = h.render(); const options = nodes(tree).filter(node => node.type === 'option' && typeof node.props.value === 'number')
  assert.deepEqual(options.map(node => node.props.value), [2]); h.dispose()
})

test('quick quantity controls add 500/1000/5000 and reject overflow', () => {
  const h = harness('calculator', 'CalculatorForm'); let tree = h.render()
  const quantity = () => nodes(tree).find(node => node.type === 'input' && node.props.type === 'number')!
  quantity().props.onChange({ target: { value: '' } }); tree = h.render()
  for (const [label, wanted] of [[/\+\s*500$/, '500'], [/\+\s*1[.,]?000$/, '1500'], [/\+\s*5[.,]?000$/, '6500']] as const) { button(tree, label).props.onClick(); tree = h.render(); assert.equal(quantity().props.value, wanted) }
  quantity().props.onChange({ target: { value: String(Number.MAX_SAFE_INTEGER) } }); tree = h.render()
  assert.equal(button(tree, /\+\s*500$/).props.disabled, true); h.dispose()
})

test('URL prefill selects an explicit id and quantity without calculating or choosing an ambiguous code', () => {
  const h = harness('calculator', 'CalculatorForm'); h.state.search = '?producto_id=2&cantidad=250'; let tree = h.render()
  assert.equal(String(selectProduct(tree).props.value), '2')
  assert.equal(nodes(tree).find(node => node.type === 'input' && node.props.type === 'number')!.props.value, '250')
  assert.equal(h.requests.length, 0); h.dispose()
  const ambiguous = harness('calculator', 'CalculatorForm'); ambiguous.state.search = '?codigo=DUP'; tree = ambiguous.render()
  assert.equal(selectProduct(tree).props.value, ''); assert.match(textOf(tree), /varios|compartido|coinciden/i); ambiguous.dispose()
})

test('material availability preserves fractional stock and never labels unknown stock sufficient', () => {
  const h = harness('calculator', 'MaterialAvailability')
  const content = textOf(h.render({ materials: [material, { ...material, clave: 'unknown', stock_actual_rollos: null, suficiente_stock: null }] }))
  assert.match(content, /0,25/); assert.match(content, /Insuficiente/); assert.match(content, /Desconocid/); h.dispose()
})

test('successful report filters are normalized and late/failed queries cannot replace their snapshot', async () => {
  const h = harness('reports', 'useReportQuery')
  const pending: ((value: Response) => void)[] = []
  h.state.responder = () => new Promise(resolve => pending.push(resolve))
  let report: any = h.render('reportes/pedidos'); pending.shift()!(json([order(1)])); await h.flush(); report = h.render('reportes/pedidos')
  const old = report.query({ ...filters, cliente: 'OLD' }); const fresh = report.query({ ...filters, cliente: '  Beta  ' })
  pending[1](json([order(2)])); await fresh; report = h.render('reportes/pedidos')
  assert.equal(report.snapshot.filters.cliente, 'Beta')
  pending[0](json([order(3)])); await old; report = h.render('reportes/pedidos'); assert.equal(report.snapshot.data[0].id, 2)
  const failed = report.query({ ...filters, cliente: 'FAILED' }); pending[2](json({ error: 'Fallo controlado' }, 500)); await failed; report = h.render('reportes/pedidos')
  assert.equal(report.snapshot.data[0].id, 2); assert.equal(report.snapshot.filters.cliente, 'Beta'); assert.match(report.error, /Fallo controlado/); h.dispose()
})

test('stock CSV escapes formulas, quotes and newlines, includes units and queried dates', async () => {
  const h = harness('reports', 'StockReport')
  h.exports.exportStockCSV({ data: [{ sku: '=SUM(1)', material: 'Papel "A"\nLargo', total_entradas: 2, total_salidas: 1, stock_resultante: 0.25, unidad_medida: 'rollos' }], filters: { ...filters, desde: '2026-10-01' }, queriedAt: '2026-10-27T10:00:00-05:00' })
  assert.equal(h.downloads[0].download, 'reporte_stock.csv')
  const csv = await h.blobs.get(h.downloads[0].href)!.text()
  assert.match(csv, /"'=SUM\(1\)"/); assert.match(csv, /"Papel ""A""\nLargo"/); assert.match(csv, /rollos/); assert.match(csv, /2026-10-01/); h.dispose()
})

test('orders PDF uses the last successful query even with an edited draft', async () => {
  const h = harness('reports', 'OrdersReport'); h.state.responder = async path => path.endsWith('/pdf') ? new Response('pdf') : json([order(1)])
  h.render(); let tree = await h.flush()
  const client = nodes(tree).find(node => node.type === 'input' && node.props.type === 'search')!
  client.props.onChange({ target: { value: 'Unapplied customer' } }); tree = h.render()
  button(tree, /^Descargar PDF$/).props.onClick(); await h.flush()
  assert.deepEqual(JSON.parse(h.requests.find(request => request.path.endsWith('/pdf'))!.init.body as string), filters); h.dispose()
})

test('individual calculation and PDF use server results and the exact revision', async () => {
  const h = harness('calculator', 'CalculatorForm'); h.state.responder = async path => path.endsWith('/pdf') ? new Response('pdf') : json(individual)
  let tree = h.render(); selectProduct(tree).props.onChange({ target: { value: '1' } }); tree = h.render()
  nodes(tree).find(node => node.type === 'input' && node.props.type === 'number')!.props.onChange({ target: { value: '100' } }); tree = h.render()
  nodes(tree).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} }); tree = await h.flush()
  assert.match(textOf(tree), /1\/3/)
  button(tree, /Descargar PDF de consumo/).props.onClick(); await h.flush()
  assert.deepEqual(JSON.parse(h.requests[1].init.body as string), { producto_id: 1, cantidad: 100, revision_calculo: 'rev-individual' })
  h.state.responder = async () => json({ error: 'Cambió el catálogo' }, 409)
  tree = h.render(); button(tree, /Descargar PDF de consumo/).props.onClick(); tree = await h.flush()
  assert.equal(nodes(tree).some(node => node.type === 'button' && /Descargar PDF de consumo/.test(textOf(node))), false); h.dispose()
})

test('MRP keeps hidden selections, excludes nonqueued orders and exports the calculated revision', async () => {
  const h = harness('reports', 'BatchMRP'); h.state.responder = async path => path.endsWith('/pdf') ? new Response('pdf') : json(batch)
  let tree = h.render()
  assert.equal(nodes(tree).filter(node => node.type === 'input' && node.props.type === 'checkbox' && /Seleccionar pedido /.test(node.props['aria-label'] || '')).length, 2)
  nodes(tree).find(node => node.type === 'input' && /Seleccionar pedido 1 /.test(node.props['aria-label'] || ''))!.props.onChange(); tree = h.render()
  nodes(tree).find(node => node.type === 'input' && node.props.type === 'search')!.props.onChange({ target: { value: 'OC-2' } }); tree = h.render()
  button(tree, /Calcular MRP/).props.onClick(); tree = await h.flush()
  assert.deepEqual(JSON.parse(h.requests[0].init.body as string), { pedidos_ids: [1] })
  button(tree, /Descargar PDF del lote/).props.onClick(); await h.flush()
  assert.deepEqual(JSON.parse(h.requests[1].init.body as string), { pedidos_ids: [1], revision_calculo: 'rev-lote' }); h.dispose()
})

test('MRP validation exposes missing product fields and selection change clears the error', async () => {
  const h = harness('reports', 'BatchMRP'); h.state.responder = async () => json({ error: 'Completa los datos', datos_faltantes: [{ cliente: 'Acme', codigo: 'DUP', descripcion: 'Etiqueta A', campos: ['ancho_rollo'] }] }, 400)
  let tree = h.render(); nodes(tree).find(node => node.type === 'input' && /Seleccionar pedido 1 /.test(node.props['aria-label'] || ''))!.props.onChange(); tree = h.render()
  button(tree, /Calcular MRP/).props.onClick(); tree = await h.flush(); assert.match(textOf(tree), /ancho_rollo/)
  button(tree, /Limpiar selección/).props.onClick(); tree = h.render(); assert.doesNotMatch(textOf(tree), /ancho_rollo/); h.dispose()
})

test('permission gates render no report or calculator controls', () => {
  for (const [file, component] of [['calculator', 'Calculator'], ['reports', 'Reports']] as const) { const h = harness(file, component); h.state.allowed = false; const tree = h.render(); assert.match(textOf(tree), /No tienes permiso/); assert.equal(nodes(tree).filter(node => node.type === 'form').length, 0); assert.equal(h.requests.length, 0); h.dispose() }
})


test('stock print escapes report data and filters, preserves units and reports blocked windows', () => {
  const h = harness('reports', 'StockReport')
  const snapshot = { data: [{ sku: '<img src=x onerror=alert(1)>', material: '<script>evil()</script>', total_entradas: 0.0000001, total_salidas: 0, stock_resultante: 0.25, unidad_medida: 'ml' }], filters: { ...filters, cliente: '<script>filter()</script>' }, queriedAt: '2026-10-27T10:00:00-05:00' }
  h.exports.printStock(snapshot)
  assert.match(h.printed[0], /&lt;script&gt;evil/); assert.match(h.printed[0], /&lt;img/); assert.match(h.printed[0], /<td>ml<\/td>/); assert.doesNotMatch(h.printed[0], /<script>/)
  h.state.popupBlocked = true
  assert.throws(() => h.exports.printStock(snapshot), /bloqueó/); h.dispose()
})

test('Excel export is unfiltered while missing units stay explicit in stock CSV', async () => {
  const h = harness('reports', 'StockReport'); h.state.responder = async path => path.includes('excel') ? new Response('xlsx') : json([])
  h.render(); let tree = await h.flush()
  nodes(tree).find(node => node.type === 'input' && node.props.type === 'date')!.props.onChange({ target: { value: '2026-10-01' } }); tree = h.render()
  button(tree, /Inventario completo/).props.onClick(); await h.flush()
  assert.equal(h.requests.at(-1)!.path, '/api/exportar/excel'); assert.equal(h.downloads[0].download, 'inventario_sgp.xlsx')
  h.exports.exportStockCSV({ data: [{ sku: 'S', material: 'M', total_entradas: 0, total_salidas: 1, stock_resultante: 0 }], filters, queriedAt: '2026-10-27' })
  assert.match(await h.blobs.get(h.downloads.at(-1)!.href)!.text(), /Sin unidad informada/); h.dispose()
})

test('applied dates/client/state reach GET and PDF together while a later draft stays unapplied', async () => {
  const h = harness('reports', 'OrdersReport'); h.state.responder = async path => path.endsWith('/pdf') ? new Response('pdf') : json([order(1)])
  h.render(); let tree = await h.flush()
  const set = (type: string, value: string, index = 0) => { nodes(tree).filter(node => node.type === 'input' && node.props.type === type)[index].props.onChange({ target: { value } }); tree = h.render() }
  set('date', '2026-10-01'); set('date', '2026-10-27', 1); set('search', '  Acme  ')
  nodes(tree).find(node => node.type === 'select')!.props.onChange({ target: { value: 'Entregado' } }); tree = h.render()
  nodes(tree).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} }); tree = await h.flush()
  const queried = new URL(h.requests.at(-1)!.path, 'http://test')
  assert.equal(queried.searchParams.get('desde'), '2026-10-01'); assert.equal(queried.searchParams.get('hasta'), '2026-10-27'); assert.equal(queried.searchParams.get('cliente'), 'Acme'); assert.equal(queried.searchParams.get('estado'), 'Entregado')
  set('search', 'Beta'); button(tree, /^Descargar PDF$/).props.onClick(); await h.flush()
  assert.deepEqual(JSON.parse(h.requests.at(-1)!.init.body as string), { desde: '2026-10-01', hasta: '2026-10-27', cliente: 'Acme', estado: 'Entregado' }); h.dispose()
})

test('inverted report dates block querying and invalid quantities block both calculate and increments', () => {
  const report = harness('reports', 'ReportFilters'); let submitted = false
  let tree = report.render({ value: { ...filters, desde: '2026-10-28', hasta: '2026-10-27' }, onChange() {}, onSubmit() { submitted = true }, busy: false })
  nodes(tree).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} }); assert.equal(submitted, false); assert.equal(button(tree, /^Consultar$/).props.disabled, true); report.dispose()
  const h = harness('calculator', 'CalculatorForm'); tree = h.render(); selectProduct(tree).props.onChange({ target: { value: '1' } }); tree = h.render()
  for (const value of ['-1', '1.5', '9007199254740992']) { nodes(tree).find(node => node.type === 'input' && node.props.type === 'number')!.props.onChange({ target: { value } }); tree = h.render(); assert.equal(button(tree, /Calcular consumo/).props.disabled, true); assert.equal(button(tree, /\+\s*500$/).props.disabled, true) }
  assert.equal(h.requests.length, 0); h.dispose()
})

test('prefill disambiguates a shared code with client and refuses unknown product ids', () => {
  const h = harness('calculator', 'CalculatorForm'); h.state.search = '?codigo=dup&cliente=beta'; let tree = h.render(); assert.equal(String(selectProduct(tree).props.value), '2'); h.dispose()
  const missing = harness('calculator', 'CalculatorForm'); missing.state.search = '?producto_id=999'; tree = missing.render(); assert.equal(selectProduct(tree).props.value, ''); assert.match(textOf(tree), /no está en el catálogo/); assert.equal(missing.requests.length, 0); missing.dispose()
})

test('catalog changes and unmount discard an in-flight individual response', async () => {
  for (const change of ['catalog', 'unmount']) {
    const h = harness('calculator', 'CalculatorForm'); let complete!: (value: Response) => void
    h.state.responder = () => new Promise(resolve => { complete = resolve })
    let tree = h.render(); selectProduct(tree).props.onChange({ target: { value: '1' } }); tree = h.render()
    nodes(tree).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} })
    if (change === 'catalog') { h.resources.catalogo.data = [{ ...products[0], cant_etiquetas_plancha: 30 }, products[1]]; h.render() } else h.dispose()
    complete(json(individual)); tree = await h.flush()
    assert.equal(nodes(tree).some(node => node.type === 'button' && /Descargar PDF de consumo/.test(textOf(node))), false); h.dispose()
  }
})

test('MRP refuses a selected order that has left the queue and discards an old calculation', async () => {
  const h = harness('reports', 'BatchMRP'); let complete!: (value: Response) => void; h.state.responder = () => new Promise(resolve => { complete = resolve })
  let tree = h.render(); nodes(tree).find(node => node.type === 'input' && /Seleccionar pedido 1 /.test(node.props['aria-label'] || ''))!.props.onChange(); tree = h.render()
  button(tree, /Calcular MRP/).props.onClick()
  h.resources.pedidos.data = [order(1, 'Procesando'), order(2)]; tree = h.render(); complete(json(batch)); tree = await h.flush()
  assert.equal(button(tree, /Calcular MRP/).props.disabled, true); assert.equal(button(tree, /Descargar PDF del lote/).props.disabled, true); assert.match(textOf(tree), /ya no están disponibles/); h.dispose()
})

test('MRP PDF conflict removes the old result and surfaces missing data', async () => {
  const h = harness('reports', 'BatchMRP'); h.state.responder = async path => path.endsWith('/pdf') ? json({ error: 'Recalcula', datos_faltantes: [{ codigo: 'DUP', campos: ['largo_rollo'] }] }, 409) : json(batch)
  let tree = h.render(); nodes(tree).find(node => node.type === 'input' && /Seleccionar pedido 1 /.test(node.props['aria-label'] || ''))!.props.onChange(); tree = h.render(); button(tree, /Calcular MRP/).props.onClick(); tree = await h.flush()
  button(tree, /Descargar PDF del lote/).props.onClick(); tree = await h.flush(); assert.equal(button(tree, /Descargar PDF del lote/).props.disabled, true); assert.match(textOf(tree), /largo_rollo/); h.dispose()
})

test('tiny positive consumption remains visible, null is missing and zero is valid', () => {
  const h = harness('calculator', 'CalculatorForm')
  assert.notEqual(h.exports.consumptionNumber(1e-10), '0'); assert.equal(h.exports.consumptionNumber(null), 'Sin dato'); assert.equal(h.exports.consumptionNumber(0), '0'); h.dispose()
})

test('batch product links prefill the individual calculator only with calculator permission', () => {
  const h = harness('reports', 'MRPOutput'); let tree = h.render({ result: batch })
  const link = nodes(tree).find(node => node.type === 'a' && String(node.props.href).startsWith('/calculadora?'))
  assert.ok(link, 'an individual calculator link is available for the grouped product')
  const query = new URL(link.props.href, 'http://test').searchParams
  assert.equal(query.get('producto_id'), '1'); assert.equal(query.get('cantidad'), '100')
  h.state.allowed = false; tree = h.render({ result: batch })
  assert.equal(nodes(tree).some(node => node.type === 'a' && String(node.props.href).startsWith('/calculadora?')), false); h.dispose()
})
