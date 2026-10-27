import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'

const base = process.env.SGP_NUEVA_TEST_URL || 'http://127.0.0.1:3001'
const target = new URL(base)
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && ['3001', '3100'].includes(target.port), 'Solo instalación descartable')
const output = new URL('../artifacts/', import.meta.url).pathname
let browser, context, page
const errors = [], nativeDialogs = []
before(async () => {
  const credentials = JSON.parse(await readFile(new URL('../backend/instance/.e2e-login.json', import.meta.url), 'utf8'))
  browser = await chromium.launch({ headless: true, executablePath: process.env.SGP_NUEVA_BROWSER_PATH })
  context = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } })
  assert.equal((await (await context.request.get('/api/health')).json()).proyecto, 'sgp-nueva-interfaz')
  assert.equal((await context.request.post('/api/login', { data: credentials })).status(), 200)
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); void dialog.dismiss() })
  await mkdir(output, { recursive: true })
})
after(async () => { await browser?.close() })

test('mobile headings keep their single action on the same compact row', async () => {
  await page.goto('/produccion')
  await page.getByRole('heading', { name: 'Producción', exact: true }).waitFor()
  const title = await page.locator('.view-heading h2').boundingBox()
  const action = await page.locator('.view-heading').getByRole('button', { name: 'Actualizar' }).boundingBox()
  assert.ok(title && action && Math.abs(title.y - action.y) < 20, 'El título y Actualizar deben compartir fila en móvil')
})
test('mobile navigation stays opaque and above the shade in both themes', async () => {
  for (const theme of ['light', 'dark']) {
    const toggle = page.getByRole('button', { name: theme === 'dark' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro', exact: true })
    if (await toggle.isVisible()) await toggle.click()
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click()
    const panel = page.locator('.sidebar.mobile-open')
    await panel.waitFor()
    const style = await panel.evaluate(element => ({ color: getComputedStyle(element).backgroundColor, z: Number(getComputedStyle(element).zIndex), width: element.getBoundingClientRect().width }))
    assert.ok(!style.color.startsWith('rgba(') || style.color.endsWith(', 1)'))
    assert.ok(style.z > await page.locator('.sidebar-shade').evaluate(element => Number(getComputedStyle(element).zIndex)))
    assert.ok(style.width <= 390)
    await page.screenshot({ path: `${output}menu-${theme}-390.png` })
    await panel.getByRole('button', { name: 'Cerrar menú', exact: true }).click()
  }
})
test('the floating modal close remains visible after scrolling on a phone', async () => {
  await page.goto('/pedidos')
  await page.getByRole('button', { name: 'Nuevo pedido', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo pedido' })
  await dialog.getByLabel('Filas', { exact: true }).fill('8')
  await dialog.locator('.dialog-content').evaluate(element => { element.scrollTop = element.scrollHeight })
  const box = await dialog.getByRole('button', { name: 'Cerrar ventana' }).boundingBox()
  assert.ok(box && box.y >= 0 && box.y + box.height <= 844 && box.x >= 0 && box.x + box.width <= 390)
  await page.screenshot({ path: `${output}ventana-movil-cierre.png` })
  await dialog.getByRole('button', { name: 'Cerrar ventana' }).click()
  const confirmation = page.getByRole('alertdialog')
  if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: 'Descartar cambios' }).click()
})
test('every module fits a mobile viewport and returns no browser errors', async () => {
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 })
    for (const route of ['monitor', 'pedidos', 'produccion', 'gantt', 'calculadora', 'preacabados', 'inventario', 'operaciones', 'reportes', 'configuracion']) {
      await page.goto(`/${route}`)
      await page.getByRole('heading', { level: 2 }).first().waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `${route} debe caber a ${width}px`)
    }
  }
  await page.goto('/gantt')
  await page.locator('.planning-agenda').waitFor()
  await page.screenshot({ path: `${output}planificador-movil-360.png`, fullPage: true })
  assert.deepEqual(nativeDialogs, [], 'Todas las confirmaciones deben pertenecer a la interfaz')
  assert.deepEqual(errors, [])
})

test('desktop content clears the sidebar after resizing and collapsing it', async () => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const collapsed of [false, true, false]) {
    if (await page.locator('.sidebar').evaluate(element => element.classList.contains('collapsed')) !== collapsed) {
      await page.getByRole('button', { name: 'Alternar barra lateral', exact: true }).click()
    }
    await page.waitForFunction(expectedWidth => {
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
      const content = document.querySelector('.page-content').getBoundingClientRect()
      return Math.abs(sidebar.width - expectedWidth) < 1 && content.left >= sidebar.right - 1
    }, collapsed ? 78 : 244)
    const header = await page.locator('.view-heading h2').boundingBox()
    const sidebar = await page.locator('.sidebar').boundingBox()
    assert.ok(header && sidebar && header.x >= sidebar.x + sidebar.width, 'La barra no debe tapar el título ni el contenido')
  }
  await page.screenshot({ path: `${output}planificador-escritorio.png`, fullPage: true })
})
