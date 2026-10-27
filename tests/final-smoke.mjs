import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const base = 'http://localhost:3000'
const browser = await chromium.launch({ headless: true, executablePath: process.env.SGP_NUEVA_BROWSER_PATH })
const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 960 } })
try {
  const response = await context.request.get('/api/health')
  assert.equal(response.status(), 200)
  assert.equal((await response.json()).proyecto, 'sgp-nueva-interfaz')
  const installation = await (await context.request.get('/api/instalacion')).json()
  assert.equal(installation.requiere_configuracion, true, 'La entrega inicial debe permitir al dueño elegir su primera cuenta')
  assert.equal((await context.request.get('/api/pedidos')).status(), 401)
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('heading', { name: 'Prepara tu espacio de trabajo', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Crear mi acceso', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  await mkdir(join(process.cwd(), 'artifacts'), { recursive: true })
  await page.screenshot({ path: join(process.cwd(), 'artifacts/instalacion-final.png'), fullPage: true })
  console.log(JSON.stringify({ url: base, api: 'ok', primeraCuentaPendiente: true, pedidosSinSesion: 401, javascriptErrors: errors, datosDePruebaCopiados: false }, null, 2))
} finally { await browser.close() }
