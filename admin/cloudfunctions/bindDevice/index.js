const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const BINDINGS = 'device_bindings'
const USERS = 'users'
const PHONE_BINDINGS = 'phone_bindings'

function ok(data = {}, msg = 'ok') {
  return { code: 0, msg, data }
}

function fail(msg = '请求失败', statusCode = -1) {
  return { code: -1, msg, statusCode }
}

function parseBody(event) {
  if (!event) return {}
  if (event.body) {
    try {
      return typeof event.body === 'string' ? JSON.parse(event.body) : event.body
    } catch (err) {
      return {}
    }
  }
  return event
}

function normalizeDeviceId(input) {
  return String(input || '').trim().toUpperCase()
}

function validateDeviceId(input) {
  return /^[A-Z0-9_-]{8,32}$/.test(input)
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    const msg = String(err && err.message ? err.message : err)
    if (!msg.includes('exists') && !msg.includes('exist')) {
      throw err
    }
  }
}

async function writeLog(payload) {
  try {
    await db.collection('device_binding_logs').add({
      data: {
        ...payload,
        created_at: db.serverDate(),
        created_at_ms: Date.now()
      }
    })
  } catch (err) {
    console.error('write binding log failed', err)
  }
}

async function getLoginUser(sessionToken) {
  const res = await db.collection(USERS).where({
    sessionToken: String(sessionToken || '').trim(),
    status: 'active'
  }).limit(1).get()
  const user = res.data[0]
  if (!user) return null
  if (Number(user.sessionExpiresAt || 0) < Date.now()) return null
  return user
}

exports.main = async (event) => {
  const body = parseBody(event)
  const sessionToken = String(body.sessionToken || '').trim()
  const deviceId = normalizeDeviceId(body.device_id || body.Device_ID || body.deviceId)

  /* ── Phase 1: Input validation ── */
  if (!sessionToken) {
    console.warn('[bindDevice] Missing session token')
    return fail('缺少会话信息，请重新登录', 401)
  }
  if (!validateDeviceId(deviceId)) {
    console.warn('[bindDevice] Malformed Device_ID:', deviceId)
    return fail('Device_ID 格式不正确', 400)
  }

  let userId = null
  let userPhone = ''

  try {
    /* ── Phase 2: Infrastructure readiness ── */
    await ensureCollection(BINDINGS)
    await ensureCollection('device_binding_logs')
    await ensureCollection(PHONE_BINDINGS)

    /* ── Phase 3: Session & identity verification ── */
    const user = await getLoginUser(sessionToken)
    if (!user) {
      console.warn('[bindDevice] Invalid/expired session, deviceId:', deviceId)
      await writeLog({ device_id: deviceId, result: 'invalid_session' })
      return fail('登录状态已失效，请重新登录', 401)
    }
    userId = user._id
    userPhone = String(user.phone || '').trim()
    const phoneHash = String(user.phoneHash || '').trim()

    if (!userPhone || !phoneHash) {
      console.warn('[bindDevice] Phone not bound for user:', userId)
      await writeLog({ device_id: deviceId, user_id: userId, result: 'phone_not_bound' })
      return fail('当前账号手机号未自动绑定，请重新登录后再试', 412)
    }

    const phoneBindingRes = await db.collection(PHONE_BINDINGS).doc(phoneHash).get().catch(() => ({ data: null }))
    if (!phoneBindingRes.data || phoneBindingRes.data.userId !== userId) {
      console.warn('[bindDevice] Phone binding mismatch, user:', userId, 'phone:', userPhone)
      await writeLog({ device_id: deviceId, user_id: userId, user_phone: userPhone, result: 'phone_binding_mismatch' })
      return fail('手机号绑定状态异常，请重新登录', 412)
    }

    /* ── Phase 4: Idempotent binding logic ── */
    const nowMs = Date.now()
    const existing = await db.collection(BINDINGS).where({ device_id: deviceId }).limit(1).get()

    if (existing.data.length === 0) {
      /* ── Case 1: Device not yet bound — execute binding ── */
      console.log('[bindDevice] Case 1 - New binding: device=', deviceId, 'user=', userId)

      const addRes = await db.collection(BINDINGS).add({
        data: {
          device_id: deviceId,
          user_id: userId,
          user_phone: userPhone,
          bind_time: db.serverDate(),
          bind_time_ms: nowMs,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })

      await writeLog({
        device_id: deviceId,
        user_id: userId,
        user_phone: userPhone,
        result: 'bound',
        case: 'new_binding'
      })

      console.log('[bindDevice] Binding created, docId:', addRes._id)
      return ok({
        id: addRes._id,
        device_id: deviceId,
        user_id: userId,
        user_phone: userPhone,
        already_bound: false
      }, '绑定成功')
    }

    /* ── Device exists — check ownership ── */
    const boundRecord = existing.data[0]
    const boundUserId = boundRecord.user_id || ''

    if (boundUserId === userId) {
      /* ── Case 2: Already bound to the same user (idempotent success) ── */
      console.log('[bindDevice] Case 2 - Already bound to same user: device=', deviceId, 'user=', userId)

      // Update the bind_time to reflect this re-affirmation attempt
      await db.collection(BINDINGS).doc(boundRecord._id).update({
        data: {
          updated_at: db.serverDate(),
          bind_time_ms: nowMs
        }
      }).catch((updateErr) => {
        console.warn('[bindDevice] Failed to update bind_time on re-affirm:', updateErr.message)
      })

      await writeLog({
        device_id: deviceId,
        user_id: userId,
        user_phone: userPhone,
        result: 'already_bound_same_user',
        case: 'idempotent_success'
      })

      return ok({
        id: boundRecord._id,
        device_id: deviceId,
        user_id: userId,
        user_phone: userPhone,
        already_bound: true
      }, '设备已绑定到您的账户')
    }

    /* ── Case 3: Bound to a different user ── */
    console.warn('[bindDevice] Case 3 - Device bound to different user: device=', deviceId,
                 'requestUser=', userId, 'boundUser=', boundUserId)

    await writeLog({
      device_id: deviceId,
      user_id: userId,
      user_phone: userPhone,
      bound_user_id: boundUserId,
      result: 'already_bound_different_user',
      case: 'conflict'
    })

    return fail('该设备已被其他账户绑定', 409)

  } catch (err) {
    const message = String(err && err.message ? err.message : err)
    console.error('[bindDevice] Unexpected error:', message, err)

    // Handle race-condition duplicate writes (e.g. unique index violation)
    if (message.includes('duplicate')) {
      await writeLog({
        device_id: deviceId,
        user_id: userId,
        user_phone: userPhone,
        result: 'duplicate_key',
        error: message
      })
      return fail('设备已被绑定', 409)
    }

    await writeLog({
      device_id: deviceId,
      user_id: userId,
      user_phone: userPhone,
      result: 'error',
      error: message
    })
    return fail('绑定失败，请稍后重试', 500)
  }
}
