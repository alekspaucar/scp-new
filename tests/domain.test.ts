import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccess, parseEcuadorDate, countdown, progressOf } from '../lib/domain.ts'

test('a read-only employee cannot edit and an absent permission fails closed', () => {
  const user = { id: 1, username: 'consulta', rol: 'empleado', permisos: { pedidos: 'ver' } }
  assert.equal(canAccess(user, 'pedidos'), true)
  assert.equal(canAccess(user, 'pedidos', 'editar'), false)
  assert.equal(canAccess(user, 'inventario'), false)
  assert.equal(canAccess(null, 'pedidos'), false)
})

test('Ecuador dates denote UTC minus five including legacy display dates', () => {
  assert.equal(parseEcuadorDate('2026-10-24T14:30')?.toISOString(), '2026-10-24T19:30:00.000Z')
  assert.equal(parseEcuadorDate('24/10/2026 14:30')?.toISOString(), '2026-10-24T19:30:00.000Z')
  assert.equal(parseEcuadorDate('invalid'), null)
})

test('a deadline elapsed by one second is overdue while a future hour counts down', () => {
  const now = Date.parse('2026-10-24T19:30:00Z')
  assert.equal(countdown('2026-10-24T14:29:59', now), 'Retrasado')
  assert.equal(countdown('2026-10-24T15:30:00', now), '1 h 0 min')
})

test('partial quantities contribute fractionally and suspended items are excluded', () => {
  assert.equal(progressOf([
    { cantidad: 100, estado_item: 'pendiente', modo_entregas_parciales: true, cantidad_entregada_total: 25 },
    { cantidad: 100, estado_item: 'listo' },
    { cantidad: 100, estado_item: 'suspendido' },
  ]), 62.5)
})
