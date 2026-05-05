/**
 * Auth utility — cloud call wrapper + session management.
 *
 * getApp() can return undefined when called during App() construction
 * (e.g. inside onLaunch). Every function that touches globalData must
 * guard against this.
 */

function getAppInstance() {
  try {
    return getApp({ allowDefault: true })
  } catch (_) {
    return null
  }
}

function getGlobalData() {
  const app = getAppInstance()
  if (app && app.globalData) return app.globalData
  return null
}

function isFunctionMissingError(err) {
  const message = String(err?.errMsg || err?.message || err || '')
  return message.includes('FunctionName parameter could not be found')
}

function getFriendlyError(err, fallback = '请求失败，请稍后重试') {
  if (isFunctionMissingError(err)) {
    return '云函数未部署，请先上传并部署 userAuth / vocabApi'
  }
  return err?.result?.msg || err?.message || fallback
}

async function callCloud(name, data, retry = 2) {
  let count = 0
  let lastErr = null
  while (count <= retry) {
    try {
      const res = await wx.cloud.callFunction({ name, data })
      if (res.result && res.result.code === -1) {
        throw new Error(res.result.msg || '请求失败')
      }
      return res.result || res
    } catch (err) {
      lastErr = err
      count += 1
      if (count > retry) break
      // Exponential backoff: 500ms, 1000ms, 1500ms ...
      await new Promise((resolve) => setTimeout(resolve, count * 500))
    }
  }
  throw lastErr
}

function saveSession(payload) {
  const session = {
    userInfo: payload.userInfo,
    sessionToken: payload.sessionToken,
    sessionExpiresAt: payload.sessionExpiresAt
  }

  // Always persist to storage first (this never fails)
  wx.setStorageSync('userSession', session)
  wx.setStorageSync('userInfo', payload.userInfo)

  // Update globalData if app instance is available
  const gd = getGlobalData()
  if (gd) {
    gd.userInfo = payload.userInfo
    gd.sessionToken = payload.sessionToken
    gd.sessionExpiresAt = payload.sessionExpiresAt
    gd.isLoggedIn = true
  }
}

function clearSession() {
  // Always clear storage first
  try {
    wx.removeStorageSync('userSession')
    wx.removeStorageSync('userInfo')
  } catch (_) { /* storage clear should not throw */ }

  // Update globalData if app instance is available
  const gd = getGlobalData()
  if (gd) {
    gd.userInfo = null
    gd.sessionToken = ''
    gd.sessionExpiresAt = 0
    gd.isLoggedIn = false
  }
}

function restoreSession() {
  const session = wx.getStorageSync('userSession')
  if (!session || !session.sessionToken) {
    clearSession()
    return null
  }
  if (Number(session.sessionExpiresAt || 0) < Date.now()) {
    clearSession()
    return null
  }

  // Update globalData if app instance is available
  const gd = getGlobalData()
  if (gd) {
    gd.userInfo = session.userInfo
    gd.sessionToken = session.sessionToken
    gd.sessionExpiresAt = session.sessionExpiresAt
    gd.isLoggedIn = true
  }

  return session
}

module.exports = {
  callCloud,
  saveSession,
  clearSession,
  restoreSession,
  getFriendlyError,
  isFunctionMissingError
}
