const assert = require('assert')
const helpers = require('./helpers')

function run() {
  assert.strictEqual(helpers.normalizePhoneNumber('13800138000'), '+8613800138000')
  assert.strictEqual(helpers.normalizePhoneNumber('+1 415-555-2671'), '+14155552671')
  assert.strictEqual(helpers.normalizePhoneNumber('invalid'), '')

  const masked = helpers.maskPhone('+8613800138000')
  assert.ok(masked.includes('****'))
  assert.notStrictEqual(masked, '+8613800138000')

  const h1 = helpers.phoneHash('+8613800138000')
  const h2 = helpers.phoneHash('+8613800138000')
  const h3 = helpers.phoneHash('+14155552671')
  assert.strictEqual(h1, h2)
  assert.notStrictEqual(h1, h3)

  console.log('phone-binding tests passed')
}

run()
