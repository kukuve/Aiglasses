const cloud = require('wx-server-sdk')
const fetch = require('node-fetch')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const API_CONFIGS = 'user_api_configs'
const USERS = 'users'

/* ── Supported AI providers with default models ──────────── */
const VALID_PROVIDERS = ['deepseek', 'gpt4v', 'gemini', 'qwen', 'custom']

const DEFAULT_MODELS = {
  deepseek: 'deepseek-chat',
  gpt4v: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  qwen: 'qwen-vl-plus'
}

const DEFAULT_ENDPOINTS = {
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  gpt4v: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  custom: ''
}

/* ── Helpers ─────────────────────────────────────────────── */

function fail(code, msg) {
  return { code, msg, data: null }
}

function ok(data, msg) {
  return { code: 0, msg: msg || 'success', data }
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    const msg = String(err && err.message ? err.message : err)
    if (!msg.includes('exists') && !msg.includes('exist')) throw err
  }
}

/* ── Validate session directly against users collection ──── */

async function validateSession(sessionToken) {
  if (!sessionToken) return null

  try {
    const res = await db.collection(USERS)
      .where({ sessionToken: sessionToken, status: 'active' })
      .limit(1)
      .get()

    const user = res.data && res.data[0]
    if (!user) return null

    // Check session expiry
    if (Number(user.sessionExpiresAt || 0) < Date.now()) return null

    return {
      userId: user._id,
      phone: user.phone || '',
      accountId: user.accountId || user._id
    }
  } catch (err) {
    console.error('Session validation failed:', err.message || err)
    return null
  }
}

/* ── Main Handler ────────────────────────────────────────── */

exports.main = async (event) => {
  const { action, sessionToken } = event || {}

  await ensureCollection(API_CONFIGS)

  // testKey does not require session — skip auth for it
  if (action === 'testKey') {
    return handleTestKey(event)
  }

  /* ── Authenticate user ── */
  const user = await validateSession(sessionToken)
  if (!user) {
    return fail(-1, '登录已失效，请重新登录')
  }

  // Use userId as primary key; phone as secondary for uploadImage lookup
  const userId = user.userId
  const userPhone = user.phone || ''

  switch (action) {
    case 'save':
      return handleSave(event, userId, userPhone)
    case 'get':
      return handleGet(userId)
    case 'delete':
      return handleDelete(event, userId)
    default:
      return fail(-1, `Unknown action: ${action}`)
  }
}

/* ── Save API configuration ──────────────────────────────── */

async function handleSave(event, userId, userPhone) {
  const { provider, apiKey, modelId, endpoint, modelName, selectedProvider } = event

  if (provider && !VALID_PROVIDERS.includes(provider)) {
    return fail(-1, `不支持的 AI 提供商: ${provider}`)
  }

  if (provider && apiKey) {
    const trimmedKey = String(apiKey).trim()
    if (trimmedKey.length < 10) {
      return fail(-1, 'API Key 格式不正确，长度过短')
    }
    if (trimmedKey.length > 256) {
      return fail(-1, 'API Key 格式不正确，长度过长')
    }
  }

  // Custom provider requires endpoint
  if (provider === 'custom' && endpoint) {
    const trimmedEndpoint = String(endpoint).trim()
    if (trimmedEndpoint.length < 10 || !trimmedEndpoint.startsWith('http')) {
      return fail(-1, 'API 端点地址格式不正确，需以 http 开头')
    }
    if (trimmedEndpoint.length > 512) {
      return fail(-1, 'API 端点地址过长')
    }
  }

  if (modelId !== undefined && modelId !== null) {
    const trimmedModel = String(modelId).trim()
    if (trimmedModel.length > 128) {
      return fail(-1, '模型 ID 过长')
    }
  }

  if (modelName !== undefined && modelName !== null) {
    const trimmedName = String(modelName).trim()
    if (trimmedName.length > 64) {
      return fail(-1, '模型名称过长')
    }
  }

  try {
    // Look up by userId first, fall back to user_phone for backward compat
    let existing = await db.collection(API_CONFIGS)
      .where({ user_id: userId })
      .limit(1)
      .get()

    if (!existing.data || !existing.data.length) {
      // Backward compat: check by user_phone
      if (userPhone) {
        existing = await db.collection(API_CONFIGS)
          .where({ user_phone: userPhone })
          .limit(1)
          .get()
      }
    }

    const updateData = {
      user_id: userId,
      user_phone: userPhone,
      updated_at: db.serverDate(),
      updated_at_ms: Date.now()
    }

    if (selectedProvider && VALID_PROVIDERS.includes(selectedProvider)) {
      updateData.selected_provider = selectedProvider
    }

    if (provider) {
      const providerUpdate = { configured_at: Date.now() }

      if (apiKey) {
        providerUpdate.api_key = String(apiKey).trim()
      }

      if (modelId !== undefined && modelId !== null && String(modelId).trim()) {
        providerUpdate.model_id = String(modelId).trim()
      }

      // Custom provider: store endpoint and model_name
      if (provider === 'custom') {
        if (endpoint) {
          providerUpdate.endpoint = String(endpoint).trim()
        }
        if (modelName) {
          providerUpdate.model_name = String(modelName).trim()
        }
      }

      if (apiKey) {
        updateData[`providers.${provider}`] = providerUpdate
      } else if (modelId !== undefined) {
        updateData[`providers.${provider}.model_id`] = providerUpdate.model_id || DEFAULT_MODELS[provider]
        updateData[`providers.${provider}.configured_at`] = Date.now()
      }
    }

    if (existing.data && existing.data.length > 0) {
      await db.collection(API_CONFIGS).doc(existing.data[0]._id).update({
        data: updateData
      })
    } else {
      const newRecord = {
        user_id: userId,
        user_phone: userPhone,
        selected_provider: selectedProvider || provider || 'deepseek',
        providers: {},
        created_at: db.serverDate(),
        created_at_ms: Date.now(),
        ...updateData
      }

      if (provider && apiKey) {
        const providerRecord = {
          api_key: String(apiKey).trim(),
          model_id: (modelId && String(modelId).trim()) || DEFAULT_MODELS[provider] || '',
          configured_at: Date.now()
        }
        // Custom provider: store endpoint and model_name
        if (provider === 'custom') {
          if (endpoint) providerRecord.endpoint = String(endpoint).trim()
          if (modelName) providerRecord.model_name = String(modelName).trim()
        }
        newRecord.providers[provider] = providerRecord
      }

      await db.collection(API_CONFIGS).add({ data: newRecord })
    }

    return ok(null, 'API 配置已保存')

  } catch (err) {
    console.error('Save API config error:', err)
    return fail(-1, '保存配置失败: ' + (err.message || '未知错误'))
  }
}

/* ── Get API configuration ───────────────────────────────── */

async function handleGet(userId) {
  try {
    const res = await db.collection(API_CONFIGS)
      .where({ user_id: userId })
      .limit(1)
      .get()

    if (!res.data || !res.data.length) {
      return ok({
        selected_provider: 'deepseek',
        providers: {}
      }, '暂无配置')
    }

    const config = res.data[0]

    const maskedProviders = {}
    const providers = config.providers || {}
    for (const [key, val] of Object.entries(providers)) {
      if (val && val.api_key) {
        const k = val.api_key
        const entry = {
          configured: true,
          masked_key: k.length > 4 ? '****' + k.slice(-4) : '****',
          model_id: val.model_id || DEFAULT_MODELS[key] || '',
          configured_at: val.configured_at
        }
        // Custom provider: expose endpoint and model_name for display
        if (key === 'custom') {
          if (val.endpoint) entry.endpoint = val.endpoint
          if (val.model_name) entry.model_name = val.model_name
        }
        maskedProviders[key] = entry
      }
    }

    return ok({
      selected_provider: config.selected_provider || 'deepseek',
      providers: maskedProviders
    })

  } catch (err) {
    console.error('Get API config error:', err)
    return fail(-1, '获取配置失败')
  }
}

/* ── Delete a provider's API key ─────────────────────────── */

async function handleDelete(event, userId) {
  const { provider } = event

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return fail(-1, '无效的 AI 提供商')
  }

  try {
    const existing = await db.collection(API_CONFIGS)
      .where({ user_id: userId })
      .limit(1)
      .get()

    if (!existing.data || !existing.data.length) {
      return ok(null, '无配置可删除')
    }

    await db.collection(API_CONFIGS).doc(existing.data[0]._id).update({
      data: {
        [`providers.${provider}`]: _.remove(),
        updated_at: db.serverDate(),
        updated_at_ms: Date.now()
      }
    })

    return ok(null, `已删除 ${provider} 的 API Key`)

  } catch (err) {
    console.error('Delete API config error:', err)
    return fail(-1, '删除配置失败')
  }
}

/* ── Test API key validity ───────────────────────────────── */

async function handleTestKey(event) {
  const { provider, apiKey, modelId, endpoint } = event

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return fail(-1, '不支持的 AI 提供商')
  }

  if (!apiKey || String(apiKey).trim().length < 10) {
    return fail(-1, 'API Key 不能为空')
  }

  // Custom provider requires endpoint
  if (provider === 'custom') {
    if (!endpoint || String(endpoint).trim().length < 10 || !String(endpoint).trim().startsWith('http')) {
      return fail(-1, '自定义模型需要提供有效的 API 端点地址')
    }
  }

  const trimmedKey = String(apiKey).trim()
  const model = (modelId && String(modelId).trim()) || DEFAULT_MODELS[provider]
  const customEndpoint = provider === 'custom' ? String(endpoint).trim() : ''

  // node-fetch v2 supports timeout option natively (no AbortController needed)
  const fetchOptions = { timeout: 15000 }

  try {
    let testOk = false
    let errorMsg = ''

    if (provider === 'gemini') {
      const url = `${DEFAULT_ENDPOINTS.gemini}${model}:generateContent?key=${trimmedKey}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say "ok" in one word.' }] }],
          generationConfig: { maxOutputTokens: 10 }
        }),
        ...fetchOptions
      })
      testOk = resp.ok
      if (!testOk) {
        const text = await resp.text()
        errorMsg = `HTTP ${resp.status}: ${text.substring(0, 200)}`
      }
    } else {
      const endpointToUse = provider === 'custom' ? customEndpoint : DEFAULT_ENDPOINTS[provider]
      const resp = await fetch(endpointToUse, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${trimmedKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
          max_tokens: 10
        }),
        ...fetchOptions
      })
      testOk = resp.ok
      if (!testOk) {
        const text = await resp.text()
        errorMsg = `HTTP ${resp.status}: ${text.substring(0, 200)}`
      }
    }

    if (testOk) {
      return ok(null, `API Key 验证成功 (模型: ${model})`)
    } else {
      return fail(-1, `API Key 验证失败: ${errorMsg}`)
    }

  } catch (err) {
    if (err.type === 'request-timeout') {
      return fail(-1, '验证请求超时，请检查网络连接后重试')
    }
    return fail(-1, `验证请求失败: ${err.message || '网络错误'}`)
  }
}
