const Auth = require('../../utils/auth')
const app = getApp()

Page({
  data: {
    loading: true,
    loadingMore: false,
    error: '',
    vocabList: [],
    stats: { total: 0, mastered: 0, today: 0 },
    page: 1,
    pageSize: 10,
    hasMore: true,
    userInfo: null,
    boundDevice: null,
    sessionToken: ''
  },

  onShow() {
    this.loadBoundDevice()
    this.bootstrap()
  },

  loadBoundDevice() {
    // Read from storage first, fall back to globalData
    const stored = wx.getStorageSync('boundDevice')
    const app = getApp()
    const device = stored || (app && app.globalData && app.globalData.boundDevice) || null
    this.setData({ boundDevice: device })
  },

  onPullDownRefresh() {
    this.bootstrap()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadList(false)
    }
  },

  async bootstrap() {
    const session = Auth.restoreSession()
    if (!session) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    this.setData({ userInfo: session.userInfo, loading: true, error: '', sessionToken: session.sessionToken })
    try {
      await Auth.callCloud('userAuth', {
        action: 'verifySession',
        sessionToken: session.sessionToken
      })
      await this.refreshAll(true)
    } catch (err) {
      console.error('verifySession error', err)
      Auth.clearSession()
      app.showToast(Auth.getFriendlyError(err, '登录已失效，请重新登录'))
      wx.reLaunch({ url: '/pages/login/login' })
    }
  },

  async refreshAll(reset = true) {
    if (reset) {
      this.setData({ page: 1, vocabList: [], hasMore: true })
    }
    this.setData({ loading: true, error: '' })
    try {
      const statsRes = await Auth.callCloud('vocabApi', { action: 'stats', scope: 'mine', sessionToken: this.data.sessionToken })
      this.setData({ stats: statsRes.data || { total: 0, mastered: 0, today: 0 } })
      await this.loadList(true)
    } catch (err) {
      console.error('refreshAll error', err)
      this.setData({ error: Auth.getFriendlyError(err, '单词数据加载失败') })
    } finally {
      this.setData({ loading: false })
      wx.stopPullDownRefresh()
    }
  },

  async loadList(reset = false) {
    const { page, pageSize, vocabList, hasMore } = this.data
    if (!hasMore && !reset) return
    this.setData({ loadingMore: !reset })
    try {
      const result = await Auth.callCloud('vocabApi', {
        action: 'list',
        scope: 'mine',
        page,
        pageSize,
        sessionToken: this.data.sessionToken
      })
      const data = result.data || {}
      const merged = reset ? (data.list || []) : vocabList.concat(data.list || [])
      const total = data.total || merged.length
      this.setData({
        vocabList: merged,
        page: page + 1,
        hasMore: merged.length < total
      })
    } catch (err) {
      console.error('loadList error', err)
      this.setData({ error: Auth.getFriendlyError(err, '单词列表加载失败') })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  async markMastered(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showLoading({ title: '更新中', mask: true })
    try {
      await Auth.callCloud('vocabApi', {
        action: 'updateStatus',
        recordId: id,
        newStatus: 'mastered',
        sessionToken: this.data.sessionToken
      })
      wx.hideLoading()
      this.refreshAll(true)
      app.showToast('已标记为掌握', 'success')
    } catch (err) {
      console.error('markMastered error', err)
      wx.hideLoading()
      app.showToast(Auth.getFriendlyError(err, '更新失败'))
    }
  },

  retry() {
    this.bootstrap()
  },

  async logout() {
    const token = app.globalData.sessionToken
    try {
      if (token) {
        await Auth.callCloud('userAuth', {
          action: 'logout',
          sessionToken: token
        }, 0)
      }
    } catch (err) {
      console.error('logout error', err)
    }
    Auth.clearSession()
    wx.reLaunch({ url: '/pages/index/index' })
  },

  goDeviceBind() {
    wx.navigateTo({ url: '/pages/device-bind/device-bind' })
  },

  goAiResult() {
    wx.navigateTo({ url: '/pages/ai-result/ai-result' })
  }
})
