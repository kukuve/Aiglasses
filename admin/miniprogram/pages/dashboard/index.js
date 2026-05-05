Page({
  data: {
    loading: false,
    stats: { total: 0, active: 0, todayLogin: 0, weekLogin: 0 },
    records: [],
    statusOptions: ['全部', 'active'],
    statusIndex: 0
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true })
    try {
      const status = this.data.statusIndex === 0 ? 'all' : (this.data.statusOptions[this.data.statusIndex] || 'all')
      const [statsRes, listRes] = await Promise.allSettled([
        this.callCloudSafe('userAuth', { action: 'userStats' }, 7000),
        this.callCloudSafe('userAuth', { action: 'listUsers', status, pageSize: 50 }, 7000)
      ])

      const rawList = listRes.status === 'fulfilled' ? (listRes.value?.data?.list || []) : []
      const records = rawList.map((item) => ({
        ...item,
        createdAtText: this.formatTime(item.createdAt),
        lastLoginAtText: this.formatTime(item.lastLoginAt)
      }))

      const stats = statsRes.status === 'fulfilled'
        ? (statsRes.value?.data || { total: 0, active: 0, todayLogin: 0, weekLogin: 0 })
        : this.data.stats

      this.setData({
        stats,
        records
      })

      if (statsRes.status === 'rejected' || listRes.status === 'rejected') {
        wx.showToast({ title: '部分数据超时，已降级展示', icon: 'none' })
      }
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onStatusChange(e) {
    this.setData({ statusIndex: Number(e.detail.value) })
    this.refresh()
  },

  goSuperAdmin() {
    wx.navigateTo({ url: '/pages/super-admin/index' })
  },

  goSuperAdminByUser(e) {
    const userId = String(e.currentTarget.dataset.userid || '').trim()
    if (!userId) {
      wx.showToast({ title: '缺少用户ID', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/super-admin/index?userId=${encodeURIComponent(userId)}` })
  },

  async callCloudSafe(name, data, timeoutMs = 7000) {
    const timeoutTask = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
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
    return `${y}-${m}-${d} ${hh}:${mm}`
  }
})
