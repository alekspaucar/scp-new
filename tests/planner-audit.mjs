import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const base = process.env.SGP_NUEVA_TEST_URL || 'http://127.0.0.1:3001'
const target = new URL(base)
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && ['3001', '3100'].includes(target.port), 'Solo servicio de pruebas')
const loginPath = new URL('../backend/instance/.e2e-login.json', import.meta.url)
let browser, context, page, pending, incompatible
const errors = []
async function json(method, path, data) {
  const response = await context.request[method](`/api/${path}`, data ? { data } : {})
  const body = await response.json()
  assert.ok(response.ok(), `${path}: ${response.status()} ${JSON.stringify(body)}`)
  return body
}
before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.SGP_NUEVA_BROWSER_PATH ? { executablePath: process.env.SGP_NUEVA_BROWSER_PATH } : {}) })
  context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } })
  assert.equal((await json('get', 'health')).proyecto, 'sgp-nueva-interfaz')
  let credentials
  if ((await json('get', 'instalacion')).requiere_configuracion) {
    credentials = { username: 'verificacion-local', password: `${randomUUID()}-Aa1` }
    await json('post', 'instalacion', credentials)
    await writeFile(loginPath, JSON.stringify(credentials), { mode: 0o600 })
  } else credentials = JSON.parse(await readFile(loginPath, 'utf8'))
  await json('post', 'login', credentials)
  for (const order of await json('get', 'pedidos')) {
    if (order.cliente.startsWith('PLAN QA ')) await json('delete', `pedidos/${order.id}`)
  }
  const cliente = `PLAN QA ${randomUUID().slice(0, 8)}`
  const make = orden_compra => json('post', 'pedidos', { cliente, orden_compra, fecha_entrega: '2090-06-01T12:00', items: [{ codigo: 'S/C', descripcion: 'Reserva de revisión', cantidad: 100 }] })
  pending = (await make('PLAN-PENDIENTE')).pedido
  const codes = [`PLAN-M1-${randomUUID().slice(0, 8)}`, `PLAN-M2-${randomUUID().slice(0, 8)}`]
  for (const [index, code] of codes.entries()) await json('post', 'catalogo', { codigo: code, cliente, descripcion: code, tiempo_base_minutos: 1, maquina_requerida: index ? 'M2' : 'M1' })
  incompatible = (await json('post', 'pedidos', { cliente, orden_compra: 'PLAN-INCOMPATIBLE', fecha_entrega: '2090-06-01T12:00', items: codes.map(code => ({ codigo: code, descripcion: code, cantidad: 10 })) })).pedido
  const far = (await make('PLAN-FUTURO')).pedido
  await json('put', 'produccion/asignar-manual', { pedido_id: far.id, maquina: 'M1', fecha_inicio: '2090-05-01T12:00-05:00', duracion_minutos: 30 })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
})
after(async () => { await browser?.close() })
async function planner() {
  await page.goto('/gantt')
  await page.locator('.planning-agenda').waitFor()
}

test('pending orders are immediately available for assignment', async () => {
  await planner()
  assert.equal(await page.getByRole('button', { name: `Asignar pedido ${pending.id} de ${pending.cliente}`, exact: true }).isVisible(), true)
})
test('default assignment asks only for the machine; exact scheduling is optional', async () => {
  await planner()
  const fold = page.locator('details').filter({ has: page.getByText('Pendientes sin asignar', { exact: true }) })
  if (await fold.count() && !(await fold.getAttribute('open') !== null)) await fold.locator('summary').click()
  await page.getByRole('button', { name: `Asignar pedido ${pending.id} de ${pending.cliente}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Asignar pedido|Reserva/ })
  await dialog.waitFor()
  assert.equal(await dialog.locator('input[type=datetime-local]').isVisible(), false)
  await dialog.getByText('Elegir fecha y duración', { exact: true }).click()
  assert.equal(await dialog.locator('input[type=datetime-local]').isVisible(), true)
  await dialog.getByRole('button', { name: 'Cerrar ventana' }).click()
})
test('the timeline renders one chosen day even with a reservation years away', async () => {
  await planner()
  await page.getByText('Línea de tiempo', { exact: true }).click()
  assert.ok(await page.locator('.planning-axis > span').count() <= 8, 'La escala no debe crear miles de marcas por reservas lejanas')
  assert.equal(await page.getByLabel('Día del plan', { exact: true }).isVisible(), true)
  assert.deepEqual(errors, [])
})
test('a technically incompatible order explains the problem instead of offering a false duration', async () => {
  await planner()
  const button = page.getByRole('button', { name: `Asignar pedido ${incompatible.id} de ${incompatible.cliente}`, exact: true })
  assert.equal(await button.isDisabled(), true)
  await page.getByText(/restricciones de máquinas exclusivas incompatibles/).waitFor()
})
