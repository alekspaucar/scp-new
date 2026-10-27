import test from 'node:test'
import assert from 'node:assert/strict'
import { api, ApiError } from '../lib/api.ts'

test('an expired session check does not emit another refresh and create a request loop', async () => {
  const originalFetch = globalThis.fetch
  const host = globalThis as typeof globalThis & { window?: EventTarget }
  const previousWindow = host.window, target = new EventTarget()
  let refreshEvents = 0
  target.addEventListener('sgp:session-change', () => { refreshEvents++ })
  Object.defineProperty(globalThis, 'window', { value: target, writable: true, configurable: true })
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Sin sesión' }), { status: 401 })
  try {
    await assert.rejects(api('sesion'), error => error instanceof ApiError && error.status === 401)
    assert.equal(refreshEvents, 0)
    await assert.rejects(api('pedidos'), error => error instanceof ApiError && error.status === 401)
    assert.equal(refreshEvents, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
    else Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true, writable: true })
  }
})

test('MRP validation details survive the HTTP boundary for the missing-fields view', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Completa el catálogo', datos_faltantes: [{ codigo: '9001', campos: ['ancho_rollo'] }] }), { status: 400 })
  try {
    await assert.rejects(api('reportes/mrp-lote'), error => {
      assert.ok(error instanceof ApiError)
      assert.deepEqual(error.details.datos_faltantes, [{ codigo: '9001', campos: ['ancho_rollo'] }])
      return true
    })
  } finally { globalThis.fetch = previous }
})
