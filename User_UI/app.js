const Auth = require('./utils/auth')

App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
    env: 'cloud1-d9gof7sc438491e13',
    sessionToken: '',
    sessionExpiresAt: 0
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用基础库 2.2.3 及以上版本以使用云能力')
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true
      })
    }

    Auth.restoreSession()
  },

  showToast(title, icon = 'none', duration = 2000) {
    wx.showToast({
      title,
      icon,
      duration
    })
  },

  showLoading(title = '加载中...') {
    wx.showLoading({
      title,
      mask: true
    })
  },

  hideLoading() {
    wx.hideLoading()
  },

  saveSession(payload) {
    Auth.saveSession(payload)
  },

  clearSession() {
    Auth.clearSession()
  }
})