const Auth = require('../../utils/auth')
const app = getApp()

/* Default model IDs per provider */
const DEFAULT_MODELS = {
  deepseek: 'deepseek-chat',
  gpt4v: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  qwen: 'qwen-vl-plus',
  custom: ''
}

Page({
  data: {
    loading: true,
    results: [],
    latestResult: null,
    showPopup: false,
    userInfo: null,
    sessionToken: '',

    // API selection & configuration
    apiOptions: [
      { id: 'deepseek', name: 'DeepSeek', supported: true, desc: '深度求索视觉模型', placeholder: 'sk-...' },
      { id: 'gpt4v', name: 'GPT-4 Vision', supported: true, desc: 'OpenAI GPT-4o 视觉模型', placeholder: 'sk-...' },
      { id: 'gemini', name: 'Gemini Pro', supported: true, desc: 'Google Gemini 2.0 Flash', placeholder: 'AIza...' },
      { id: 'qwen', name: '通义千问VL', supported: true, desc: '阿里云通义千问视觉模型', placeholder: 'sk-...' },
      { id: 'custom', name: '自定义模型', supported: true, desc: '使用你自己的 OpenAI 兼容 API', placeholder: '输入 API Key' }
    ],
    selectedApi: 'deepseek',
    showApiPicker: false,

    // API Key config panel
    showApiConfig: false,
    configProvider: '',           // which provider is being configured
    configApiKey: '',             // input value for API key
    configModelId: '',            // input value for model ID
    configModelName: '',          // custom: user-defined model display name
    configEndpoint: '',           // custom: user-defined API endpoint URL
    configModelPlaceholder: '',   // default model hint
    configSaving: false,
    configTesting: false,
    providerConfigs: {},          // { deepseek: { configured, masked_key, model_id }, ... }

    deviceId: ''
  },

  _watcher: null,

  onLoad() {
    this.bootstrap()
  },

  onPullDownRefresh() {
    this.loadHistory().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  onUnload() {
    this.closeWatcher()
  },

  onHide() {
    this.closeWatcher()
  },

  onShow() {
    if (!this._watcher && this.data.userInfo) {
      this.startWatcher()
    }
  },

  async bootstrap() {
    const session = Auth.restoreSession()
    if (!session) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    this.setData({
      userInfo: session.userInfo,
      sessionToken: session.sessionToken,
      loading: true
    })

    try {
      await Auth.callCloud('userAuth', {
        action: 'verifySession',
        sessionToken: session.sessionToken
      })
    } catch (err) {
      Auth.clearSession()
      app.showToast('登录已失效，请重新登录')
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    // Ensure the devices collection exists before querying it
    await this.ensureDevicesCollection()

    // Load API config and history in parallel
    await Promise.all([
      this.loadApiConfig(),
      this.loadHistory()
    ])

    // Then start real-time watcher
    this.startWatcher()
    this.setData({ loading: false })
  },

  /* ── Ensure devices collection exists ── */
  async ensureDevicesCollection() {
    try {
      const dbRef = wx.cloud.database()
      await dbRef.collection('devices').limit(1).get()
    } catch (err) {
      const errMsg = String(err?.errCode || '') + String(err?.errMsg || err?.message || '')
      // -502005 = collection not exists
      if (errMsg.includes('-502005') || errMsg.includes('not exist')) {
        console.warn('devices collection does not exist yet, will show empty state')
        this._devicesCollectionMissing = true
      }
    }
  },

  /* ── Load user's API configuration ── */
  async loadApiConfig() {
    try {
      const res = await Auth.callCloud('saveApiConfig', {
        action: 'get',
        sessionToken: this.data.sessionToken
      })

      if (res && res.data) {
        this.setData({
          selectedApi: res.data.selected_provider || 'deepseek',
          providerConfigs: res.data.providers || {}
        })
      }
    } catch (err) {
      const msg = String(err?.errMsg || err?.message || '')
      if (msg.includes('timeout')) {
        console.warn('loadApiConfig timeout, using defaults')
      } else if (msg.includes('FunctionName parameter could not be found') || msg.includes('not found')) {
        console.warn('saveApiConfig cloud function not deployed yet')
      } else {
        console.warn('loadApiConfig error:', err)
      }
      // Non-critical — continue with defaults
    }
  },

  /* ── Load historical results from devices collection ── */
  async loadHistory() {
    // Skip if collection doesn't exist yet
    if (this._devicesCollectionMissing) {
      this.setData({ results: [] })
      return
    }

    try {
      const dbRef = wx.cloud.database()
      const res = await dbRef.collection('devices')
        .orderBy('upload_time_ms', 'desc')
        .limit(20)
        .get()

      const results = (res.data || []).map(item => this.formatRecord(item))
      this.setData({ results })
    } catch (err) {
      const errMsg = String(err?.errCode || '') + String(err?.errMsg || err?.message || '')
      if (errMsg.includes('-502005') || errMsg.includes('not exist')) {
        // Collection doesn't exist yet — not an error, just empty
        this._devicesCollectionMissing = true
        this.setData({ results: [] })
      } else {
        console.error('loadHistory error', err)
      }
    }
  },

  /* ── Real-time watcher on devices collection ── */
  startWatcher() {
    // Skip if collection doesn't exist yet
    if (this._devicesCollectionMissing) {
      // Retry periodically in case the collection gets created
      this._watcherRetryTimer = setTimeout(() => {
        this._devicesCollectionMissing = false
        this.ensureDevicesCollection().then(() => {
          if (!this._devicesCollectionMissing) {
            this.loadHistory()
            this.startWatcher()
          }
        })
      }, 10000)
      return
    }

    this.closeWatcher()

    try {
      const dbRef = wx.cloud.database()
      this._watcher = dbRef.collection('devices')
        .orderBy('upload_time_ms', 'desc')
        .limit(20)
        .watch({
          onChange: (snapshot) => {
            if (!snapshot.docs || !snapshot.docs.length) return

            const results = snapshot.docs.map(item => this.formatRecord(item))
            const newData = { results }

            // Detect new record (type === 'add' in docChanges)
            const addChanges = (snapshot.docChanges || []).filter(
              c => c.dataType === 'add' || c.queueType === 'enqueue'
            )
            if (addChanges.length > 0) {
              const newest = this.formatRecord(addChanges[0].doc || snapshot.docs[0])
              newData.latestResult = newest
              newData.showPopup = true
            }

            this.setData(newData)
          },
          onError: (err) => {
            console.error('Watcher error:', err)
            const errMsg = String(err?.errCode || '') + String(err?.errMsg || err?.message || '')
            if (errMsg.includes('-502005') || errMsg.includes('not exist')) {
              this._devicesCollectionMissing = true
            }
            // Retry after 5 seconds
            setTimeout(() => this.startWatcher(), 5000)
          }
        })
    } catch (err) {
      console.error('startWatcher error:', err)
      setTimeout(() => this.startWatcher(), 5000)
    }
  },

  closeWatcher() {
    if (this._watcherRetryTimer) {
      clearTimeout(this._watcherRetryTimer)
      this._watcherRetryTimer = null
    }
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
  },

  /* ── Format a DB record for display ── */
  formatRecord(item) {
    const ai = item.ai_result || {}
    const time = item.upload_time_ms
      ? new Date(item.upload_time_ms).toLocaleString('zh-CN')
      : ''

    return {
      _id: item._id,
      device_id: item.device_id || '',
      image_url: item.image_url || '',
      file_id: item.file_id || '',
      description: ai.description || '无描述',
      scene: ai.scene || '',
      objects: (ai.objects || []).join('、'),
      tags: ai.tags || [],
      confidence: ai.confidence || '',
      ai_model: item.ai_model || 'deepseek',
      time: time,
      status: item.status || '',
      words_count: (ai.words && ai.words.length) || 0
    }
  },

  /* ── Close popup ── */
  closePopup() {
    this.setData({ showPopup: false })
  },

  /* ── No-op handler for catchtap on modal cards (prevents event propagation) ── */
  noop() {},

  /* ── Tap on config mask background closes the modal ── */
  onConfigMaskTap() {
    this.closeApiConfig()
  },

  /* ── API Picker ── */
  toggleApiPicker() {
    this.setData({ showApiPicker: !this.data.showApiPicker })
  },

  selectApi(e) {
    const id = e.currentTarget.dataset.id
    const option = this.data.apiOptions.find(o => o.id === id)
    if (!option || !option.supported) return

    this.setData({ selectedApi: id, showApiPicker: false })

    // Save selected provider to cloud
    this.saveSelectedProvider(id)
  },

  async saveSelectedProvider(providerId) {
    try {
      await Auth.callCloud('saveApiConfig', {
        action: 'save',
        sessionToken: this.data.sessionToken,
        selectedProvider: providerId
      })
      wx.showToast({ title: `已切换到 ${this.getProviderName(providerId)}`, icon: 'success' })
    } catch (err) {
      console.error('saveSelectedProvider error:', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  getProviderName(id) {
    if (id === 'custom') {
      const cfg = this.data.providerConfigs.custom || {}
      return cfg.model_name || '自定义模型'
    }
    const opt = this.data.apiOptions.find(o => o.id === id)
    return opt ? opt.name : id
  },

  /* ── API Key Configuration Panel ── */
  openApiConfig(e) {
    const providerId = e.currentTarget.dataset.id
    const existingConfig = this.data.providerConfigs[providerId] || {}
    this.setData({
      showApiConfig: true,
      configProvider: providerId,
      configApiKey: '',
      configModelId: existingConfig.model_id || '',
      configModelName: existingConfig.model_name || '',
      configEndpoint: existingConfig.endpoint || '',
      configModelPlaceholder: DEFAULT_MODELS[providerId] || '',
      showApiPicker: false
    })
  },

  closeApiConfig() {
    this.setData({
      showApiConfig: false,
      configProvider: '',
      configApiKey: '',
      configModelId: '',
      configModelName: '',
      configEndpoint: '',
      configModelPlaceholder: '',
      configSaving: false,
      configTesting: false
    })
  },

  onApiKeyInput(e) {
    this.setData({ configApiKey: e.detail.value })
  },

  onModelIdInput(e) {
    this.setData({ configModelId: e.detail.value })
  },

  onModelNameInput(e) {
    this.setData({ configModelName: e.detail.value })
  },

  onEndpointInput(e) {
    this.setData({ configEndpoint: e.detail.value })
  },

  /* ── Test API Key ── */
  async testApiKey() {
    const { configProvider, configApiKey, configModelId, configEndpoint } = this.data
    if (!configApiKey || configApiKey.trim().length < 10) {
      wx.showToast({ title: '请输入有效的 API Key', icon: 'none' })
      return
    }

    if (configProvider === 'custom' && (!configEndpoint || configEndpoint.trim().length < 10)) {
      wx.showToast({ title: '请输入有效的 API 端点地址', icon: 'none' })
      return
    }

    this.setData({ configTesting: true })

    try {
      const res = await Auth.callCloud('saveApiConfig', {
        action: 'testKey',
        sessionToken: this.data.sessionToken,
        provider: configProvider,
        apiKey: configApiKey.trim(),
        modelId: configModelId.trim() || undefined,
        endpoint: configEndpoint.trim() || undefined
      })

      wx.showToast({ title: res.msg || '验证成功', icon: 'success', duration: 2000 })
    } catch (err) {
      const msg = err.message || '验证失败'
      wx.showModal({
        title: '验证失败',
        content: msg,
        showCancel: false
      })
    } finally {
      this.setData({ configTesting: false })
    }
  },

  /* ── Save API Key ── */
  async saveApiKey() {
    const { configProvider, configApiKey, configModelId, configEndpoint, configModelName } = this.data
    if (!configApiKey || configApiKey.trim().length < 10) {
      wx.showToast({ title: '请输入有效的 API Key', icon: 'none' })
      return
    }

    if (configProvider === 'custom' && (!configEndpoint || configEndpoint.trim().length < 10)) {
      wx.showToast({ title: '请输入有效的 API 端点地址', icon: 'none' })
      return
    }

    this.setData({ configSaving: true })

    try {
      await Auth.callCloud('saveApiConfig', {
        action: 'save',
        sessionToken: this.data.sessionToken,
        provider: configProvider,
        apiKey: configApiKey.trim(),
        modelId: configModelId.trim() || DEFAULT_MODELS[configProvider] || '',
        endpoint: configEndpoint.trim() || undefined,
        modelName: configModelName.trim() || undefined,
        selectedProvider: configProvider
      })

      wx.showToast({ title: '保存成功', icon: 'success' })

      // Refresh config display
      await this.loadApiConfig()
      this.closeApiConfig()
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ configSaving: false })
    }
  },

  /* ── Delete API Key ── */
  async deleteApiKey(e) {
    const providerId = e.currentTarget.dataset.id

    const { confirm } = await new Promise(resolve => {
      wx.showModal({
        title: '确认删除',
        content: `确定要删除 ${this.getProviderName(providerId)} 的 API Key 吗？`,
        success: resolve
      })
    })

    if (!confirm) return

    try {
      await Auth.callCloud('saveApiConfig', {
        action: 'delete',
        sessionToken: this.data.sessionToken,
        provider: providerId
      })

      wx.showToast({ title: '已删除', icon: 'success' })
      await this.loadApiConfig()
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
  },

  /* ── Preview image ── */
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  /* ── Navigation ── */
  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  goWords() {
    wx.navigateTo({ url: '/pages/words/words' })
  }
})
