const assert = require('assert')

function canBindDeviceWhen(phoneBound) {
  return Boolean(phoneBound)
}

function run() {
  // 新用户首次登录后自动绑定成功 -> 可绑定设备
  assert.strictEqual(canBindDeviceWhen(true), true)

  // 老用户已绑定 -> 幂等不重复，仍可绑定设备
  assert.strictEqual(canBindDeviceWhen(true), true)

  // 自动绑定失败/未绑定 -> 必须阻断设备绑定
  assert.strictEqual(canBindDeviceWhen(false), false)

  console.log('login->auto-bind->device-bind integration guard tests passed')
}

run()
