const Validator = require('../../utils/validator')
const Auth = require('../../utils/auth')
const app = getApp()

function goWordsPage() {
  wx.reLaunch({
    url: '/pages/words/words'
  })
}

Page({
  data: {
    account: '',
    password: '',
    showPassword: false,
    rememberMe: false,
    accountFocus: false,
    passwordFocus: false,
    accountError: false,
    passwordError: false,
    accountErrorMessage: '',
    passwordErrorMessage: '',
    isLoading: false
  },

  onLoad() {
    const savedAccount = wx.getStorageSync('savedAccount')
    if (savedAccount) {
      this.setData({
        account: savedAccount,
        rememberMe: true
      })
    }
    if (app.globalData.isLoggedIn) {
      goWordsPage()
    }
  },

  onAccountInput(e) {
    this.setData({
      account: e.detail.value,
      accountError: false,
      accountErrorMessage: ''
    })
  },

  onPasswordInput(e) {
    this.setData({
      password: e.detail.value,
      passwordError: false,
      passwordErrorMessage: ''
    })
  },

  onAccountFocus() {
    this.setData({ accountFocus: true })
  },

  onAccountBlur() {
    this.setData({ accountFocus: false })
  },

  onPasswordFocus() {
    this.setData({ passwordFocus: true })
  },

  onPasswordBlur() {
    this.setData({ passwordFocus: false })
  },

  clearAccount() {
    this.setData({
      account: '',
      accountError: false,
      accountErrorMessage: ''
    })
  },

  togglePassword() {
    this.setData({
      showPassword: !this.data.showPassword
    })
  },

  toggleRemember() {
    this.setData({
      rememberMe: !this.data.rememberMe
    })
  },

  forgotPassword() {
    app.showToast('请先联系客服或重新注册测试账号')
  },

  async handleLogin() {
    const { account, password, rememberMe } = this.data
    const validation = Validator.validateLogin(account, password)

    if (!validation.valid) {
      const field = validation.message.includes('账号') || validation.message.includes('手机号') ? 'account' : 'password'
      this.setData({
        [`${field}Error`]: true,
        [`${field}ErrorMessage`]: validation.message
      })
      return
    }

    this.setData({ isLoading: true })
    app.showLoading('登录中...')

    try {
      const result = await Auth.callCloud('userAuth', {
        action: 'login',
        account: account.trim(),
        password
      })

      if (rememberMe) {
        wx.setStorageSync('savedAccount', account.trim())
      } else {
        wx.removeStorageSync('savedAccount')
      }

      app.saveSession(result.data)
      app.hideLoading()
      this.setData({ isLoading: false, password: '' })
      app.showToast('登录成功', 'success')
      setTimeout(() => {
        goWordsPage()
      }, 500)
    } catch (err) {
      console.error('login error', err)
      app.hideLoading()
      this.setData({ isLoading: false, password: '' })
      app.showToast(Auth.getFriendlyError(err, '登录失败'))
    }
  },

  goToRegister() {
    wx.navigateTo({
      url: '/pages/register/register'
    })
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
