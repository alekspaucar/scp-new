import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
type Element = { type: any; props: any }

// Runs the actual TSX handlers without a browser or service. Only the React
// hook host, resource reads, confirmation and HTTP boundary are substituted.
// It does not claim to verify DOM focus, native validation or visual layout.
function harness(resources: Record<string, any> = {}, request = async (_path: string, _init: any): Promise<any> => ({})) {
  let active: any, permission = true, confirm: (...args: any[]) => Promise<boolean> = async () => true
  let user = { id: 99, rol: 'jefe' }
  const calls: { path: string; method: string; body: any; actorId: number }[] = []
  const uploads: { path: string; file: any }[] = []
  const refreshes: number[] = [], reloads: string[] = []
  const cache = new Map<string, any>()
  const jsx = (type: any, props: any) => ({ type, props: props || {} })
  const hooks = {
    useState(initial: any) { const host = active, i = host.cursor++; if (!(i in host.values)) host.values[i] = typeof initial === 'function' ? initial() : initial; return [host.values[i], (value: any) => { host.values[i] = typeof value === 'function' ? value(host.values[i]) : value }] },
    useRef(initial: any) { const host = active, i = host.cursor++; return host.values[i] ||= { current: initial } },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const host = active
      if (!host.lifecycle) return
      const i = host.cursor++, previous = host.effects.get(i)
      if (previous && deps && previous.deps?.length === deps.length && deps.every((value, index) => Object.is(value, previous.deps[index]))) return
      host.pendingEffects.push(() => { previous?.cleanup?.(); host.effects.set(i, { deps, cleanup: effect() }) })
    },
    useId() { return 'audit-id' },
  }
  async function api(path: string, init: any = {}) {
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, actorId: user.id })
    return request(path, init)
  }
  class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }
  const external: Record<string, any> = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'lucide-react': new Proxy({}, { get: (_, key) => String(key) }),
    '@/components/session-provider': { useSession: () => ({ can: () => permission, isManager: permission, user, refresh: async () => { refreshes.push(user.id) } }) },
    '@/lib/api': { api, ApiError, jsonRequest: (method: string, body: any) => ({ method, body: JSON.stringify(body) }), upload: (path: string, file: any) => { uploads.push({ path, file }); return request(path, { method: 'POST', file }) }, download: async () => {}, useResource: (path: string) => ({ data: resources[path] ?? null, loading: false, error: '', reload: async () => { reloads.push(path) } }) },
    '@/lib/confirm': { confirmAction: (...args: any[]) => confirm(...args) },
  }
  function load(filename: string): any {
    if (cache.has(filename)) return cache.get(filename)
    const module = { exports: {} }; cache.set(filename, module.exports)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
    const localRequire = (id: string) => {
      if (id.endsWith('.css')) return {}
      if (external[id]) return external[id]
      const path = id.startsWith('@/') ? resolve(id.slice(2)) : id.startsWith('.') ? resolve(filename, '..', id) : ''
      if (path) return load(/\.[tj]sx?$/.test(path) ? path : path + (id.includes('/lib/') ? '.ts' : '.tsx'))
      return require(id)
    }
    runInNewContext('(function(require,module,exports){' + code + '\n})', { URL, Uint8Array, Number, Map, Set, Date, Error, HTMLInputElement: class {}, HTMLSelectElement: class {} })(localRequire, module, module.exports)
    return module.exports
  }
  function mount(component: (props: any) => any, props = {}, lifecycle = false) {
    const host = { values: [] as any[], cursor: 0, lifecycle, mounted: true, effects: new Map<number, any>(), pendingEffects: [] as (() => void)[] }
    let tree: Element
    function render() { if (!host.mounted) return tree; host.cursor = 0; active = host; tree = component(props); host.pendingEffects.splice(0).forEach(effect => effect()); return tree }
    function unmount() { host.mounted = false; host.effects.forEach(effect => effect.cleanup?.()); host.effects.clear() }
    function all(predicate: (value: Element) => boolean): Element[] {
      const found: Element[] = []
      function visit(node: any) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object' || !node.props) return; if (predicate(node)) found.push(node); visit(node.props.children); visit(node.props.actions) }
      visit(tree!); return found
    }
    const content = (node: any): string => Array.isArray(node) ? node.map(content).join(' ') : node?.props ? content(node.props.children) : String(node ?? '')
    const label = (name: string) => { const found = all(n => n.type === 'label' && content(n).startsWith(name))[0]; assert.ok(found, `label ${name}`); const values: any[] = Array.isArray(found.props.children) ? found.props.children : [found.props.children]; return values.find((n: any) => n?.props && ['input', 'select', 'textarea'].includes(n.type)) }
    const button = (name: string) => { const found = all(n => n.type?.name === 'Button' && content(n).trim() === name)[0]; assert.ok(found, `button ${name}`); return found }
    const submit = async (intent = 'save') => { const form = all(n => n.type === 'form')[0]; assert.ok(form); await form.props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: () => intent } } }); await new Promise(resolve => setImmediate(resolve)); render() }
    render()
    return { render, unmount, all, label, button, submit, change(name: string, value: any) { label(name).props.onChange({ target: { value } }); render() } }
  }
  return { calls, uploads, refreshes, reloads, error: (message: string, status: number) => new ApiError(message, status), load: (name: string, symbol: string) => load(resolve('components/management', name + '.tsx'))[symbol], mount, setPermission(value: boolean) { permission = value }, setUser(value: typeof user) { user = value }, setConfirm(value: any) { confirm = value } }
}

const product = { id: 1, codigo: '001', cliente: 'ACME', descripcion: 'Etiqueta', cant_etiquetas_plancha: 4, cant_planchas: 1, cant_rollos: 1, cant_etiquetas_rollo: 100, largo_plancha_impresa: 20, largo_rollo: 100, ancho_rollo: 1, material_id: null, tipo_codigo: 'normal', tiempo_base_minutos: 1, maquina_requerida: null }
const material = { id: 1, revision: 7, codigo_barras: 'VINIL', nombre: 'Vinil', categoria: 'Materia Prima', tipo: 'Sustrato', proveedor: 'Proveedor', stock_actual: 3, stock_minimo: 1, metros_por_rollo: 100, ancho_material_cm: 0, unidad_medida: 'rollos', estado: 'Disponible' }

test('catalog client suggestions preserve a free-text client and cleared optional yields save as zero', async () => {
  const h = harness({ catalogo: [product], clientes: [{ id: 1, codigo: 'AC', nombre: 'ACME' }] }, async () => ({ producto: product }))
  const view = h.mount(h.load('catalog', 'Catalog'))
  view.button('Editar').props.onClick(); view.render()
  assert.ok(view.label('Cliente').props.list, 'catalog must offer the client directory')
  assert.equal(view.all(n => n.type === 'option' && n.props.value === 'ACME').length, 1)
  view.change('Cliente', 'Esporádico'); view.change('Cantidad de rollos', '')
  await view.submit()
  assert.equal(h.calls[0]?.body.cliente, 'Esporádico')
  assert.equal(h.calls[0]?.body.cant_rollos, 0)
})

test('material accepts original zero-width boundary and carries its optimistic revision', async () => {
  const h = harness({ materiales: [material] }, async () => ({ mensaje: 'OK', material }))
  const inventory = h.mount(h.load('inventory', 'Inventory'))
  inventory.all(n => n.type?.name === 'Button' && n.props['aria-label']?.startsWith('Editar'))[0].props.onClick(); inventory.render()
  const element = inventory.all(n => n.type?.name === 'MaterialEditor')[0]
  assert.ok(element)
  const editor = h.mount(element.type, element.props)
  await editor.submit()
  assert.equal(h.calls[0]?.body.ancho_material_cm, 0)
  assert.equal(h.calls[0]?.body.revision, 7)
})

test('quick scanner clears a rejected code so the next scan is a new independent movement', async () => {
  const h = harness({ movimientos: [], materiales: [] }, async () => { throw new Error('SKU desconocido') })
  const view = h.mount(h.load('operations', 'Operations'))
  view.all(n => n.type === 'input')[0].props.onChange({ target: { value: 'BAD' } }); view.render()
  await view.all(n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); view.render()
  assert.equal(view.all(n => n.type === 'input')[0].props.value, '')
  assert.equal(h.calls.length, 1)
})

test('refocusing manual code always requires an explicit fresh quantity', () => {
  const h = harness({ movimientos: [], materiales: [] }), view = h.mount(h.load('operations', 'Operations'))
  const manual = () => view.all(n => n.type === 'input' && n.props.list === 'bodega-material-options')[0]
  manual().props.onChange({ target: { value: 'VINIL' } }); view.render(); view.change('Cantidad', '7')
  manual().props.onFocus(); view.render()
  assert.equal(view.label('Cantidad').props.value, '')
})

test('catalog deletion rechecks permissions after the user confirmation resolves', async () => {
  const h = harness({ catalogo: [product] }), view = h.mount(h.load('catalog', 'Catalog'))
  let finish: any; h.setConfirm(() => new Promise(resolve => { finish = resolve }))
  const pending = view.button('Eliminar').props.onClick()
  h.setPermission(false); view.render(); finish(true); await pending
  // onClick may intentionally discard the promise; flush request microtasks.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.length, 0)
})

test('user drafts prepare without changing accounts and support partial batch success', async () => {
  const h = harness({ usuarios: [] }, async (_path, init) => { const body = JSON.parse(init.body); if (body.username === 'repetido') throw new Error('Ya existe'); return { usuario: { id: 8, username: body.username, rol: body.rol, permisos_personalizados: false, permisos: { pedidos: 'ver', produccion: 'ver', calculadora: 'ver', inventario: 'ninguno', configuracion: 'ninguno', reportes: 'ninguno', operaciones: 'ninguno' } } } })
  const view = h.mount(h.load('users', 'Users'))
  for (const username of ['nuevo', 'repetido']) {
    view.button('Nuevo usuario').props.onClick(); view.render()
    view.change('Nombre de usuario', username); view.change('Contraseña inicial', 'temporary')
    await view.submit('draft')
  }
  assert.equal(h.calls.length, 0, 'preparing drafts must never POST accounts')
  await view.button('Guardar borradores').props.onClick(); view.render()
  assert.equal(h.calls.length, 2)
  assert.equal(view.all(n => n.type?.name === 'Status' && n.props.value === 'Borrador').length, 1)
  const edit = view.all(n => n.type?.name === 'Button' && n.props.children === 'Editar').at(-1)!
  edit.props.onClick(); view.render()
  assert.equal(view.label('Nombre de usuario').props.value, 'repetido')
  assert.equal(view.label('Contraseña inicial').props.value, 'temporary')
})

const managerPermissions = { pedidos: 'editar', produccion: 'editar', operaciones: 'editar', inventario: 'editar', reportes: 'editar', configuracion: 'editar', calculadora: 'editar' }
const userAccount = (id: number, username: string, rol = 'admin') => ({ id, username, rol, permisos_personalizados: false, permisos: managerPermissions })

for (const interruption of ['identity change', 'unmount'] as const) {
  for (const fails of [false, true]) {
    test(`user batch stops after ${interruption} while its first write ${fails ? 'fails' : 'succeeds'}`, async () => {
      let finish!: (value: any) => void, fail!: (reason: Error) => void
      const h = harness({ usuarios: [] }, async () => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
      const view = h.mount(h.load('users', 'Users'), {}, true)
      for (const username of ['primero', 'segundo']) {
        view.button('Nuevo usuario').props.onClick(); view.render()
        view.change('Nombre de usuario', username); view.change('Contraseña inicial', 'temporary')
        await view.submit('draft')
      }
      const pending = view.button('Guardar borradores').props.onClick()
      assert.equal(h.calls.length, 1)
      if (interruption === 'identity change') { h.setUser({ id: 100, rol: 'admin' }); view.render(); assert.ok(view.button('Nuevo usuario')) }
      else view.unmount()
      if (fails) fail(new Error('No se pudo guardar'))
      else finish({ usuario: userAccount(8, 'primero', 'empleado') })
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(h.calls.map(call => call.actorId), [99], 'No remaining row may be sent after the initiating view or account changes')
      await pending
      assert.deepEqual(h.reloads, [])
    })
  }

  test(`user batch deletion stops after ${interruption} during confirmation`, async () => {
    const h = harness({ usuarios: [userAccount(1, 'uno'), userAccount(2, 'dos')] })
    const view = h.mount(h.load('users', 'Users'), {}, true)
    view.all(n => n.props['aria-label'] === 'Seleccionar usuarios visibles')[0].props.onChange({ target: { checked: true } }); view.render()
    let finish!: (value: boolean) => void
    h.setConfirm(() => new Promise(resolve => { finish = resolve }))
    const pending = view.button('Eliminar selección').props.onClick()
    if (interruption === 'identity change') { h.setUser({ id: 100, rol: 'admin' }); view.render() }
    else view.unmount()
    finish(true); await pending
    assert.deepEqual(h.calls, [])
  })

  test(`user batch deletion stops after ${interruption} while its first delete is pending`, async () => {
    let finish!: (value: any) => void
    const h = harness({ usuarios: [userAccount(1, 'uno'), userAccount(2, 'dos')] }, async () => new Promise(resolve => { finish = resolve }))
    const view = h.mount(h.load('users', 'Users'), {}, true)
    view.all(n => n.props['aria-label'] === 'Seleccionar usuarios visibles')[0].props.onChange({ target: { checked: true } }); view.render()
    const pending = view.button('Eliminar selección').props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.calls.length, 1)
    if (interruption === 'identity change') { h.setUser({ id: 100, rol: 'admin' }); view.render() }
    else view.unmount()
    finish({}); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(h.calls.map(call => [call.path, call.actorId]), [['usuarios/1', 99]])
    await pending
    assert.deepEqual(h.reloads, [])
  })

  test(`saving the own account stops its refresh and reload after ${interruption}`, async () => {
    let finish!: (value: any) => void
    const h = harness({ usuarios: [userAccount(99, 'actual', 'jefe')] }, async () => new Promise(resolve => { finish = resolve }))
    const view = h.mount(h.load('users', 'Users'), {}, true)
    view.button('Editar').props.onClick(); view.render(); view.change('Nueva contraseña', 'temporary')
    const pending = view.submit()
    assert.equal(h.calls.length, 1)
    if (interruption === 'identity change') { h.setUser({ id: 100, rol: 'admin' }); view.render() }
    else view.unmount()
    finish({ usuario: userAccount(99, 'actual', 'jefe') }); await pending
    assert.deepEqual(h.refreshes, [])
    assert.deepEqual(h.reloads, [])
  })
}

test('a save callback retained from the previous manager cannot write under the new manager', async () => {
  const h = harness({ usuarios: [] }, async () => ({ usuario: userAccount(8, 'nuevo', 'empleado') }))
  const view = h.mount(h.load('users', 'Users'), {}, true)
  view.button('Nuevo usuario').props.onClick(); view.render()
  view.change('Nombre de usuario', 'nuevo'); view.change('Contraseña inicial', 'temporary')
  const submit = view.all(n => n.type === 'form')[0].props.onSubmit
  h.setUser({ id: 100, rol: 'admin' }); view.render()
  await submit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: () => 'save' } } })
  assert.deepEqual(h.calls, [])
})

test('catalog retries a failed reference with saved ID, avoiding a duplicate create', async () => {
  let fail = true
  const h = harness({ catalogo: [] }, async (path, init) => { if (path.endsWith('/imagen')) { if (fail) throw new Error('Upload falló'); return {} } return { producto: { ...product, id: 12 } } })
  const view = h.mount(h.load('catalog', 'Catalog'))
  view.button('Nuevo producto').props.onClick(); view.render(); view.change('Descripción', 'Nuevo')
  view.label('Referencia (').props.onChange({ target: { files: [{ name: 'ref.pdf', size: 4, type: 'application/pdf' }], value: '' } }); view.render()
  await view.submit(); fail = false; await view.submit()
  assert.deepEqual(h.calls.map(c => [c.path, c.method]), [['catalogo', 'POST'], ['catalogo/12', 'PUT']])
})

test('inventory shows the seven-day movement count explicitly limited to the returned history', () => {
  const date = new Date(Date.now() - 86400000).toISOString()
  const h = harness({ materiales: [], movimientos: [{ id: 1, fecha: date }, { id: 2, fecha: '2020-01-01T00:00:00Z' }, { id: 3, fecha: 'invalid' }] })
  const view = h.mount(h.load('inventory', 'Inventory'))
  const metric = view.all(n => n.type?.name === 'Metric' && n.props.label === 'Movimientos (7 días)')[0]
  assert.ok(metric, 'inventory lost its recent movement count')
  assert.equal(metric.props.value, '1')
  assert.match(metric.props.note, /50/)
})

test('client deletion rechecks permission after a pending confirmation', async () => {
  const h = harness({ clientes: [{ id: 1, codigo: 'AC', nombre: 'ACME' }] }), view = h.mount(h.load('clients', 'Clients'))
  let finish: any; h.setConfirm(() => new Promise(resolve => { finish = resolve }))
  view.button('Eliminar').props.onClick()
  h.setPermission(false); view.render(); finish(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.length, 0)
})

test('reference upload stops after a permission revocation during its base save', async () => {
  let finish: any
  const h = harness({ catalogo: [] }, (path) => path === 'catalogo' ? new Promise(resolve => { finish = resolve }) : Promise.resolve({}))
  const view = h.mount(h.load('catalog', 'Catalog'))
  view.button('Nuevo producto').props.onClick(); view.render(); view.change('Descripción', 'Nuevo')
  view.label('Referencia (').props.onChange({ target: { files: [{ name: 'ref.pdf', size: 4, type: 'application/pdf' }], value: '' } }); view.render()
  const pending = view.submit()
  h.setPermission(false); view.render(); finish({ producto: { ...product, id: 12 } }); await pending
  assert.deepEqual(h.calls.map(c => c.path), ['catalogo'])
})

test('user selection never deletes the current account and retains failed deletions for retry', async () => {
  const permissions = { pedidos: 'editar', produccion: 'editar', operaciones: 'editar', inventario: 'editar', reportes: 'editar', configuracion: 'editar', calculadora: 'editar' }
  const users = [{ id: 99, username: 'actual', rol: 'jefe', permisos: permissions }, { id: 1, username: 'uno', rol: 'admin', permisos: permissions }, { id: 2, username: 'dos', rol: 'admin', permisos: permissions }]
  const h = harness({ usuarios: users }, async path => { if (path === 'usuarios/2') throw new Error('No se pudo eliminar'); return {} })
  const view = h.mount(h.load('users', 'Users'))
  view.all(n => n.props['aria-label'] === 'Seleccionar usuarios visibles')[0].props.onChange({ target: { checked: true } }); view.render()
  await view.button('Eliminar selección').props.onClick(); view.render()
  assert.deepEqual(h.calls.map(c => c.path), ['usuarios/1', 'usuarios/2'])
  assert.equal(view.all(n => n.props['aria-label'] === 'Seleccionar actual')[0].props.disabled, true)
  assert.equal(view.all(n => n.props['aria-label'] === 'Seleccionar uno')[0].props.checked, false)
  assert.equal(view.all(n => n.props['aria-label'] === 'Seleccionar dos')[0].props.checked, true)
})

test('Excel drag-and-drop prepares a file and confirmation is required before its upload', async () => {
  const h = harness({}, async () => ({ mensaje: 'OK', creados: 1, actualizados: 0, omitidos: 0 }))
  const settings = h.mount(h.load('settings', 'Settings'), { initialTab: 'instalacion' })
  const element = settings.all(n => n.type?.name === 'InstallationSettings')[0]
  const view = h.mount(element.type, element.props)
  view.button('Importar Excel').props.onClick(); view.render()
  const drop = view.all(n => n.props.className === 'management-dropzone')[0]
  assert.ok(drop, 'original Excel drag-and-drop is missing')
  const file = { name: 'inventario.xlsx', size: 100 }
  drop.props.onDrop({ preventDefault() {}, dataTransfer: { files: [file] } }); view.render()
  assert.equal(h.uploads.length, 0)
  h.setConfirm(async () => false); await view.submit(); assert.equal(h.uploads.length, 0)
  h.setConfirm(async () => true); await view.submit()
  assert.equal(h.uploads.length, 1); assert.equal(h.uploads[0].path, 'importar/excel'); assert.equal(h.uploads[0].file, file)
})

test('a material conflict loads the latest revision and stock before an explicit retry', async () => {
  let writes = 0
  const latest = { ...material, stock_actual: 9, revision: 8 }
  const h = harness({ materiales: [material] }, async (_path, init) => {
    if (!init.method) return [latest]
    if (++writes === 1) throw h.error('El recurso cambió', 409)
    return { mensaje: 'OK', material: latest }
  })
  const inventory = h.mount(h.load('inventory', 'Inventory'))
  inventory.all(n => n.props['aria-label'] === 'Editar VINIL')[0].props.onClick(); inventory.render()
  const element = inventory.all(n => n.type?.name === 'MaterialEditor')[0], view = h.mount(element.type, element.props)
  await view.submit(); assert.equal(writes, 1)
  view.button('Usar saldo actual').props.onClick(); view.render(); await view.submit()
  const puts = h.calls.filter(call => call.method === 'PUT')
  assert.equal(puts[0].body.revision, 7); assert.equal(puts[1].body.revision, 8); assert.equal(puts[1].body.stock_actual, 9)
})

test('stock addition stops if permission is revoked while its material editor is unmounted', async () => {
  const h = harness({ materiales: [material] }), inventory = h.mount(h.load('inventory', 'Inventory'))
  inventory.button('Nuevo material').props.onClick(); inventory.render()
  const element = inventory.all(n => n.type?.name === 'MaterialEditor')[0], view = h.mount(element.type, element.props)
  view.change('SKU /', 'VINIL'); view.change('Nombre /', 'Vinil'); view.change('Proveedor', 'Proveedor'); view.change('Cantidad a sumar', '1'); view.change('Stock mínimo', '0'); view.change('Ancho de material', '0')
  let finish: any; h.setConfirm(() => new Promise(resolve => { finish = resolve }))
  const pending = view.submit()
  h.setPermission(false); inventory.render(); finish(true); await pending
  assert.equal(h.calls.length, 0)
})
