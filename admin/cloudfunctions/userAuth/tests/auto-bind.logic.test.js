const assert = require('assert')
const helpers = require('./helpers')

function run() {
  assert.strictEqual(helpers.resolveAutoBindDecision('', 'u1'), 'create')
  assert.strictEqual(helpers.resolveAutoBindDecision(null, 'u1'), 'create')
  assert.strictEqual(helpers.resolveAutoBindDecision('u1', 'u1'), 'noop')
  assert.strictEqual(helpers.resolveAutoBindDecision('u2', 'u1'), 'conflict')

  assert.strictEqual(helpers.normalizePhoneNumber('13800138000'), '+8613800138000')
  assert.strictEqual(helpers.normalizePhoneNumber('+86 138-0013-8000'), '+8613800138000')
  assert.strictEqual(helpers.normalizePhoneNumber('bad-phone'), '')

  console.log('auto-bind logic tests passed')
}

run()
