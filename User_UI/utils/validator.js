const Validator = {
  normalizePhone(phone) {
    const raw = String(phone || '').trim()
    if (!raw) return ''
    const compact = raw.replace(/[\s-]/g, '')
    if (compact.startsWith('+')) {
      const normalized = `+${compact.slice(1).replace(/\D/g, '')}`
      return /^\+\d{8,20}$/.test(normalized) ? normalized : ''
    }
    const digits = compact.replace(/\D/g, '')
    if (/^1\d{10}$/.test(digits)) return `+86${digits}`
    return /^\d{8,20}$/.test(digits) ? `+${digits}` : ''
  },

  isPhone(phone) {
    return Boolean(this.normalizePhone(phone))
  },

  isPassword(pwd) {
    return pwd.length >= 6 && pwd.length <= 20
  },

  isCode(code) {
    return /^\d{6}$/.test(code)
  },

  isAccount(account) {
    return account.length >= 4 && account.length <= 20
  },

  validateLogin(account, password) {
    if (!account || account.trim() === '') {
      return { valid: false, message: '请输入手机号/账号' }
    }
    if (!password || password.trim() === '') {
      return { valid: false, message: '请输入密码' }
    }
    if (password.length < 6) {
      return { valid: false, message: '密码长度不能少于6位' }
    }
    return { valid: true, message: '' }
  },

  validateRegister(phone, code, password, confirmPassword) {
    if (!phone || phone.trim() === '') {
      return { valid: false, message: '请输入手机号' }
    }
    if (!this.isPhone(phone)) {
      return { valid: false, message: '手机号格式不正确' }
    }
    if (!code || code.trim() === '') {
      return { valid: false, message: '请输入验证码' }
    }
    if (!this.isCode(code)) {
      return { valid: false, message: '验证码格式不正确（6位数字）' }
    }
    if (!password || password.trim() === '') {
      return { valid: false, message: '请设置密码' }
    }
    if (!this.isPassword(password)) {
      return { valid: false, message: '密码长度需在6-20位之间' }
    }
    if (!confirmPassword || confirmPassword.trim() === '') {
      return { valid: false, message: '请确认密码' }
    }
    if (password !== confirmPassword) {
      return { valid: false, message: '两次输入的密码不一致' }
    }
    return { valid: true, message: '' }
  }
}

module.exports = Validator