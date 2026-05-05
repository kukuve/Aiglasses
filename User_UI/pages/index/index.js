const Auth = require('../../utils/auth')
const app = getApp()

Page({
  data: {
    isLoggedIn: false,
    userInfo: null
  },

  onShow() {
    const session = Auth.restoreSession()
    const isLoggedIn = !!(session && session.sessionToken)
    this.setData({
      isLoggedIn,
      userInfo: isLoggedIn ? session.userInfo : null
    })
    if (isLoggedIn) {
      wx.reLaunch({ url: '/pages/words/words' })
    }
  },

  goToLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  goToRegister() {
    wx.navigateTo({ url: '/pages/register/register' })
  },

  logout() {
    app.clearSession()
    this.setData({ isLoggedIn: false, userInfo: null })
    app.showToast('已退出登录', 'success')
  }
})
