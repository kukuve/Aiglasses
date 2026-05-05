Page({
  data: {
    loading: false,
    adminKey: '',
    userId: '',
    phone: '',
    sensitive: null
  },

  onLoad(options = {}) {
    const userId = String(options.userId || '').trim()
    if (userId) {
      this.setData({ userId })
    }
  },

  onAdminKeyInput(e) {
    this.setData({ adminKey: e.detail.value })
  },

  onUserIdInput(e) {
    this.setData({ userId: e.detail.value })
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },

  async querySensitive() {
    const adminKey = String(this.data.adminKey || '').trim()
    const userId = String(this.data.userId || '').trim()
    const phone = String(this.data.phone || '').trim()
    if (!adminKey) {
      wx.showToast({ title: '请输入管理员密钥', icon: 'none' })
      return
    }
    if (!userId && !phone) {
      wx.showToast({ title: '请输入用户ID或手机号', icon: 'none' })
      return
    }

    this.setData({ loading: true })
    try {
      const res = await this.callCloudSafe('userAuth', {
        action: 'getUserSensitive',
        adminKey,
        userId,
        phone
      }, 10000)
      const data = res?.data || {}
      this.setData({
        sensitive: {
          ...data,
          updatedAtText: this.formatTime(data.updatedAt)
        }
      })
      wx.showToast({ title: '查询成功', icon: 'success' })
    } catch (err) {
      console.error('getUserSensitive error', err)
      wx.showToast({ title: err.message || '查询失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async callCloudSafe(name, data, timeoutMs = 10000) {
    const timeoutTask = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('请求超时，请重试')), timeoutMs)
    })
    const callTask = wx.cloud.callFunction({ name, data }).then((res) => {
      if (res.result && res.result.code === -1) {
        throw new Error(res.result.msg || '请求失败')
      }
      return res.result || res
    })
    return Promise.race([callTask, timeoutTask])
  },

  formatTime(timestamp) {
    const ms = Number(timestamp || 0)
    if (!ms) return '--'
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return '--'
    const y = date.getFullYear()
    const m = `${date.getMonth() + 1}`.padStart(2, '0')
    const d = `${date.getDate()}`.padStart(2, '0')
    const hh = `${date.getHours()}`.padStart(2, '0')
    const mm = `${date.getMinutes()}`.padStart(2, '0')
    const ss = `${date.getSeconds()}`.padStart(2, '0')
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
  }
})
