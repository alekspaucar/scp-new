import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'

// Run the real component handlers without a browser, HTTP server, or database.
// Only the session/resource boundary and React's hook scheduler are controlled.
const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = fileURLToPath(new URL('..', import.meta.url))
const product = { id: 1, codigo: 'ABC', cliente: 'CLIENTE', descripcion: 'PRODUCTO DEL CATÁLOGO', imagen_url: '/uploads/catalogo/ref.png', tipo_codigo: 'especial' }
const item = (overrides = {}) => ({ id: 7, codigo: 'ABC', descripcion: 'PRODUCTO DEL CATÁLOGO', cantidad: 100, estado_item: 'pendiente', fecha_estado: '27/10/2026 09:00', observacion: null, modo_entregas_parciales: false, cantidad_entregada_total: 0, entregas: [], faltantes: [], ...overrides })
const order = (overrides = {}) => ({ id: 11, revision: 4, cliente: 'CLIENTE', orden_compra: 'OC-11', fecha_entrega: '2026-10-28T12:00', fecha_emision: '27/10/2026 09:00', estado: 'Procesando', total_items: 1, total_unidades: 100, progreso: 0, items: [item()], ...overrides })

function environment(resources = {}) {
  let active, confirmations = [], calls = [], reads = [], confirm = async () => true
  const browser = { location: { search: '' }, localStorage: { getItem: () => null, setItem() {} }, setInterval: () => 1 }
  const modules = new Map()
  const session = { user: { rol: 'jefe' }, can: () => true }
  const hook = initial => { const index = active.index++; if (!(index in active.slots)) active.slots[index] = typeof initial === 'function' ? initial() : initial; return index }
  const react = {
    ...require('react'),
    useState: initial => { const owner = active, index = hook(initial); return [owner.slots[index], value => { owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value }] },
    useRef: initial => { const index = hook(() => ({ current: initial })); return active.slots[index] },
    useId: () => { const index = hook(() => `audit-${active.index}`); return active.slots[index] },
    useEffect: (callback, dependencies = []) => { const index = hook(() => ({ dependencies: undefined })), previous = active.slots[index]; if (!previous.dependencies || previous.dependencies.some((value, i) => value !== dependencies[i])) { previous.dependencies = dependencies; active.effects.push(callback) } },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status } }
  const boundary = {
    useResource: (path, interval) => { reads.push({ path, interval }); return { data: path ? resources[path] ?? null : null, loading: false, error: '', reload: async () => {} } },
    api: async (path, init) => { calls.push({ path, init }); if (resources[path] instanceof Error) throw resources[path]; return resources[path] ?? {} },
    upload: async (path, file) => { calls.push({ path, file }); if (resources[path] instanceof Error) throw resources[path]; return resources[path] ?? {} },
    download: async () => {}, ApiError,
    jsonRequest: (method, body) => ({ method, body: JSON.stringify(body) }),
  }
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    const module = { exports: {} }; modules.set(path, module)
    const source = readFileSync(path, 'utf8')
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    function localRequire(name) {
      if (name.endsWith('.css')) return {}
      if (name === 'react') return react
      if (name === '@/lib/api') return boundary
      if (name === '@/components/session-provider') return { useSession: () => session }
      if (name === '@/lib/confirm') return { confirmAction: async message => { confirmations.push(message); return confirm(message) } }
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/') ? join(root, name.slice(2)) : resolve(dirname(path), name)
        const target = [base, `${base}.tsx`, `${base}.ts`].find(p => existsSync(p))
        return load(target)
      }
      return require(name)
    }
    vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { console, crypto: globalThis.crypto, URL, URLSearchParams, Number, Date, Intl, Set, Map, AbortSignal, window: browser }, { filename: path })(localRequire, module, module.exports)
    return module.exports
  }
  function mount(Component, props = {}) {
    const instance = { slots: [], index: 0, tree: null, props, effects: [] }
    instance.render = (next = instance.props) => { instance.props = next; instance.index = 0; active = instance; instance.tree = Component(next); active = null; return instance.tree }
    instance.flushEffects = () => { const pending = instance.effects.splice(0); pending.forEach(effect => effect()) }
    instance.render()
    return instance
  }
  return { load: name => load(join(root, 'components/orders', name)), mount, resources, session, calls, confirmations, reads, ApiError, browser, setConfirm: fn => { confirm = fn } }
}

function nodes(node, predicate, found = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, found))
  else if (node && typeof node === 'object' && node.props) { if (predicate(node)) found.push(node); nodes(node.props.children, predicate, found) }
  return found
}
const textOf = node => Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
const button = (tree, name) => nodes(tree, n => n.type?.name === 'Button' && textOf(n) === name)[0]
const label = (tree, name) => nodes(tree, n => n.type === 'label' && textOf(n).startsWith(name))[0]
const input = (tree, name) => nodes(label(tree, name), n => n.type === 'input')[0]
const change = (node, value) => node.props.onChange({ target: { value } })
const submit = tree => nodes(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} })

test('document import is offered only on creation, matching the original visible form', () => {
  const env = environment({ catalogo: [product], clientes: [] })
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { order: order(), onClose() {}, onSaved() {} })
  assert.equal(button(view.tree, 'Importar documento'), undefined)
  const create = env.mount(env.load('order-editor.tsx').OrderEditor, { onClose() {}, onSaved() {} })
  assert.ok(button(create.tree, 'Importar documento'))
})

test('a selected unread document cannot be silently skipped by review', () => {
  const env = environment({ catalogo: [product], clientes: [] })
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { onClose() {}, onSaved() {} })
  change(input(view.tree, 'Cliente'), 'CLIENTE'); view.render()
  change(input(view.tree, 'Fecha y hora'), '2026-10-28T12:00'); view.render()
  change(input(view.tree, 'Descripción'), 'TRABAJO'); view.render()
  nodes(view.tree, n => n.type === 'input' && n.props.type === 'file')[0].props.onChange({ target: { files: [{ name: 'pedido.pdf' }] } }); view.render()
  submit(view.tree); view.render()
  assert.equal(button(view.tree, 'Confirmar y guardar'), undefined)
  assert.match(textOf(view.tree), /documento pendiente|documento seleccionado/i)
})

test('scanning a catalog code does not add its quantity to an unrelated description', () => {
  const env = environment({ catalogo: [product], clientes: [] })
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { order: order({ items: [item({ descripcion: 'OTRO TRABAJO' })] }), onClose() {}, onSaved() {} })
  button(view.tree, 'Escáner').props.onClick(); view.render()
  change(nodes(view.tree, n => n.props['aria-label'] === 'Código para escanear')[0], 'ABC'); view.render()
  button(view.tree, 'Agregar escaneo').props.onClick(); view.render()
  const quantities = nodes(view.tree, n => n.type === 'input' && n.props.type === 'number' && n.props.required)
  assert.deepEqual(quantities.map(n => n.props.value), [100, 1])
})

test('scanner requires a client before adding an item', () => {
  const env = environment({ catalogo: [product], clientes: [] })
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { onClose() {}, onSaved() {} })
  button(view.tree, 'Escáner').props.onClick(); view.render()
  change(nodes(view.tree, n => n.props['aria-label'] === 'Código para escanear')[0], 'ABC'); view.render()
  button(view.tree, 'Agregar escaneo').props.onClick(); view.render()
  assert.match(textOf(view.tree), /cliente primero|selecciona un cliente/i)
  assert.equal(nodes(view.tree, n => n.props['aria-label'] === 'Código del ítem 1')[0].props.value, '')
})

test('suspension reference retains its timestamp even without deliveries or shortages', () => {
  const current = order({ items: [item({ estado_item: 'suspendido', observacion: 'FALTA MATERIAL' })] })
  const env = environment({ 'pedidos/11': current, catalogo: [product] })
  const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  assert.match(textOf(view.tree), /Último cambio de estado/)
  assert.match(textOf(view.tree), /FALTA MATERIAL/)
})

test('invoice authorization opened at Terminado closes if live order state changes', () => {
  const env = environment({ 'pedidos/11': order({ estado: 'Terminado' }) })
  const view = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  button(view.tree, 'Facturar / autorizar').props.onClick(); view.render()
  assert.equal(nodes(view.tree, n => n.type?.name === 'InvoiceForm').length, 1)
  env.resources['pedidos/11'] = order({ estado: 'Entregado' }); view.render()
  assert.equal(nodes(view.tree, n => n.type?.name === 'InvoiceForm').length, 0)
})

test('order search finds item codes and shows their order', () => {
  const env = environment({ pedidos: [order()] })
  const view = env.mount(env.load('order-list.tsx').OrderList)
  change(input(view.tree, 'Buscar'), 'ABC'); view.render()
  assert.equal(nodes(view.tree, n => n.type === 'tr' && n.props['data-order-state']).length, 1)
})

test('order list limits the visible page without losing the result count', () => {
  const env = environment({ pedidos: Array.from({ length: 26 }, (_, index) => order({ id: index + 1 })) })
  const view = env.mount(env.load('order-list.tsx').OrderList)
  assert.equal(nodes(view.tree, n => n.type === 'tr' && n.props['data-order-state']).length, 25)
  assert.match(textOf(view.tree), /26 resultados/)
  assert.ok(button(view.tree, 'Siguiente'))
})

test('production queue and ready details expose no item controls', () => {
  for (const estado of ['En Cola', 'Terminado', 'Facturado', 'Retiro en Fábrica', 'Entregado']) {
    const env = environment({ 'pedidos/11': order({ estado }) })
    const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, production: true, inline: true, onClose() {} })
    const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
    const view = env.mount(entry.type, entry.props)
    assert.equal(button(view.tree, 'Estado'), undefined, estado)
    assert.equal(button(view.tree, 'Entrega'), undefined, estado)
    assert.equal(button(view.tree, 'Faltante'), undefined, estado)
    assert.equal(button(detail.tree, 'Confirmar entrega'), undefined, estado)
  }
})

test('shortage reporting defaults to sheets and permits an empty cause as the original does', async () => {
  const env = environment()
  let saved = false
  const view = env.mount(env.load('shortages.tsx').ShortageForm, { orderId: 11, item: item(), allowed: true, onClose() {}, onSaved() { saved = true } })
  const unit = nodes(label(view.tree, 'Unidad'), n => n.type === 'select')[0]
  assert.equal(unit.props.value, 'planchas')
  await submit(view.tree)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved, true)
  assert.deepEqual(JSON.parse(env.calls[0].init.body), { cantidad_faltante: 1, unidad: 'planchas', motivo: '', departamento_origen: 'Corte' })
})

test('shortage quick causes remain available without mandatory free text', () => {
  const env = environment()
  const view = env.mount(env.load('shortages.tsx').ShortageForm, { orderId: 11, item: item(), allowed: true, onClose() {}, onSaved() {} })
  assert.ok(button(view.tree, 'Descalibre'))
  button(view.tree, 'Descalibre').props.onClick(); view.render()
  assert.equal(nodes(view.tree, n => n.type === 'textarea')[0].props.value, 'Falla de registro/descalibre')
})

test('countdown keeps the original live seconds precision and detects the exact deadline', () => {
  const env = environment()
  const Card = env.load('order-board.tsx').OrderCard
  const view = env.mount(Card, { order: order(), onOpen() {}, now: Date.parse('2026-10-28T16:59:58Z') })
  assert.ok(nodes(view.tree, n => n.type?.name === 'Status' && /2\s*s/.test(n.props.value)).length)
  view.render({ ...view.props, now: Date.parse('2026-10-28T17:00:00Z') })
  assert.ok(nodes(view.tree, n => n.type?.name === 'Status' && n.props.value === 'Retrasado').length)
})

test('a reference image in the existing catalog is accessible from an order item', () => {
  const env = environment({ 'pedidos/11': order(), catalogo: [product] })
  const view = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(view.tree, n => n.type?.name === 'ItemDetail')[0]
  const detail = env.mount(entry.type, entry.props)
  const reference = nodes(detail.tree, n => n.type?.name === 'ProductReference')[0]
  assert.ok(reference, 'The catalog reference should be available alongside the work item')
  const content = env.mount(reference.type, reference.props)
  assert.equal(nodes(content.tree, n => n.type === 'img')[0].props.src, '/uploads/catalogo/ref.png')
})

test('catalog reference lookup separates clients, no-code descriptions and ambiguous matches', () => {
  const env = environment()
  const { productForItem, ProductReference } = env.load('order-reference.tsx')
  const variants = [{ ...product, id: 2, cliente: 'OTRO' }, product, { ...product, id: 3, codigo: '-', descripcion: 'SIN CÓDIGO A' }, { ...product, id: 4, codigo: '-', descripcion: 'SIN CÓDIGO B' }]
  assert.equal(productForItem(variants, ' cliente ', item()).id, 1)
  assert.equal(productForItem(variants, 'CLIENTE', item({ codigo: 'S/C', descripcion: 'SIN CÓDIGO B' })).id, 4)
  assert.equal(productForItem([product, { ...product, id: 5 }], 'CLIENTE', item()), undefined)
  assert.equal(productForItem(variants, '', item()), undefined)
  const pdf = env.mount(ProductReference, { product: { ...product, imagen_url: '/uploads/catalogo/ref.pdf' } })
  assert.equal(nodes(pdf.tree, n => n.type === 'img').length, 0)
  assert.equal(nodes(pdf.tree, n => n.type === 'a')[0].props.href, '/uploads/catalogo/ref.pdf')
})

test('no-code reference descriptions match the server exact case while client and code ignore case', () => {
  const env = environment()
  const { productForItem } = env.load('order-reference.tsx')
  const noCode = { ...product, id: 2, codigo: '-', descripcion: 'ETIQUETA' }
  assert.equal(productForItem([noCode], ' cliente ', item({ codigo: '-', descripcion: 'etiqueta' })), undefined)
  assert.equal(productForItem([noCode], ' cliente ', item({ codigo: '-', descripcion: ' ETIQUETA ' })).id, 2)
  assert.equal(productForItem([noCode], 'CLIENTE', item({ codigo: 's/c', descripcion: 'etiqueta' })), undefined)
  assert.equal(productForItem([product], ' cliente ', item({ codigo: 'abc' })).id, 1)
})

test('the monitor preserves the clock color option and its five second data refresh', () => {
  const env = environment({ 'pedidos/monitor-tv': { activos: 0, en_riesgo: 0, para_hoy: 0, completados_hoy: 0, pedidos: [] } })
  const view = env.mount(env.load('monitor.tsx').Monitor)
  assert.ok(nodes(view.tree, n => n.type === 'input' && n.props.type === 'color')[0], 'Monitor clock color customization was present in the original')
  assert.ok(nodes(view.tree, n => n.type === 'time')[0])
  assert.ok(env.reads.some(read => read.path === 'pedidos/monitor-tv' && read.interval === 5000))
})

test('document drag and drop prepares a pending file without saving the order', () => {
  const env = environment({ catalogo: [], clientes: [] })
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { onClose() {}, onSaved() {} })
  const dropzone = nodes(view.tree, n => typeof n.props.onDrop === 'function')[0]
  assert.ok(dropzone, 'Original document uploader accepts drag and drop')
  dropzone.props.onDrop({ preventDefault() {}, dataTransfer: { files: [{ name: 'orden.pdf' }] } }); view.render()
  assert.match(textOf(view.tree), /Documento pendiente: orden.pdf/)
  assert.equal(env.calls.length, 0)
})

test('scanner cancellation clears a pending code and its quantity without adding an item', () => {
  const env = environment({ catalogo: [product], clientes: [] })
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { order: order(), onClose() {}, onSaved() {} })
  button(view.tree, 'Escáner').props.onClick(); view.render()
  change(nodes(view.tree, n => n.props['aria-label'] === 'Código para escanear')[0], 'ABC'); view.render()
  assert.ok(button(view.tree, 'Cancelar escaneo'))
  button(view.tree, 'Cancelar escaneo').props.onClick(); view.render()
  assert.equal(nodes(view.tree, n => n.props['aria-label'] === 'Código para escanear')[0].props.value, '')
  assert.equal(nodes(view.tree, n => n.type === 'input' && n.props.required && n.props.type === 'number')[0].props.value, 100)
})

test('order rows retain the original progress indication', () => {
  const env = environment({ pedidos: [order({ progreso: 25 })] })
  const view = env.mount(env.load('order-list.tsx').OrderList)
  const row = nodes(view.tree, n => n.type === 'tr' && n.props['data-order-state'])[0]
  const progress = nodes(row, n => n.type === 'progress')[0]
  assert.ok(progress)
  assert.equal(progress.props.value, 25)
})

test('editing preserves duplicate item IDs and the revision read when the draft opened', async () => {
  const current = order({ items: [item(), item({ id: 8, descripcion: 'SEGUNDO TRABAJO' })] })
  const env = environment({ catalogo: [product], clientes: [], 'pedidos/11': current })
  let saved = false
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { order: current, onClose() {}, onSaved() { saved = true } })
  submit(view.tree); view.render()
  button(view.tree, 'Confirmar y guardar').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved, true)
  const body = JSON.parse(env.calls[0].init.body)
  assert.equal(body.revision, 4)
  assert.deepEqual(body.items.map(i => i.id), [7, 8])
  assert.deepEqual(body.items.map(i => i.cantidad), [100, 100])
})

test('a revision conflict retains the draft and blocks resubmission with a newer revision', async () => {
  const env = environment({ catalogo: [product], clientes: [] })
  env.resources['pedidos/11'] = new env.ApiError('El pedido cambió', 409)
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { order: order(), onClose() {}, onSaved() {} })
  submit(view.tree); view.render()
  button(view.tree, 'Confirmar y guardar').props.onClick()
  await new Promise(resolve => setImmediate(resolve)); view.render()
  assert.equal(button(view.tree, 'Reintentar guardar').props.disabled, true)
  assert.match(textOf(view.tree), /Tus cambios se conservaron/)
  assert.equal(JSON.parse(env.calls[0].init.body).revision, 4)
})

test('partial history remains readable in a ready production detail while its controls stay hidden', () => {
  const current = order({ estado: 'Terminado', items: [item({ estado_item: 'entregado_parcial', modo_entregas_parciales: false, cantidad_entregada_total: 20, entregas: [{ id: 3, cantidad_entregada: 20, fecha: '27/10/2026 10:30', observacion: 'SALIDA 1' }] })] })
  const env = environment({ 'pedidos/11': current })
  const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, production: true, inline: true, onClose() {} })
  const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  assert.match(textOf(view.tree), /SALIDA 1/)
  assert.match(textOf(view.tree), /20 entregadas/)
  assert.equal(button(view.tree, 'Eliminar entrega'), undefined)
})

test('factory pickup still confirms the exact Entregado transition with the shared order lock', async () => {
  const env = environment({ 'pedidos/11': order({ estado: 'Retiro en Fábrica' }) })
  const view = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  button(view.tree, 'Confirmar entrega').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.calls[0].path, 'pedidos/11/estado')
  assert.deepEqual(JSON.parse(env.calls[0].init.body), { estado: 'Entregado' })
  assert.equal(env.confirmations.length, 1)
})

test('the shared lock prevents a second action until the first finishes', async () => {
  const env = environment()
  const first = env.load('order-action.tsx').useOrderAction()
  const second = env.load('order-action.tsx').useOrderAction()
  let finish, secondCalled = false
  const running = first.run(() => new Promise(resolve => { finish = resolve }))
  assert.equal(second.isBusy(), true)
  await second.run(async () => { secondCalled = true })
  assert.equal(secondCalled, false)
  finish('saved'); await running
  assert.equal(second.isBusy(), false)
})

test('monitor urgency has its original one-day warning threshold', () => {
  const env = environment()
  const Card = env.load('order-board.tsx').OrderCard
  const view = env.mount(Card, { order: order(), onOpen() {}, monitor: true, now: Date.parse('2026-10-26T17:00:00Z') })
  const deadline = nodes(view.tree, n => n.type?.name === 'Status' && n.props.value !== 'Procesando')[0]
  assert.equal(deadline.props.tone, 'green', 'Two days remaining is green on the TV monitor')
})

test('changing a filter on the last page immediately returns to the matching first page', () => {
  const env = environment({ pedidos: Array.from({ length: 26 }, (_, index) => order({ id: index + 1, cliente: index ? 'OTRO' : 'CLIENTE' })) })
  const view = env.mount(env.load('order-list.tsx').OrderList)
  button(view.tree, 'Siguiente').props.onClick(); view.render()
  assert.equal(nodes(view.tree, n => n.type === 'tr' && n.props['data-order-state']).length, 1)
  change(input(view.tree, 'Buscar'), 'CLIENTE'); view.render()
  const row = nodes(view.tree, n => n.type === 'tr' && n.props['data-order-state'])[0]
  assert.match(textOf(row), /#1OC-11CLIENTE/)
})

test('the original edit URL opens a fresh authorized order draft only once', async () => {
  const env = environment({ pedidos: [order()], 'pedidos/11': order() })
  env.browser.location.search = '?editar=11'
  const view = env.mount(env.load('order-list.tsx').OrderList)
  view.flushEffects(); await new Promise(resolve => setImmediate(resolve)); view.render()
  const editor = nodes(view.tree, n => n.type?.name === 'OrderEditor')[0]
  assert.ok(editor)
  assert.equal(editor.props.order.revision, 4)
  editor.props.onClose(); view.render(); view.flushEffects(); view.render()
  assert.equal(nodes(view.tree, n => n.type?.name === 'OrderEditor').length, 0)
})

test('the original new-order URL opens the creation form for an editor', () => {
  const env = environment({ pedidos: [] })
  env.browser.location.search = '?nuevo=1'
  const view = env.mount(env.load('order-list.tsx').OrderList)
  view.flushEffects(); view.render()
  assert.equal(nodes(view.tree, n => n.type?.name === 'OrderEditor').length, 1)
})

test('order deletion stops if edit permission is revoked during confirmation', async () => {
  const env = environment({ pedidos: [order()] })
  let answer
  env.setConfirm(() => new Promise(resolve => { answer = resolve }))
  const view = env.mount(env.load('order-list.tsx').OrderList)
  button(view.tree, 'Eliminar').props.onClick()
  env.session.can = (_module, level) => level !== 'editar'; view.render()
  answer(true); await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.calls.length, 0)
})

test('item state confirmation stops when live production state leaves Procesando', async () => {
  const env = environment({ 'pedidos/11': order() })
  let answer
  env.setConfirm(() => new Promise(resolve => { answer = resolve }))
  const parent = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(parent.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  button(view.tree, 'Estado').props.onClick(); view.render()
  change(nodes(view.tree, n => n.type === 'select')[0], 'listo'); view.render()
  submit(view.tree)
  view.render({ ...view.props, order: order({ estado: 'Terminado' }) })
  answer(true); await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.calls.length, 0)
})

test('production offers completion once after crossing 100 percent, using an inline notice', () => {
  const env = environment({ pedidos: [order({ progreso: 50 })] })
  const view = env.mount(env.load('production.tsx').Production)
  view.flushEffects(); view.render()
  assert.equal(button(view.tree, 'Terminar pedido #11'), undefined)
  env.resources.pedidos = [order({ progreso: 100 })]
  view.render(); view.flushEffects(); view.render()
  assert.ok(button(view.tree, 'Terminar pedido #11'))
  button(view.tree, 'Omitir aviso #11').props.onClick(); view.render()
  env.resources.pedidos = [order({ progreso: 100 })]
  view.render(); view.flushEffects(); view.render()
  assert.equal(button(view.tree, 'Terminar pedido #11'), undefined)
})

test('date filters use the promised Ecuador date, including legacy displayed dates', () => {
  const env = environment({ pedidos: [order({ id: 1, fecha_entrega: '27/10/2026 23:59' }), order({ id: 2, fecha_entrega: '2026-10-28T00:01' }), order({ id: 3, fecha_entrega: 'sin fecha' })] })
  const view = env.mount(env.load('order-list.tsx').OrderList)
  change(input(view.tree, 'Desde'), '2026-10-27'); view.render()
  change(input(view.tree, 'Hasta'), '2026-10-27'); view.render()
  const rows = nodes(view.tree, n => n.type === 'tr' && n.props['data-order-state'])
  assert.equal(rows.length, 1)
  assert.match(textOf(rows[0]), /#1OC-11/)
})

test('a pedidos-only reader does not request a catalog it cannot access', () => {
  const env = environment({ 'pedidos/11': order() })
  env.session.can = (module, level = 'ver') => module === 'pedidos' && level === 'ver'
  env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  assert.equal(env.reads.some(read => read.path === 'catalogo'), false)
})

test('a new client is explicitly identified before saving, while a known client is not', () => {
  const env = environment({ catalogo: [], clientes: [{ id: 1, nombre: 'CLIENTE' }] })
  const view = env.mount(env.load('order-editor.tsx').OrderEditor, { onClose() {}, onSaved() {} })
  change(input(view.tree, 'Cliente'), 'NUEVO'); view.render()
  assert.match(textOf(view.tree), /Nuevo cliente: se creará al guardar/)
  change(input(view.tree, 'Cliente'), 'cliente'); view.render()
  assert.doesNotMatch(textOf(view.tree), /Nuevo cliente: se creará al guardar/)
})

test('a pedidos-only reader sees the item DTO image and material without requesting the catalog', () => {
  const env = environment({ 'pedidos/11': order({ items: [item({ imagen_url: '/uploads/catalogo/item-reference.png', imagen_referencia: 'item-reference.png', material_sku: 'MAT-11' })] }) })
  env.session.can = (module, level = 'ver') => module === 'pedidos' && level === 'ver'
  const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  const reference = nodes(view.tree, n => n.type?.name === 'ProductReference')[0]
  const content = env.mount(reference.type, reference.props)
  const image = nodes(content.tree, n => n.type === 'img')[0]
  assert.ok(image, 'A reader must see the reference already authorized in the order response')
  assert.equal(image.props.src, '/uploads/catalogo/item-reference.png')
  assert.match(textOf(content.tree), /Material: MAT-11/)
  assert.equal(env.reads.some(read => read.path === 'catalogo'), false)
  assert.equal(button(view.tree, 'Estado'), undefined)
})

test('item DTO reference takes priority over catalog matches even for an editor', () => {
  const env = environment({ 'pedidos/11': order({ items: [item({ imagen_url: '/uploads/catalogo/current.pdf', imagen_referencia: 'current.pdf', material_sku: 'MAT-CURRENT' })] }), catalogo: [product] })
  const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  const reference = nodes(view.tree, n => n.type?.name === 'ProductReference')[0]
  const content = env.mount(reference.type, reference.props)
  assert.equal(nodes(content.tree, n => n.type === 'a')[0].props.href, '/uploads/catalogo/current.pdf')
  assert.equal(nodes(content.tree, n => n.type === 'img').length, 0)
  assert.equal(env.reads.some(read => read.path === 'catalogo'), false)
})

test('an explicitly empty item DTO reference does not fall back to a catalog image', () => {
  const env = environment({ 'pedidos/11': order({ items: [item({ imagen_url: null, imagen_referencia: null, material_sku: null })] }), catalogo: [product] })
  const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  const reference = nodes(view.tree, n => n.type?.name === 'ProductReference')[0]
  const content = env.mount(reference.type, reference.props)
  assert.equal(nodes(content.tree, n => n.type === 'img' || n.type === 'a').length, 0)
  assert.equal(env.reads.some(read => read.path === 'catalogo'), false)
})

test('the latest rollback observation is visible in modal and inline details only when present', () => {
  for (const inline of [false, true]) {
    const env = environment({ 'pedidos/11': order({ observacion_retroceso: 'Corregir el registro de impresión' }) })
    const view = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, inline, onClose() {} })
    assert.match(textOf(view.tree), /Último retroceso/)
    assert.match(textOf(view.tree), /Corregir el registro de impresión/)
    env.resources['pedidos/11'] = order({ observacion_retroceso: null }); view.render()
    assert.doesNotMatch(textOf(view.tree), /Último retroceso/)
  }
})

const processingMutations = [
  { name: 'item state', path: 'pedidos/11/items/7/estado', method: 'PUT', body: { estado: 'listo', estado_pedido_esperado: 'Procesando', revision_pedido_esperada: 4 }, prepare(view) {
    button(view.tree, 'Estado').props.onClick(); view.render()
    change(nodes(view.tree, n => n.type === 'select')[0], 'listo'); view.render()
    submit(view.tree)
  } },
  { name: 'partial mode', path: 'pedidos/11/items/7/modo-parcial', method: 'PATCH', body: { activo: true, estado_pedido_esperado: 'Procesando', revision_pedido_esperada: 4 }, prepare(view) {
    button(view.tree, 'Entrega').props.onClick(); view.render()
    button(view.tree, 'Activar parciales').props.onClick()
  } },
  { name: 'new partial delivery', path: 'pedidos/11/items/7/entregas', method: 'POST', item: { modo_entregas_parciales: true }, body: { cantidad_entregada: 12, observacion: '', estado_pedido_esperado: 'Procesando', revision_pedido_esperada: 4 }, prepare(view) {
    button(view.tree, 'Entrega').props.onClick(); view.render()
    change(input(view.tree, 'Cantidad de salida'), 12); view.render()
    submit(view.tree)
  } },
  { name: 'partial delivery deletion', path: 'pedidos/11/items/7/entregas/3', method: 'DELETE', item: { cantidad_entregada_total: 20, entregas: [{ id: 3, cantidad_entregada: 20, fecha: '27/10/2026 10:30' }] }, body: { estado_pedido_esperado: 'Procesando', revision_pedido_esperada: 4 }, prepare(view) {
    button(view.tree, 'Eliminar entrega').props.onClick()
  } },
]

for (const mutation of processingMutations) test(`${mutation.name} sends the expected processing state in its JSON request`, async () => {
  const env = environment({ 'pedidos/11': order({ items: [item(mutation.item)] }) })
  const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  mutation.prepare(view)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.calls[0].path, mutation.path)
  assert.equal(env.calls[0].init.method, mutation.method)
  assert.deepEqual(JSON.parse(env.calls[0].init.body || '{}'), mutation.body)
})

for (const mutation of processingMutations) test(`${mutation.name} keeps the revision captured before its pending confirmation`, async () => {
  const current = order({ items: [item(mutation.item)] })
  const env = environment({ 'pedidos/11': current })
  let answer
  env.setConfirm(() => new Promise(resolve => { answer = resolve }))
  const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  mutation.prepare(view)
  current.revision = 5
  view.render({ ...view.props, order: current })
  answer(true); await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.calls.length, 1)
  assert.equal(JSON.parse(env.calls[0].init.body || '{}').revision_pedido_esperada, 4)
})

for (const change of [
  { name: 'item is suspended', item: { estado_item: 'suspendido' } },
  { name: 'partial mode is disabled', item: { modo_entregas_parciales: false } },
  { name: 'remaining quantity reaches zero', item: { cantidad_entregada_total: 100 } },
  { name: 'remaining quantity falls below the requested delivery', item: { cantidad_entregada_total: 95 } },
]) test(`partial delivery stops after confirmation when ${change.name}`, async () => {
  const initial = item({ modo_entregas_parciales: true })
  const env = environment({ 'pedidos/11': order({ items: [initial] }) })
  let answer
  env.setConfirm(() => new Promise(resolve => { answer = resolve }))
  const detail = env.mount(env.load('order-detail.tsx').OrderDetail, { id: 11, onClose() {} })
  const entry = nodes(detail.tree, n => n.type?.name === 'ItemDetail')[0]
  const view = env.mount(entry.type, entry.props)
  processingMutations[2].prepare(view)
  const updated = { ...initial, ...change.item }
  view.render({ ...view.props, item: updated, order: order({ revision: 5, items: [updated] }) })
  answer(true); await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.calls.length, 0)
})
