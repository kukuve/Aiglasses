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
    phone: '',
    code: '',
    password: '',
    confirmPassword: '',
    showPassword: false,
    showConfirmPassword: false,
    agreed: false,

    phoneFocus: false,
    codeFocus: false,
    passwordFocus: false,
    confirmFocus: false,

    phoneError: false,
    codeError: false,
    passwordError: false,
    confirmError: false,

    phoneErrorMessage: '',
    codeErrorMessage: '',
    passwordErrorMessage: '',
    confirmErrorMessage: '',

    codeBtnText: '获取验证码',
    codeBtnDisabled: false,
    codeSending: false,
    codeCountdown: 60,
    codeTimer: null,

    strengthPercent: 0,
    strengthClass: '',
    strengthText: '',

    isLoading: false
  },

  onUnload() {
    if (this.data.codeTimer) {
      clearInterval(this.data.codeTimer)
    }
  },

  onLoad() {
    if (app.globalData.isLoggedIn) {
      goWordsPage()
    }
  },

  onPhoneInput(e) {
    const value = e.detail.value
    this.setData({
      phone: value,
      phoneError: false,
      phoneErrorMessage: ''
    })
    this.updateCodeBtnState(value)
  },

  onCodeInput(e) {
    const value = e.detail.value
    if (/^\d*$/.test(value)) {
      this.setData({
        code: value,
        codeError: false,
        codeErrorMessage: ''
      })
    }
  },

  onPasswordInput(e) {
    const value = e.detail.value
    this.setData({
      password: value,
      passwordError: false,
      passwordErrorMessage: ''
    })
    this.calculateStrength(value)
  },

  onConfirmInput(e) {
    const value = e.detail.value
    this.setData({
      confirmPassword: value,
      confirmError: false,
      confirmErrorMessage: ''
    })
  },

  onPhoneFocus() { this.setData({ phoneFocus: true }) },
  onPhoneBlur() { this.setData({ phoneFocus: false }) },
  onCodeFocus() { this.setData({ codeFocus: true }) },
  onCodeBlur() { this.setData({ codeFocus: false }) },
  onPasswordFocus() { this.setData({ passwordFocus: true }) },
  onPasswordBlur() { this.setData({ passwordFocus: false }) },
  onConfirmFocus() { this.setData({ confirmFocus: true }) },
  onConfirmBlur() { this.setData({ confirmFocus: false }) },

  clearPhone() {
    this.setData({
      phone: '',
      phoneError: false,
      phoneErrorMessage: ''
    })
    this.updateCodeBtnState('')
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword })
  },

  toggleConfirmPassword() {
    this.setData({ showConfirmPassword: !this.data.showConfirmPassword })
  },

  toggleAgreement() {
    this.setData({ agreed: !this.data.agreed })
  },

  updateCodeBtnState(phone) {
    if (this.data.codeSending || this.data.codeCountdown < 60) return
    this.setData({
      codeBtnDisabled: !Validator.isPhone(phone)
    })
  },

  async getVerifyCode() {
    const { phone, codeSending, codeCountdown } = this.data
    if (codeSending || codeCountdown < 60) {
      return
    }
    if (!Validator.isPhone(phone)) {
      this.setData({
        phoneError: true,
        phoneErrorMessage: '请输入正确的手机号'
      })
      return
    }

    this.setData({
      codeSending: true,
      codeBtnDisabled: true,
      codeError: false,
      codeErrorMessage: ''
    })

    try {
      const result = await Auth.callCloud('userAuth', {
        action: 'sendCode',
        phone
      })
      const devCode = result.data && result.data.devCode ? String(result.data.devCode) : ''
      this.setData({
        codeSending: false,
        code: devCode || this.data.code
      })
      this.startCountdown()
      if (devCode) {
        wx.showModal({
          title: '测试验证码',
          content: `当前开发环境验证码：${devCode}`,
          showCancel: false
        })
      } else {
        app.showToast('验证码已发送', 'success')
      }
    } catch (err) {
      console.error('sendCode error', err)
      this.setData({ codeSending: false })
      this.updateCodeBtnState(phone)
      app.showToast(Auth.getFriendlyError(err, '验证码发送失败'))
    }
  },

  startCountdown() {
    if (this.data.codeTimer) {
      clearInterval(this.data.codeTimer)
    }

    this.setData({
      codeBtnDisabled: true,
      codeCountdown: 60,
      codeBtnText: '60s'
    })

    const timer = setInterval(() => {
      const countdown = this.data.codeCountdown - 1
      if (countdown <= 0) {
        clearInterval(timer)
        this.setData({
          codeBtnDisabled: false,
          codeCountdown: 60,
          codeBtnText: '重新获取',
          codeTimer: null
        })
        this.updateCodeBtnState(this.data.phone)
      } else {
        this.setData({
          codeCountdown: countdown,
          codeBtnText: `${countdown}s`
        })
      }
    }, 1000)

    this.setData({ codeTimer: timer })
  },

  calculateStrength(password) {
    let percent = 0
    let strengthClass = ''
    let strengthText = ''

    if (!password) {
      this.setData({ strengthPercent: 0, strengthClass: '', strengthText: '' })
      return
    }

    let score = 0
    if (password.length >= 6) score += 10
    if (password.length >= 10) score += 10
    if (password.length >= 14) score += 10
    if (/[a-z]/.test(password)) score += 15
    if (/[A-Z]/.test(password)) score += 15
    if (/[0-9]/.test(password)) score += 15
    if (/[^a-zA-Z0-9]/.test(password)) score += 15
    if (password.length >= 8 && /[a-z]/.test(password) && /[0-9]/.test(password)) score += 10

    percent = Math.min(score, 100)
    if (percent < 40) {
      strengthClass = 'weak'
      strengthText = '弱'
    } else if (percent < 70) {
      strengthClass = 'medium'
      strengthText = '中'
    } else {
      strengthClass = 'strong'
      strengthText = '强'
    }

    this.setData({ strengthPercent: percent, strengthClass, strengthText })
  },

  async handleRegister() {
    if (this.data.isLoading) {
      return
    }

    const { phone, code, password, confirmPassword, agreed } = this.data
    const validation = Validator.validateRegister(phone, code, password, confirmPassword)

    if (!validation.valid) {
      const message = validation.message
      if (message.includes('手机号')) {
        this.setData({ phoneError: true, phoneErrorMessage: message })
      } else if (message.includes('验证码')) {
        this.setData({ codeError: true, codeErrorMessage: message })
      } else if (message.includes('确认') || message.includes('不一致')) {
        this.setData({ confirmError: true, confirmErrorMessage: message })
      } else {
        this.setData({ passwordError: true, passwordErrorMessage: message })
      }
      return
    }

    if (!agreed) {
      app.showToast('请先阅读并同意用户协议和隐私政策')
      return
    }

    this.setData({
      isLoading: true,
      phoneError: false,
      phoneErrorMessage: '',
      codeError: false,
      codeErrorMessage: '',
      passwordError: false,
      passwordErrorMessage: '',
      confirmError: false,
      confirmErrorMessage: ''
    })
    app.showLoading('注册中...')

    try {
      const result = await Auth.callCloud('userAuth', {
        action: 'register',
        phone,
        code,
        password
      })
      app.saveSession(result.data)
      app.hideLoading()
      this.setData({ isLoading: false, password: '', confirmPassword: '' })
      app.showToast('注册成功', 'success')
      setTimeout(() => {
        goWordsPage()
      }, 500)
    } catch (err) {
      const message = Auth.getFriendlyError(err, '注册失败')
      console.error('register error', err)
      app.hideLoading()
      this.setData({ isLoading: false, password: '', confirmPassword: '' })

      if (message.includes('手机号')) {
        this.setData({ phoneError: true, phoneErrorMessage: message })
      } else if (message.includes('验证码')) {
        this.setData({ codeError: true, codeErrorMessage: message })
      } else if (message.includes('密码')) {
        this.setData({ passwordError: true, passwordErrorMessage: message })
      }

      app.showToast(message)
    }
  },

  goToLogin() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.reLaunch({ url: '/pages/login/login' })
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
