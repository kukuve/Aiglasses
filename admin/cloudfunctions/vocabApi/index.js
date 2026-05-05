const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/* ── Collections ─────────────────────────────────────────── */
const VOCABULARY = 'vocabulary'
const USERS      = 'users'

/* ── Helpers ─────────────────────────────────────────────── */

function fail(code, msg) {
  return { code, data: null, msg }
}

function ok(data, msg) {
  return { code: 0, data, msg: msg || 'success' }
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    const msg = String(err && err.message ? err.message : err)
    if (!msg.includes('exists') && !msg.includes('exist')) throw err
  }
}

/* ── Validate session against users collection ───────────── */

async function validateSession(sessionToken) {
  if (!sessionToken) return null

  try {
    const res = await db.collection(USERS)
      .where({ sessionToken: sessionToken, status: 'active' })
      .limit(1)
      .get()

    const user = res.data && res.data[0]
    if (!user) return null

    if (Number(user.sessionExpiresAt || 0) < Date.now()) return null

    return {
      userId: user._id,
      phone: user.phone || ''
    }
  } catch (err) {
    console.error('Session validation failed:', err.message || err)
    return null
  }
}

/* ── Main Handler ────────────────────────────────────────── */

exports.main = async (event) => {
  const { action, sessionToken } = event || {}

  const user = await validateSession(sessionToken)
  if (!user) {
    return fail(-1, '登录已失效，请重新登录')
  }

  await ensureCollection(VOCABULARY)

  switch (action) {
    case 'list':
      return handleList(event, user)
    case 'stats':
      return handleStats(user)
    case 'updateStatus':
      return handleUpdateStatus(event, user)
    default:
      return fail(-1, `Unknown action: ${action}`)
  }
}

/* ── List vocabulary with pagination ─────────────────────── */

async function handleList(event, user) {
  const page     = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 10))
  const skip     = (page - 1) * pageSize

  try {
    // Build query filter by user phone (or user_id if available)
    const where = user.phone
      ? { user_phone: user.phone }
      : { user_id: user.userId }

    const [countRes, listRes] = await Promise.all([
      db.collection(VOCABULARY).where(where).count(),
      db.collection(VOCABULARY)
        .where(where)
        .orderBy('created_at_ms', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get()
    ])

    const total = countRes.total || 0
    const list = (listRes.data || []).map(item => ({
      id:           item._id,
      word:         item.word || '',
      phonetic:     item.phonetic || '',
      meaning:      item.meaning || '',
      sentence:     item.sentence || '',
      status:       item.status || 'new',
      review_count: item.review_count || 0,
      created_at:   item.created_at_ms || 0
    }))

    return ok({ list, total, page, pageSize })
  } catch (err) {
    console.error('handleList error:', err)
    return fail(-1, '获取单词列表失败: ' + (err.message || '未知错误'))
  }
}

/* ── Get vocabulary stats ────────────────────────────────── */

async function handleStats(user) {
  try {
    const where = user.phone
      ? { user_phone: user.phone }
      : { user_id: user.userId }

    const [totalRes, masteredRes, todayRes] = await Promise.all([
      db.collection(VOCABULARY).where(where).count(),
      db.collection(VOCABULARY).where({ ...where, status: 'mastered' }).count(),
      // Today: records created after midnight (00:00 UTC+8 → 00:00 local)
      db.collection(VOCABULARY)
        .where({
          ...where,
          created_at_ms: _.gte(getTodayStartMs())
        })
        .count()
    ])

    return ok({
      total:    totalRes.total || 0,
      mastered: masteredRes.total || 0,
      today:    todayRes.total || 0
    })
  } catch (err) {
    console.error('handleStats error:', err)
    return fail(-1, '获取统计数据失败')
  }
}

/* ── Update word status ──────────────────────────────────── */

async function handleUpdateStatus(event, user) {
  const { recordId, newStatus } = event

  if (!recordId) {
    return fail(-1, '缺少记录 ID')
  }

  const validStatuses = ['new', 'learning', 'mastered']
  if (!newStatus || !validStatuses.includes(newStatus)) {
    return fail(-1, `无效的状态: ${newStatus}`)
  }

  try {
    const res = await db.collection(VOCABULARY).doc(recordId).get()
    const record = res.data

    if (!record) {
      return fail(-1, '单词记录不存在')
    }

    // Verify ownership
    const owner = user.phone || user.userId
    const recordOwner = record.user_phone || record.user_id
    if (owner !== recordOwner) {
      return fail(-1, '无权修改此记录')
    }

    const updateData = {
      status: newStatus,
      updated_at: db.serverDate(),
      updated_at_ms: Date.now()
    }

    // Increment review count when marking as mastered
    if (newStatus === 'mastered') {
      updateData.review_count = _.inc(1)
    }

    await db.collection(VOCABULARY).doc(recordId).update({
      data: updateData
    })

    return ok({ id: recordId, status: newStatus }, '状态已更新')
  } catch (err) {
    console.error('handleUpdateStatus error:', err)
    if (err.errCode === -502003) {
      return fail(-1, '单词记录不存在')
    }
    return fail(-1, '更新状态失败')
  }
}

/* ── Get today start timestamp in ms (UTC+8) ─────────────── */

function getTodayStartMs() {
  const now = new Date()
  // UTC+8: create a date at 00:00:00 CST
  const cst = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  )
  // CST = UTC+8, so subtract 8 hours to get UTC ms
  return cst.getTime() - 8 * 3600 * 1000
}
