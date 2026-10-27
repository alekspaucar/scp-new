import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const base = process.env.SGP_NUEVA_TEST_URL || 'http://localhost:3000'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'La comprobación final solo consulta la instalación local')
const browser = await chromium.launch({ headless: true, executablePath: process.env.SGP_NUEVA_BROWSER_PATH })
const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 960 } })
try {
  const response = await context.request.get('/api/health')
  assert.equal(response.status(), 200)
  assert.equal((await response.json()).proyecto, 'sgp-nueva-interfaz')
  const installation = await (await context.request.get('/api/instalacion')).json()
  assert.equal(typeof installation.requiere_configuracion, 'boolean')
  assert.equal((await context.request.get('/api/pedidos')).status(), 401)
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('heading', { name: installation.requiere_configuracion ? 'Crea tu acceso' : 'Ingresa a Proprint', exact: true }).waitFor()
  await page.getByRole('button', { name: installation.requiere_configuracion ? 'Crear acceso' : 'Ingresar', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  await mkdir(join(process.cwd(), 'artifacts'), { recursive: true })
  await page.screenshot({ path: join(process.cwd(), 'artifacts/instalacion-final.png'), fullPage: true })
  console.log(JSON.stringify({ url: base, api: 'ok', primeraCuentaPendiente: installation.requiere_configuracion, pedidosSinSesion: 401, javascriptErrors: errors }, null, 2))
} finally { await browser.close() }
