import test from 'node:test'
import assert from 'node:assert/strict'
import nextConfig from '../next.config.mjs'

test('the proxy rejects the previous backend port even with leading zeroes', async () => {
  const previous = process.env.SGP_NUEVA_PORT
  try {
    process.env.SGP_NUEVA_PORT = '05001'
    const getRewrites = nextConfig.rewrites
    assert.ok(getRewrites)
    await assert.rejects(async () => await getRewrites(), /Puerto inválido/)
  } finally {
    if (previous === undefined) delete process.env.SGP_NUEVA_PORT
    else process.env.SGP_NUEVA_PORT = previous
  }
})
