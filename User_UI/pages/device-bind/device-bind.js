const Auth = require('../../utils/auth')

function normalizeDeviceId(input) {
  return String(input || '').trim().toUpperCase()
}

function isValidDeviceId(deviceId) {
  return /^[A-Z0-9_-]{8,32}$/.test(deviceId)
}

Page({
  data: {
    deviceId: '',
    submitting: false,
    sessionToken: ''
  },

  onLoad() {
    const app = getApp()
    const session = Auth.restoreSession()
    const token = (session && session.sessionToken) || app.globalData.sessionToken || ''
    this.setData({
      sessionToken: token
    })
  },

  onDeviceInput(e) {
    this.setData({ deviceId: normalizeDeviceId(e.detail.value) })
  },

  scanDeviceId() {
    wx.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        const raw = (res.result || '').split(/[/?#=&\s]/).find((s) => /^[A-Za-z0-9_-]{8,32}$/.test(s))
        const deviceId = normalizeDeviceId(raw || res.result)
        if (!isValidDeviceId(deviceId)) {
          wx.showToast({ title: '二维码中未识别到有效 Device_ID', icon: 'none' })
          return
        }
        this.setData({ deviceId })
      },
      fail: () => {
        wx.showToast({ title: '扫码失败，请重试', icon: 'none' })
      }
    })
  },

  async bindDevice() {
    const { sessionToken, deviceId, submitting } = this.data
    if (submitting) return
    if (!sessionToken) {
      wx.showToast({ title: '登录状态已失效，请重新登录', icon: 'none' })
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (!isValidDeviceId(deviceId)) {
      wx.showToast({ title: 'Device_ID 格式错误，应为8-32位字母数字', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '绑定中', mask: true })
    try {
      const result = await Auth.callCloud('bindDevice', {
        sessionToken,
        Device_ID: deviceId
      })
      wx.hideLoading()

      const data = (result && result.data) || {}
      const boundId = data.device_id || deviceId
      const alreadyBound = data.already_bound === true

      // Persist bound device info so the words page can display it
      wx.setStorageSync('boundDevice', { deviceId: boundId, boundAt: Date.now() })
      const app = getApp()
      if (app && app.globalData) {
        app.globalData.boundDevice = { deviceId: boundId, boundAt: Date.now() }
      }

      if (alreadyBound) {
        /* ── Case 2: Device already bound to current user (idempotent) ── */
        wx.showModal({
          title: '已绑定',
          content: `设备 ${boundId} 已绑定到您的账户，无需重复绑定`,
          showCancel: false,
          success: () => {
            wx.navigateBack({
              fail: () => wx.reLaunch({ url: '/pages/words/words' })
            })
          }
        })
      } else {
        /* ── Case 1: New binding ── */
        wx.showModal({
          title: '绑定成功',
          content: `设备 ${boundId} 已绑定`,
          showCancel: false,
          success: () => {
            wx.navigateBack({
              fail: () => wx.reLaunch({ url: '/pages/words/words' })
            })
          }
        })
      }
    } catch (err) {
      wx.hideLoading()
      /* ── Case 3: Bound to different user or other errors ── */
      wx.showModal({
        title: '绑定失败',
        content: Auth.getFriendlyError(err, '设备绑定失败，可重试或联系客服'),
        confirmText: '重试',
        cancelText: '联系客服'
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
