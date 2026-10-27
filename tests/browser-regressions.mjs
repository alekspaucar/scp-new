import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const base = process.env.SGP_NUEVA_TEST_URL || 'http://127.0.0.1:3001'
const target = new URL(base)
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && ['3001', '3100'].includes(target.port))
const credentials = JSON.parse(await readFile(new URL('../backend/instance/.e2e-login.json', import.meta.url), 'utf8'))
const browser = await chromium.launch({ headless: true, executablePath: process.env.SGP_NUEVA_BROWSER_PATH })
after(() => browser.close())

test('an old session response cannot undo a newer login or logout', async () => {
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage()
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Ingresar', exact: true }).waitFor()
    let release, intercepted
    let queued = new Promise(resolve => { intercepted = resolve })
    let hold = new Promise(resolve => { release = resolve })
    let oldStatus = 401, oldBody = { error: 'Sesión anterior' }, armed = true
    await page.route('**/api/sesion', async route => {
      if (!armed) return route.continue()
      armed = false; intercepted()
      await hold
      await route.fulfill({ status: oldStatus, contentType: 'application/json', body: JSON.stringify(oldBody) }).catch(() => {})
    })
    await page.evaluate(() => window.dispatchEvent(new Event('sgp:session-change')))
    await queued
    await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
    await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
    await page.getByRole('navigation', { name: 'Navegación principal' }).waitFor()
    const oldResponse = page.waitForResponse(response => response.url().endsWith('/api/sesion') && response.status() === 401)
    release(); await oldResponse
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.getByRole('navigation', { name: 'Navegación principal' }).isVisible(), true, 'Una comprobación antigua no debe cerrar un login nuevo')
    const response = await context.request.get('/api/sesion'); oldBody = await response.json(); oldStatus = 200
    hold = new Promise(resolve => { release = resolve }); queued = new Promise(resolve => { intercepted = resolve }); armed = true
    await page.evaluate(() => window.dispatchEvent(new Event('sgp:session-change'))); await queued
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
    await page.getByRole('button', { name: 'Ingresar', exact: true }).waitFor()
    const staleResponse = page.waitForResponse(response => response.url().endsWith('/api/sesion') && response.status() === 200)
    release(); await staleResponse
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.getByRole('button', { name: 'Ingresar', exact: true }).isVisible(), true, 'Una comprobación antigua no debe reabrir una sesión cerrada')
  } finally { await context.close() }
})

test('an employee granted Configuration editing can create products and clients', async () => {
  const admin = await browser.newContext({ baseURL: base })
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage()
  const username = `config-${Date.now()}`, password = 'ClavePruebaLocal-2026'
  try {
    assert.equal((await admin.request.get('/api/health')).status(), 200)
    assert.equal((await admin.request.post('/api/login', { data: credentials })).status(), 200)
    const create = await admin.request.post('/api/usuarios', { data: { username, password, rol: 'empleado' } })
    const { usuario } = await create.json(); assert.ok(usuario)
    const permissions = { pedidos: 'ver', produccion: 'ver', operaciones: 'ninguno', inventario: 'ninguno', reportes: 'ninguno', configuracion: 'editar', calculadora: 'ver' }
    assert.equal((await admin.request.put(`/api/usuarios/${usuario.id}/permisos`, { data: { permisos: permissions } })).status(), 200)
    assert.equal((await context.request.post('/api/login', { data: { username, password } })).status(), 200)
    await page.goto('/configuracion')
    await page.getByRole('heading', { name: 'Catálogo de productos', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Nuevo producto', exact: true }).isVisible(), true)
    await page.goto('/clientes')
    await page.getByRole('heading', { name: 'Clientes', exact: true }).first().waitFor()
    assert.equal(await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: 'Usuarios', exact: true }).count(), 0, 'El permiso de datos maestros no concede administración de usuarios')
  } finally { await context.close(); await admin.close() }
})

test('the calculator remains usable when a catalogue product has no assigned client', async () => {
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    assert.equal((await context.request.post('/api/login', { data: credentials })).status(), 200)
    const response = await context.request.post('/api/catalogo', { data: { codigo: `SIN-CLI-${Date.now()}`, cliente: '', descripcion: 'PRODUCTO SIN CLIENTE', cant_etiquetas_plancha: 10, cant_planchas: 10, cant_rollos: 1, cant_etiquetas_rollo: 100, largo_plancha_impresa: 100, largo_rollo: 10, ancho_rollo: 1.5, tipo_codigo: 'normal', tiempo_base_minutos: 1 } })
    assert.equal(response.status(), 201)
    const catalogLoaded = page.waitForResponse(response => response.url().endsWith('/api/catalogo') && response.status() === 200)
    await page.goto('/calculadora'); await catalogLoaded
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual(errors, [], 'Un producto válido sin cliente no debe romper la calculadora')
    assert.equal(await page.getByRole('heading', { name: 'Calculadora MRP', exact: true }).isVisible(), true)
  } finally { await context.close() }
})

test('editing a stale material preserves a movement and keeps the supplier draft', async () => {
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage()
  page.on('dialog', dialog => void dialog.accept())
  const sku = `SALDO-${Date.now()}`
  try {
    assert.equal((await context.request.post('/api/login', { data: credentials })).status(), 200)
    const material = await (await context.request.post('/api/materiales', { data: { codigo_barras: sku, nombre: 'MATERIAL CONCURRENTE', categoria: 'Materia Prima', tipo: 'Sustrato', proveedor: 'PROVEEDOR ORIGINAL', stock_actual: 20, stock_minimo: 1, ancho_material_cm: 100 } })).json()
    assert.ok(material.material?.revision)
    await page.goto('/inventario')
    await page.getByLabel('Buscar material', { exact: true }).fill(sku)
    await page.getByRole('button', { name: `Editar ${sku}`, exact: true }).click()
    await page.getByLabel('Proveedor', { exact: true }).fill('PROVEEDOR DEL BORRADOR')
    const movement = await context.request.post('/api/movimientos', { data: { codigo_barras: sku, tipo_movimiento: 'Salida', cantidad: 2 } })
    assert.equal(movement.status(), 201)
    const rejected = page.waitForResponse(response => response.url().includes(`/api/materiales/${material.material.id}`) && response.request().method() === 'PUT' && response.status() === 409)
    await page.getByRole('button', { name: 'Guardar material', exact: true }).click(); await rejected
    assert.equal(await page.getByLabel('Proveedor', { exact: true }).inputValue(), 'PROVEEDOR DEL BORRADOR')
    await page.getByRole('button', { name: 'Usar saldo actual', exact: true }).click()
    assert.equal(await page.getByLabel('Stock actual (rollos)', { exact: true }).inputValue(), '18')
    const saved = page.waitForResponse(response => response.url().includes(`/api/materiales/${material.material.id}`) && response.request().method() === 'PUT' && response.status() === 200)
    await page.getByRole('button', { name: 'Guardar material', exact: true }).click(); await saved
    const values = await (await context.request.get('/api/materiales')).json()
    const current = values.find(value => value.id === material.material.id)
    assert.equal(current.stock_actual, 18); assert.equal(current.proveedor, 'PROVEEDOR DEL BORRADOR')
  } finally { await context.close() }
})

test('a stale order cannot delete a newer item or its partial delivery', async () => {
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage()
  page.on('dialog', dialog => void dialog.accept())
  const oc = `CONC-${Date.now()}`
  try {
    assert.equal((await context.request.post('/api/login', { data: credentials })).status(), 200)
    const created = await context.request.post('/api/pedidos', { data: { cliente: 'CLIENTE CONCURRENCIA', orden_compra: oc, fecha_entrega: '2026-12-01T12:00', items: [{ codigo: 'CONC-1', descripcion: 'PRIMER ÍTEM', cantidad: 100 }] } })
    let { pedido } = await created.json(); assert.ok(pedido.revision)
    await page.goto('/pedidos')
    await page.getByLabel('Buscar', { exact: true }).fill(oc)
    await page.getByRole('row').filter({ hasText: oc }).getByRole('button', { name: 'Editar', exact: true }).click()
    await page.getByLabel('Fecha y hora de entrega (Ecuador)', { exact: true }).fill('2026-12-02T12:00')
    const update = await context.request.put(`/api/pedidos/${pedido.id}`, { data: { revision: pedido.revision, cliente: pedido.cliente, orden_compra: oc, fecha_entrega: pedido.fecha_entrega, items: [...pedido.items.map(item => ({ id: item.id, codigo: item.codigo, descripcion: item.descripcion, cantidad: item.cantidad })), { codigo: 'CONC-2', descripcion: 'NUEVO ÍTEM CON HISTORIAL', cantidad: 50 }] } })
    assert.equal(update.status(), 200); pedido = (await update.json()).pedido
    const added = pedido.items.find(item => item.codigo === 'CONC-2')
    assert.equal((await context.request.post(`/api/pedidos/${pedido.id}/items/${added.id}/entregas`, { data: { cantidad_entregada: 10 } })).status(), 200)
    await page.getByRole('button', { name: 'Revisar pedido', exact: true }).click()
    const rejected = page.waitForResponse(response => response.url().endsWith(`/api/pedidos/${pedido.id}`) && response.request().method() === 'PUT' && response.status() === 409)
    await page.getByRole('button', { name: 'Confirmar y guardar', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Guardar correcciones', exact: true }).click()
    await rejected
    await page.getByRole('alert').filter({ hasText: 'El pedido cambió desde que abriste este borrador.' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Reintentar guardar', exact: true }).isEnabled(), false)
    const current = await (await context.request.get(`/api/pedidos/${pedido.id}`)).json()
    assert.equal(current.items.length, 2); assert.equal(current.items.find(item => item.id === added.id).cantidad_entregada_total, 10)
    await page.getByRole('button', { name: 'Recargar pedido y descartar este borrador', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Recargar y descartar', exact: true }).click()
    await page.getByLabel('Código del ítem 2', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Código del ítem 2', { exact: true }).inputValue(), 'CONC-2')
  } finally { await context.close() }
})

test('a read-only order user sees its reference without catalogue permission', async () => {
  const admin = await browser.newContext({ baseURL: base }), context = await browser.newContext({ baseURL: base }), page = await context.newPage()
  const suffix = Date.now(), cliente = `REFERENCIA QA ${suffix}`, code = `REF-${suffix}`, oc = `REF-OC-${suffix}`
  try {
    assert.equal((await admin.request.post('/api/login', { data: credentials })).status(), 200)
    const created = await admin.request.post('/api/catalogo', { data: { codigo: code, cliente, descripcion: 'REFERENCIA VISIBLE', tiempo_base_minutos: 1 } })
    const { producto } = await created.json(); assert.ok(producto?.id)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=', 'base64')
    const upload = await admin.request.post(`/api/catalogo/${producto.id}/imagen`, { multipart: { archivo: { name: 'referencia.png', mimeType: 'image/png', buffer: png } } })
    assert.ok(upload.ok(), await upload.text())
    const orderResponse = await admin.request.post('/api/pedidos', { data: { cliente, orden_compra: oc, fecha_entrega: '2090-01-01T12:00', items: [{ codigo: code, descripcion: 'REFERENCIA VISIBLE', cantidad: 100 }] } })
    assert.equal(orderResponse.status(), 201)
    const password = 'ClaveReferenciaSoloPruebas-2026', username = `ref-${suffix}`
    const account = await (await admin.request.post('/api/usuarios', { data: { username, password, rol: 'empleado' } })).json()
    const permisos = Object.fromEntries(['pedidos', 'produccion', 'operaciones', 'inventario', 'reportes', 'configuracion', 'calculadora'].map(key => [key, key === 'pedidos' ? 'ver' : 'ninguno']))
    assert.equal((await admin.request.put(`/api/usuarios/${account.usuario.id}/permisos`, { data: { permisos } })).status(), 200)
    assert.equal((await context.request.post('/api/login', { data: { username, password } })).status(), 200)
    assert.equal((await context.request.get('/api/catalogo')).status(), 403)
    const catalogRequests = []
    page.on('request', request => { if (request.url().endsWith('/api/catalogo')) catalogRequests.push(request.url()) })
    await page.goto('/pedidos')
    await page.getByLabel('Buscar', { exact: true }).fill(oc)
    await page.getByRole('row').filter({ hasText: oc }).getByRole('button', { name: 'Detalle', exact: true }).click()
    await page.getByText('Referencia del producto', { exact: true }).click()
    const reference = page.getByRole('img', { name: 'Referencia de REFERENCIA VISIBLE', exact: true })
    await reference.waitFor()
    assert.ok(await reference.evaluate(image => image.complete && image.naturalWidth > 0))
    assert.deepEqual(catalogRequests, [], 'No debe conceder ni consultar el catálogo completo para ver una referencia de un pedido')
  } finally { await context.close(); await admin.close() }
})

test('a confirmed partial cannot overwrite a concurrent suspension', async () => {
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage()
  const oc = `PARCIAL-CONC-${Date.now()}`
  try {
    assert.equal((await context.request.post('/api/login', { data: credentials })).status(), 200)
    const created = await (await context.request.post('/api/pedidos', { data: { cliente: 'PARCIALES QA', orden_compra: oc, fecha_entrega: '2090-01-01T12:00', items: [{ codigo: 'S/C', descripcion: 'SALIDA CONCURRENTE', cantidad: 100 }] } })).json()
    const order = created.pedido, item = order.items[0], path = `/api/pedidos/${order.id}/items/${item.id}`
    assert.equal((await context.request.put(`/api/pedidos/${order.id}/estado`, { data: { estado: 'Procesando' } })).status(), 200)
    assert.equal((await context.request.patch(`${path}/modo-parcial`, { data: { activo: true } })).status(), 200)
    await page.goto('/pedidos')
    await page.getByLabel('Buscar', { exact: true }).fill(oc)
    await page.getByRole('row').filter({ hasText: oc }).getByRole('button', { name: 'Detalle', exact: true }).click()
    await page.getByRole('button', { name: 'Entrega', exact: true }).click()
    await page.getByLabel('Cantidad de salida', { exact: true }).fill('100')
    await page.getByRole('button', { name: 'Registrar entrega parcial', exact: true }).click()
    await page.getByRole('alertdialog').waitFor()
    assert.equal((await context.request.put(`${path}/estado`, { data: { estado: 'suspendido', observacion: 'Suspensión concurrente de verificación' } })).status(), 200)
    const response = page.waitForResponse(response => response.url().endsWith(`${path}/entregas`) && response.request().method() === 'POST')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Registrar entrega', exact: true }).click()
    assert.equal((await response).status(), 409)
    const current = (await (await context.request.get(`/api/pedidos/${order.id}`)).json()).items[0]
    assert.equal(current.estado_item, 'suspendido')
    assert.equal(current.cantidad_entregada_total, 0)
  } finally { await context.close() }
})

test('an authenticated account change discards the previous account workspace and drafts', async () => {
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage()
  try {
    assert.equal((await context.request.post('/api/login', { data: credentials })).status(), 200)
    const next = { username: `cuenta-b-${Date.now()}`, password: 'OtraCuentaSoloPruebas-2026', rol: 'jefe' }
    assert.ok((await context.request.post('/api/usuarios', { data: next })).ok())
    await page.goto('/pedidos')
    await page.getByRole('button', { name: 'Nuevo pedido', exact: true }).click()
    await page.getByLabel(/^Cliente/).fill('BORRADOR PRIVADO DE LA CUENTA ANTERIOR')
    assert.equal((await context.request.post('/api/login', { data: next })).status(), 200)
    await page.evaluate(() => window.dispatchEvent(new Event('sgp:session-change')))
    await page.locator('.profile strong').filter({ hasText: next.username }).waitFor()
    assert.equal(await page.getByRole('dialog', { name: 'Nuevo pedido', exact: true }).count(), 0)
  } finally { await context.close() }
})

test('original new-order and edit URLs open their authorized forms', async () => {
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage()
  try {
    assert.equal((await context.request.post('/api/login', { data: credentials })).status(), 200)
    const { pedido } = await (await context.request.post('/api/pedidos', { data: { cliente: 'ENLACES QA', orden_compra: `ENLACE-${Date.now()}`, fecha_entrega: '2090-01-01T12:00', items: [{ codigo: 'S/C', descripcion: 'PRUEBA DE ENLACE', cantidad: 100 }] } })).json()
    await page.goto(`/pedidos/nuevo?editar=${pedido.id}`)
    await page.getByRole('dialog', { name: `Editar pedido #${pedido.id}`, exact: true }).waitFor({ timeout: 8000 })
    await page.goto('/pedidos/nuevo')
    await page.getByRole('dialog', { name: 'Nuevo pedido', exact: true }).waitFor({ timeout: 8000 })
  } finally { await context.close() }
})
