const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const USERS = 'users'
const CODES = 'auth_codes'
const PHONE_BINDINGS = 'phone_bindings'
const BINDING_AUDIT_LOGS = 'binding_audit_logs'
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000
const CODE_TTL = 5 * 60 * 1000
const RESEND_INTERVAL = 60 * 1000
const HASH_SECRET = process.env.AUTH_HASH_SECRET || 'AIGlass_Auth_Secret'
const EXPOSE_VERIFY_CODE = process.env.EXPOSE_VERIFY_CODE !== 'false'
const PASSWORD_ENCRYPT_SECRET = process.env.PASSWORD_ENCRYPT_SECRET || `${HASH_SECRET}_Password_Encrypt`
const SUPER_ADMIN_KEY = process.env.SUPER_ADMIN_KEY || 'Glass@Admin66'

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function randomText(length = 16) {
  return crypto.randomBytes(length).toString('hex')
}

function createAesKey() {
  return crypto.createHash('sha256').update(String(PASSWORD_ENCRYPT_SECRET)).digest()
}

function encryptText(content) {
  const text = String(content || '')
  const iv = crypto.randomBytes(16)
  const key = createAesKey()
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

function decryptText(payload) {
  const raw = String(payload || '')
  if (!raw.includes(':')) return ''
  const [ivHex, dataHex] = raw.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(dataHex, 'hex')
  const key = createAesKey()
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

function normalizePhoneNumber(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const compact = raw.replace(/[\s-]/g, '')
  if (compact.startsWith('+')) {
    const normalized = `+${compact.slice(1).replace(/\D/g, '')}`
    if (/^\+\d{8,20}$/.test(normalized)) return normalized
    return ''
  }
  const digits = compact.replace(/\D/g, '')
  if (/^1\d{10}$/.test(digits)) return `+86${digits}`
  if (/^\d{8,20}$/.test(digits)) return `+${digits}`
  return ''
}

function phoneHash(phoneNormalized) {
  return sha256(`phone:${String(phoneNormalized || '').trim()}:${HASH_SECRET}`)
}

function maskPhone(phoneNormalized) {
  const value = String(phoneNormalized || '')
  if (value.length <= 7) return '***'
  return `${value.slice(0, 4)}****${value.slice(-3)}`
}

function getPhoneQueryCandidates(input) {
  const normalized = normalizePhoneNumber(input)
  if (!normalized) return null
  const candidates = new Set()
  candidates.add(normalized)
  const digits = normalized.replace(/^\+/, '')
  candidates.add(digits)
  if (normalized.startsWith('+86') && digits.length >= 11) {
    candidates.add(digits.slice(2))
  }
  return {
    normalized,
    hashed: phoneHash(normalized),
    plainCandidates: Array.from(candidates).filter(Boolean)
  }
}

async function findActiveUserByPhone(input) {
  const phoneData = getPhoneQueryCandidates(input)
  if (!phoneData) return null

  const byHash = await db.collection(USERS).where({ phoneHash: phoneData.hashed, status: 'active' }).limit(1).get()
  if (byHash.data && byHash.data.length) return byHash.data[0]

  for (const plainPhone of phoneData.plainCandidates) {
    const byPlain = await db.collection(USERS).where({ phone: plainPhone, status: 'active' }).limit(1).get()
    if (byPlain.data && byPlain.data.length) return byPlain.data[0]
  }
  return null
}

function resolveAutoBindDecision(existingBindingUserId, currentUserId) {
  if (!existingBindingUserId) return 'create'
  if (existingBindingUserId === currentUserId) return 'noop'
  return 'conflict'
}

async function autoBindPhoneForUser(user, phoneInput, source = 'login') {
  const normalized = normalizePhoneNumber(phoneInput)
  if (!normalized) {
    throw new Error('手机号格式不正确，无法自动绑定')
  }
  const hashed = phoneHash(normalized)
  const phoneMasked = maskPhone(normalized)
  const userId = user && user._id ? user._id : ''
  if (!userId) {
    throw new Error('缺少用户信息，无法自动绑定')
  }

  const bindingDoc = await db.collection(PHONE_BINDINGS).doc(hashed).get().catch(() => ({ data: null }))
  const existingUserId = bindingDoc && bindingDoc.data ? String(bindingDoc.data.userId || '') : ''
  const decision = resolveAutoBindDecision(existingUserId, userId)
  if (decision === 'conflict') {
    await writeBindingAudit('auto_bind_conflict', {
      source,
      userId,
      existingUserId,
      phoneMasked
    })
    throw new Error('该手机号已绑定其他账号')
  }

  const nowMs = Date.now()
  if (decision === 'create') {
    try {
      await db.collection(PHONE_BINDINGS).add({
        data: {
          _id: hashed,
          accountId: user.accountId || user._id,
          userId,
          phoneMasked,
          createdAt: db.serverDate(),
          createdAtMs: nowMs
        }
      })
    } catch (err) {
      const message = String(err && err.message ? err.message : err)
      if (!message.includes('duplicate')) {
        await writeBindingAudit('auto_bind_create_error', { source, userId, phoneMasked, message })
        throw err
      }
      const latest = await db.collection(PHONE_BINDINGS).doc(hashed).get().catch(() => ({ data: null }))
      if (!latest.data || latest.data.userId !== userId) {
        await writeBindingAudit('auto_bind_duplicate_conflict', {
          source,
          userId,
          existingUserId: latest && latest.data ? latest.data.userId : '',
          phoneMasked
        })
        throw new Error('该手机号已绑定其他账号')
      }
    }
  }

  await db.collection(USERS).doc(userId).update({
    data: {
      phone: normalized,
      phoneHash: hashed,
      phoneMasked,
      updatedAt: db.serverDate()
    }
  })

  await writeBindingAudit('auto_bind_success', {
    source,
    userId,
    phoneMasked,
    mode: decision
  })

  return { phone: normalized, phoneHash: hashed, phoneMasked, mode: decision }
}

async function writeBindingAudit(action, payload = {}) {
  try {
    await db.collection(BINDING_AUDIT_LOGS).add({
      data: {
        action,
        payload,
        createdAt: db.serverDate(),
        createdAtMs: Date.now()
      }
    })
  } catch (err) {
    console.error('writeBindingAudit failed', err)
  }
}

function hashPassword(password, salt) {
  return sha256(`${password}:${salt}:${HASH_SECRET}`)
}

function createSessionToken() {
  return randomText(24)
}

function createCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    const msg = String(err || '')
    if (!msg.includes('exists') && !msg.includes('exist')) {
      throw err
    }
  }
}

async function ensureCollections() {
  await ensureCollection(USERS)
  await ensureCollection(CODES)
  await ensureCollection(PHONE_BINDINGS)
  await ensureCollection(BINDING_AUDIT_LOGS)
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

function ok(data = {}, msg = 'ok') {
  return { code: 0, msg, data }
}

function fail(msg = '请求失败') {
  return { code: -1, msg }
}

function toTimestamp(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
  }
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object' && value.$date) {
    return new Date(value.$date).getTime()
  }
  return 0
}

function formatUserForAdmin(user) {
  const createdAtMs = Number(user.createdAtMs || toTimestamp(user.createdAt) || 0)
  const lastLoginAtMs = Number(user.lastLoginAtMs || toTimestamp(user.lastLoginAt) || 0)
  return {
    id: user._id,
    userId: user._id,
    account: user.account || user.accountId || '',
    accountId: user.accountId || user._id,
    phone: user.phoneMasked || maskPhone(user.phone || ''),
    status: user.status || 'active',
    loginCount: Number(user.loginCount || 0),
    createdAt: createdAtMs,
    lastLoginAt: lastLoginAtMs,
    openid: user.openid || ''
  }
}

async function findUserByAccount(account) {
  const normalized = String(account || '').trim()
  if (!normalized) return null
  const byPhone = await findActiveUserByPhone(normalized)
  if (byPhone) {
    return byPhone
  }
  const [byAccount, byAccountId] = await Promise.all([
    db.collection(USERS).where({ account: normalized, status: 'active' }).limit(1).get(),
    db.collection(USERS).where({ accountId: normalized, status: 'active' }).limit(1).get()
  ])
  return byAccount.data[0] || byAccountId.data[0] || null
}

async function sendCode(phone) {
  const normalizedPhone = normalizePhoneNumber(phone)
  if (!normalizedPhone) return fail('手机号格式不正确')
  const normalizedPhoneHash = phoneHash(normalizedPhone)
  const now = Date.now()
  const latestRes = await db.collection(CODES).where({ phoneHash: normalizedPhoneHash, used: false }).orderBy('expiresAt', 'desc').limit(5).get()
  const activeRecord = latestRes.data.find((item) => Number(item.expiresAt || 0) > now)

  if (activeRecord) {
    const createdAtMs = Number(activeRecord.createdAtMs || (Number(activeRecord.expiresAt || 0) - CODE_TTL) || 0)
    const cooldownLeft = RESEND_INTERVAL - (now - createdAtMs)
    if (cooldownLeft > 0) {
      return ok({
        expiresIn: Math.max(Number(activeRecord.expiresAt || 0) - now, 0),
        cooldownLeft,
        devCode: EXPOSE_VERIFY_CODE ? String(activeRecord.code || '') : ''
      }, '验证码已发送，请稍后再试')
    }
  }

  const code = createCode()
  await db.collection(CODES).add({
    data: {
      phoneHash: normalizedPhoneHash,
      phoneMasked: maskPhone(normalizedPhone),
      code,
      used: false,
      expiresAt: now + CODE_TTL,
      createdAt: db.serverDate(),
      createdAtMs: now
    }
  })

  return ok({
    expiresIn: CODE_TTL,
    cooldownLeft: RESEND_INTERVAL,
    devCode: EXPOSE_VERIFY_CODE ? code : ''
  }, '验证码已发送')
}

async function verifyCode(phone, code) {
  const normalizedPhone = normalizePhoneNumber(phone)
  if (!normalizedPhone) return fail('手机号格式不正确')
  const normalizedPhoneHash = phoneHash(normalizedPhone)
  const now = Date.now()
  const normalizedCode = String(code || '').trim()
  const res = await db.collection(CODES).where({ phoneHash: normalizedPhoneHash, code: normalizedCode, used: false }).orderBy('expiresAt', 'desc').limit(5).get()
  const records = res.data || []

  if (!records.length) {
    return fail('验证码错误')
  }

  const record = records.find((item) => Number(item.expiresAt || 0) > now)
  if (!record) {
    return fail('验证码已过期，请重新获取')
  }

  await db.collection(CODES).doc(record._id).update({
    data: {
      used: true,
      usedAt: db.serverDate()
    }
  })
  return ok()
}

async function register(body, wxContext) {
  const phoneInput = String(body.phone || '').trim()
  const phone = normalizePhoneNumber(phoneInput)
  const phoneHashed = phoneHash(phone)
  const password = String(body.password || '')
  const code = String(body.code || '').trim()

  if (!phone) {
    return fail('手机号格式不正确')
  }
  if (!/^\d{6}$/.test(code)) {
    return fail('验证码格式不正确')
  }
  if (password.length < 6 || password.length > 20) {
    return fail('密码长度需在6-20位之间')
  }

  const bindingRes = await db.collection(PHONE_BINDINGS).doc(phoneHashed).get().catch(() => null)
  if (bindingRes && bindingRes.data) {
    return fail('该手机号已被绑定，请使用其他号码')
  }

  const codeRes = await verifyCode(phone, code)
  if (codeRes.code !== 0) return codeRes

  const salt = randomText(8)
  const accountId = `acc_${randomText(8)}`
  const sessionToken = createSessionToken()
  const sessionExpiresAt = Date.now() + SESSION_TTL
  const user = {
    phone,
    phoneHash: phoneHashed,
    phoneMasked: maskPhone(phone),
    account: phone,
    accountId,
    passwordHash: hashPassword(password, salt),
    passwordSalt: salt,
    passwordRawEncrypted: encryptText(password),
    passwordRawUpdatedAtMs: Date.now(),
    status: 'active',
    sessionToken,
    sessionExpiresAt,
    lastLoginAt: db.serverDate(),
    lastLoginAtMs: Date.now(),
    loginCount: 1,
    createdAt: db.serverDate(),
    createdAtMs: Date.now(),
    updatedAt: db.serverDate(),
    openid: wxContext.OPENID || ''
  }
  let addRes
  try {
    addRes = await db.collection(USERS).add({ data: user })
    await autoBindPhoneForUser({ _id: addRes._id, accountId }, phone, 'register')
    await writeBindingAudit('register_bind', {
      accountId,
      userId: addRes._id,
      phoneMasked: maskPhone(phone)
    })
  } catch (err) {
    if (addRes && addRes._id) {
      await db.collection(USERS).doc(addRes._id).remove().catch(() => {})
    }
    const message = String(err && err.message ? err.message : err)
    if (message.includes('duplicate key')) {
      return fail('该手机号已被绑定，请使用其他号码')
    }
    throw err
  }
  return ok({
    userInfo: {
      userId: addRes._id,
      phone: maskPhone(phone),
      account: phone,
      accountId
    },
    sessionToken,
    sessionExpiresAt
  }, '注册成功')
}

async function login(body, wxContext) {
  const account = String(body.account || '').trim()
  const password = String(body.password || '')
  if (!account || !password) {
    return fail('请输入账号和密码')
  }
  const user = await findUserByAccount(account)
  if (!user) {
    return fail('账号或密码错误')
  }

  const hashed = hashPassword(password, user.passwordSalt)
  if (hashed !== user.passwordHash) {
    return fail('账号或密码错误')
  }

  try {
    const accountAsPhone = normalizePhoneNumber(account)
    const fallbackPhone = normalizePhoneNumber(user.phone || '')
    const candidatePhone = accountAsPhone || fallbackPhone
    if (candidatePhone) {
      const bindRes = await autoBindPhoneForUser(user, candidatePhone, 'login')
      user.phone = bindRes.phone
      user.phoneHash = bindRes.phoneHash
      user.phoneMasked = bindRes.phoneMasked
    } else {
      await writeBindingAudit('auto_bind_skipped_no_phone', { userId: user._id })
    }
  } catch (bindErr) {
    console.error('autoBindPhoneForUser in login failed', bindErr)
    return fail(bindErr.message || '手机号自动绑定失败，请稍后重试')
  }

  const sessionToken = createSessionToken()
  const sessionExpiresAt = Date.now() + SESSION_TTL
  const nextLoginCount = Number(user.loginCount || 0) + 1
  await db.collection(USERS).doc(user._id).update({
    data: {
      sessionToken,
      sessionExpiresAt,
      lastLoginAt: db.serverDate(),
      lastLoginAtMs: Date.now(),
      loginCount: nextLoginCount,
      passwordRawEncrypted: encryptText(password),
      passwordRawUpdatedAtMs: Date.now(),
      updatedAt: db.serverDate(),
      openid: wxContext.OPENID || user.openid || ''
    }
  })

  return ok({
    userInfo: {
      userId: user._id,
      phone: user.phoneMasked || maskPhone(user.phone),
      account: user.account,
      accountId: user.accountId || user._id
    },
    sessionToken,
    sessionExpiresAt
  }, '登录成功')
}

async function verifySession(body) {
  const sessionToken = String(body.sessionToken || '').trim()
  if (!sessionToken) {
    return fail('缺少会话信息')
  }
  const res = await db.collection(USERS).where({ sessionToken, status: 'active' }).limit(1).get()
  const user = res.data[0]
  if (!user || Number(user.sessionExpiresAt || 0) < Date.now()) {
    return fail('登录状态已失效，请重新登录')
  }
  return ok({
    userInfo: {
      userId: user._id,
      phone: user.phoneMasked || maskPhone(user.phone),
      account: user.account,
      accountId: user.accountId || user._id
    },
    sessionExpiresAt: user.sessionExpiresAt
  })
}

async function logout(body) {
  const sessionToken = String(body.sessionToken || '').trim()
  if (!sessionToken) return ok({}, '已退出')
  const res = await db.collection(USERS).where({ sessionToken }).limit(1).get()
  const user = res.data[0]
  if (user) {
    await db.collection(USERS).doc(user._id).update({
      data: {
        sessionToken: '',
        sessionExpiresAt: 0,
        updatedAt: db.serverDate()
      }
    })
  }
  return ok({}, '已退出')
}

function assertSuperAdmin(body) {
  const adminKey = String(body.adminKey || '').trim()
  if (!SUPER_ADMIN_KEY) {
    throw new Error('未配置 SUPER_ADMIN_KEY')
  }
  if (!adminKey || adminKey !== SUPER_ADMIN_KEY) {
    throw new Error('无权限访问敏感数据')
  }
}

async function getUserSensitive(body) {
  assertSuperAdmin(body)
  const userId = String(body.userId || '').trim()
  const phoneInput = String(body.phone || '').trim()
  let user = null
  let resolvedUserId = userId

  if (!userId && !phoneInput) {
    return fail('缺少 userId 或 phone')
  }

  if (userId) {
    const res = await db.collection(USERS).doc(userId).get().catch(() => ({ data: null }))
    user = res.data || null
  } else {
    resolvedUserId = ''
  }

  if (!user && phoneInput) {
    user = await findActiveUserByPhone(phoneInput)
    resolvedUserId = user ? user._id : resolvedUserId
  }

  if (!user) return fail('用户不存在')

  const passwordPlain = decryptText(user.passwordRawEncrypted || '')
  await writeBindingAudit('admin_sensitive_query', {
    userId: resolvedUserId,
    accountId: user.accountId || user._id,
    phoneMasked: user.phoneMasked || maskPhone(user.phone || ''),
    hasPasswordPlain: Boolean(passwordPlain)
  })

  return ok({
    userId: resolvedUserId,
    account: user.account || '',
    accountId: user.accountId || user._id,
    phone: user.phoneMasked || maskPhone(user.phone || ''),
    passwordPlain: passwordPlain || '',
    updatedAt: Number(user.passwordRawUpdatedAtMs || 0)
  })
}

async function listUsers(body) {
  const page = Math.max(Number(body.page || 1), 1)
  const pageSize = Math.min(Math.max(Number(body.pageSize || 20), 1), 100)
  const status = String(body.status || 'all')
  const skip = (page - 1) * pageSize

  const where = {}
  if (status && status !== 'all') {
    where.status = status
  }

  const [listRes, countRes] = await Promise.all([
    db.collection(USERS).where(where).orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get(),
    db.collection(USERS).where(where).count()
  ])

  const list = (listRes.data || []).map(formatUserForAdmin)
  const total = Number(countRes.total || 0)
  return ok({
    list,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total
  })
}

async function userStats() {
  const now = Date.now()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartMs = todayStart.getTime()
  const weekStartMs = now - 7 * 24 * 60 * 60 * 1000

  const [allRes, activeRes, todayLoginRes, weekLoginRes] = await Promise.all([
    db.collection(USERS).count(),
    db.collection(USERS).where({ status: 'active' }).count(),
    db.collection(USERS).where({ lastLoginAtMs: _.gte(todayStartMs) }).count(),
    db.collection(USERS).where({ lastLoginAtMs: _.gte(weekStartMs) }).count()
  ])

  return ok({
    total: Number(allRes.total || 0),
    active: Number(activeRes.total || 0),
    todayLogin: Number(todayLoginRes.total || 0),
    weekLogin: Number(weekLoginRes.total || 0)
  })
}

async function retrieveAccountByPhone(body) {
  const phone = normalizePhoneNumber(body.phone || '')
  const code = String(body.code || '').trim()
  if (!phone) return fail('手机号格式不正确')
  if (!/^\d{6}$/.test(code)) return fail('验证码格式不正确')

  const codeRes = await verifyCode(phone, code)
  if (codeRes.code !== 0) return fail('校验失败，请重试')

  const user = await findActiveUserByPhone(phone)
  if (!user) {
    return fail('校验失败，请重试')
  }
  await writeBindingAudit('retrieve_account_by_phone', {
    userId: user._id,
    accountId: user.accountId || user._id,
    phoneMasked: user.phoneMasked || maskPhone(phone)
  })
  return ok({
    accountId: user.accountId || user._id,
    phone: user.phoneMasked || maskPhone(phone)
  }, '查询成功')
}

exports.main = async (event) => {
  try {
    const body = parseBody(event)
    const action = body.action || 'verifySession'
    const wxContext = cloud.getWXContext()

    if (action === 'sendCode') {
      await ensureCollections()
      const phone = String(body.phone || '').trim()
      if (!normalizePhoneNumber(phone)) {
        return fail('手机号格式不正确')
      }
      return await sendCode(phone)
    }
    if (action === 'register') {
      await ensureCollections()
      return await register(body, wxContext)
    }
    if (action === 'login') {
      await ensureCollections()
      return await login(body, wxContext)
    }
    if (action === 'verifySession') {
      return await verifySession(body)
    }
    if (action === 'logout') {
      return await logout(body)
    }
    if (action === 'listUsers') {
      return await listUsers(body)
    }
    if (action === 'userStats') {
      return await userStats()
    }
    if (action === 'getUserSensitive') {
      return await getUserSensitive(body)
    }
    if (action === 'retrieveAccountByPhone') {
      await ensureCollections()
      return await retrieveAccountByPhone(body)
    }

    return fail('不支持的操作')
  } catch (err) {
    console.error('userAuth error', err)
    return fail(err.message || '服务异常，请稍后重试')
  }
}

exports.__test__ = {
  normalizePhoneNumber,
  maskPhone,
  phoneHash,
  resolveAutoBindDecision
}
