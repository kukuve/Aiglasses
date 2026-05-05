const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const fetch = require('node-fetch')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/* ── Collections ─────────────────────────────────────────── */
const BINDINGS       = 'device_bindings'
const LOGS           = 'device_upload_logs'
const DEVICES        = 'devices'           // AI results written here
const API_CONFIGS    = 'user_api_configs'   // User-configured API keys
const VOCABULARY     = 'vocabulary'         // Extracted words for learning
const BUCKET_PREFIX  = 'device-uploads'

/* ── AI Provider Configurations ──────────────────────────── */
const AI_PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    supportsVision: true
  },
  'gpt4v': {
    name: 'GPT-4 Vision',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    supportsVision: true
  },
  gemini: {
    name: 'Gemini Pro',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    model: 'gemini-2.0-flash',
    supportsVision: true,
    useGeminiFormat: true
  },
  qwen: {
    name: '通义千问VL',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-vl-plus',
    supportsVision: true
  }
}

const DEFAULT_PROVIDER = 'deepseek'

const VISION_PROMPT = `你是一位专业的图像识别AI助手。请仔细观察图片，识别图片中的主要内容，并返回严格的 JSON 格式：
{
  "objects": ["识别到的物体列表"],
  "scene": "场景描述",
  "description": "详细的图片内容描述（中文，50-100字）",
  "tags": ["相关标签"],
  "confidence": "high/medium/low",
  "words": [
    {"word": "English word", "phonetic": "发音音标", "meaning": "中文释义", "sentence": "包含该单词的例句"}
  ]
}
其中 words 字段请从图片中提取 3-10 个有学习价值的英文单词，包括图片中出现的物体名称、场景相关词汇等。每个单词提供音标、中文释义和一个完整的英文例句。
不允许输出任何额外文字或解释，只能输出 JSON。`

/* ── Helpers ─────────────────────────────────────────────── */

function response(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }
}

function getHeader(headers, key) {
  if (!headers) return ''
  return headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || ''
}

function normalizeDeviceId(input) {
  return String(input || '').trim().toUpperCase()
}

function cloudPath(deviceId) {
  const dt = new Date()
  const yyyy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  const hash = crypto.randomBytes(8).toString('hex')
  return `${BUCKET_PREFIX}/${yyyy}${mm}${dd}/${deviceId}/${Date.now()}_${hash}.jpg`
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    const msg = String(err && err.message ? err.message : err)
    if (!msg.includes('exists') && !msg.includes('exist')) throw err
  }
}

async function writeLog(payload) {
  try {
    await db.collection(LOGS).add({
      data: { ...payload, request_time: db.serverDate(), request_time_ms: Date.now() }
    })
  } catch (err) {
    console.error('write upload log failed', err)
  }
}

/* ── Step A: Extract image buffer from request ───────────── */

function extractImageBuffer(event) {
  // Try JSON body with base64
  if (event && event.body) {
    try {
      const text = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : String(event.body)
      const json = JSON.parse(text)
      if (json.image_base64) {
        return Buffer.from(String(json.image_base64), 'base64')
      }
    } catch (_) { /* not JSON, try raw */ }
  }

  // Raw binary body
  if (event && event.body) {
    return event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(String(event.body))
  }

  return null
}

/* ── Get user's API configuration ────────────────────────── */

async function getUserApiConfig(userPhone) {
  if (!userPhone) return null

  try {
    // First try by user_phone (stored by saveApiConfig)
    let res = await db.collection(API_CONFIGS)
      .where({ user_phone: userPhone })
      .limit(1)
      .get()

    if (res.data && res.data.length > 0) {
      return res.data[0]
    }

    // Fall back: find user by phone, then look up config by user_id
    const userRes = await db.collection('users')
      .where({ phone: userPhone, status: 'active' })
      .limit(1)
      .get()

    if (userRes.data && userRes.data.length > 0) {
      const userId = userRes.data[0]._id
      res = await db.collection(API_CONFIGS)
        .where({ user_id: userId })
        .limit(1)
        .get()

      if (res.data && res.data.length > 0) {
        return res.data[0]
      }
    }
  } catch (err) {
    console.warn('Failed to fetch user API config:', err.message)
  }

  return null
}

/* ── Call AI Vision API (multi-provider) ─────────────────── */

async function callVisionApi(imageBase64, mimeType, providerKey, apiKey, customModelId, customEndpoint) {
  // Custom provider: user-defined endpoint, OpenAI-compatible format
  if (providerKey === 'custom') {
    if (!customEndpoint) {
      throw new Error('Custom API endpoint not configured')
    }
    if (!apiKey) {
      throw new Error('API key not configured for custom model')
    }
    const modelId = customModelId || 'default'

    const messages = [
      { role: 'system', content: VISION_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张图片的内容' },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${imageBase64}` }
          }
        ]
      }
    ]

    const resp = await fetch(customEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: 0.2,
        max_tokens: 1024
      })
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`自定义模型 API error ${resp.status}: ${text}`)
    }

    const data = await resp.json()
    return parseAiResponse(data?.choices?.[0]?.message?.content, '自定义模型')
  }

  const provider = AI_PROVIDERS[providerKey]
  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerKey}`)
  }

  if (!apiKey) {
    throw new Error(`API key not configured for ${provider.name}`)
  }

  const modelId = customModelId || provider.model

  // Gemini uses a different request format
  if (provider.useGeminiFormat) {
    return callGeminiVision(imageBase64, mimeType, apiKey, provider, modelId)
  }

  // OpenAI-compatible format (DeepSeek, GPT-4V, Qwen)
  const messages = [
    { role: 'system', content: VISION_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '请识别这张图片的内容' },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${imageBase64}` }
        }
      ]
    }
  ]

  const resp = await fetch(provider.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: 0.2,
      max_tokens: 1024
    })
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`${provider.name} API error ${resp.status}: ${text}`)
  }

  const data = await resp.json()
  return parseAiResponse(data?.choices?.[0]?.message?.content, provider.name)
}

/* ── Gemini-specific API call ────────────────────────────── */

async function callGeminiVision(imageBase64, mimeType, apiKey, provider, modelId) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`
  const url = `${endpoint}?key=${apiKey}`

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: VISION_PROMPT + '\n\n请识别这张图片的内容' },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024
      }
    })
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`${provider.name} API error ${resp.status}: ${text}`)
  }

  const data = await resp.json()
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text
  return parseAiResponse(content, provider.name)
}

/* ── Parse AI response text into structured JSON ─────────── */

function parseAiResponse(content, providerName) {
  const rawText = Array.isArray(content)
    ? content.map(p => p?.text || p?.content || '').join('').trim()
    : (content || '').trim()

  if (!rawText) {
    throw new Error(`${providerName} returned empty response`)
  }

  // Extract JSON from possible markdown code block
  let jsonStr = rawText
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  try {
    return JSON.parse(jsonStr)
  } catch (err) {
    console.error(`${providerName} JSON parse error, raw:`, rawText)
    return {
      objects: [],
      scene: 'unknown',
      description: rawText,
      tags: [],
      confidence: 'low'
    }
  }
}

/* ── Write extracted vocabulary words ────────────────────── */

async function writeVocabulary(words, deviceId, userPhone, imageRecordId) {
  if (!words || !Array.isArray(words) || !words.length) return

  let now = Date.now()
  const records = []

  for (const w of words) {
    if (!w.word || !w.word.trim()) continue
    records.push({
      word:            String(w.word).trim(),
      phonetic:        String(w.phonetic || '').trim(),
      meaning:         String(w.meaning || '').trim(),
      sentence:        String(w.sentence || '').trim(),
      status:          'new',
      review_count:    0,
      user_phone:      userPhone || '',
      source_device_id: deviceId || '',
      source_image_id:  imageRecordId || '',
      created_at:      db.serverDate(),
      created_at_ms:   now
    })
    // Increment timestamp slightly so order is stable
    now += 1
  }

  try {
    // Batch insert — one by one since WeChat SDK doesn't support bulk add
    const promises = records.map(r =>
      db.collection(VOCABULARY).add({ data: r }).catch(err =>
        console.error(`Failed to insert word "${r.word}":`, err.message)
      )
    )
    const results = await Promise.all(promises)
    const successCount = results.filter(r => r && r._id).length
    console.log(`Vocabulary: ${successCount}/${records.length} words written`)
    return successCount
  } catch (err) {
    console.error('writeVocabulary error:', err.message || err)
    return 0
  }
}

async function getTempUrl(fileId) {
  try {
    const { fileList } = await cloud.getTempFileURL({ fileList: [fileId] })
    return fileList?.[0]?.tempFileURL || ''
  } catch (err) {
    console.error('getTempFileURL error', err)
    return ''
  }
}

/* ── Main Handler ────────────────────────────────────────── */

exports.main = async (event) => {
  const headers = event && event.headers ? event.headers : {}
  const deviceId = normalizeDeviceId(getHeader(headers, 'X-Device-ID'))
  const contentType = getHeader(headers, 'Content-Type') || 'application/octet-stream'

  await Promise.all([
    ensureCollection(BINDINGS),
    ensureCollection(LOGS),
    ensureCollection(DEVICES),
    ensureCollection(API_CONFIGS),
    ensureCollection(VOCABULARY)
  ])

  /* ── Validate device ID ── */
  if (!deviceId) {
    await writeLog({ device_id: '', result: 'missing_device_id', content_type: contentType })
    return response(403, { code: -1, msg: 'Invalid Device ID' })
  }

  try {
    /* ── Verify device is bound ── */
    const bindRes = await db.collection(BINDINGS).where({ device_id: deviceId }).limit(1).get()
    if (!bindRes.data.length) {
      await writeLog({ device_id: deviceId, result: 'device_not_bound', content_type: contentType })
      return response(403, { code: -1, msg: 'Device not bound' })
    }

    const bindInfo = bindRes.data[0]
    const userPhone = bindInfo.user_phone || ''

    /* ── Step A: Extract and upload image to cloud storage ── */
    const imageBuffer = extractImageBuffer(event)
    if (!imageBuffer || !imageBuffer.length) {
      await writeLog({ device_id: deviceId, result: 'empty_payload', content_type: contentType })
      return response(400, { code: -1, msg: 'Image payload is empty' })
    }

    const filePath = cloudPath(deviceId)
    const uploadRes = await cloud.uploadFile({
      cloudPath: filePath,
      fileContent: imageBuffer
    })
    const fileID = uploadRes.fileID

    console.log(`Image uploaded: ${fileID}, size=${imageBuffer.length} bytes`)

    /* ── Step B: Determine AI provider and API key ── */
    const userConfig = await getUserApiConfig(userPhone)

    let providerKey = DEFAULT_PROVIDER
    let apiKey = process.env.DEEPSEEK_API_KEY || ''
    let customModelId = ''
    let customEndpoint = ''
    let customModelName = ''

    if (userConfig) {
      // User has configured their own API settings
      const selectedProvider = userConfig.selected_provider || DEFAULT_PROVIDER
      const providerConfig = (userConfig.providers || {})[selectedProvider]

      if (providerConfig && providerConfig.api_key) {
        providerKey = selectedProvider
        apiKey = providerConfig.api_key
        customModelId = providerConfig.model_id || ''

        // Custom provider: capture endpoint and model name
        if (selectedProvider === 'custom') {
          customEndpoint = providerConfig.endpoint || ''
          customModelName = providerConfig.model_name || ''
        }

        console.log(`Using user-configured provider: ${providerKey}, model: ${customModelId || '(default)'}`)
      } else {
        console.log(`User config found but no valid key for ${selectedProvider}, falling back to default`)
      }
    }

    if (!apiKey) {
      await writeLog({ device_id: deviceId, result: 'no_api_key', content_type: contentType })
      return response(500, { code: -1, msg: 'No AI API key configured. Please set your API key in the mini program settings.' })
    }

    /* ── Step C: Get temp URL and call AI Vision API ── */
    const imageBase64 = imageBuffer.toString('base64')
    const [tempUrl, aiResult] = await Promise.all([
      getTempUrl(fileID),
      callVisionApi(imageBase64, 'image/jpeg', providerKey, apiKey, customModelId, customEndpoint)
    ])

    console.log(`${providerKey} result:`, JSON.stringify(aiResult))

    /* ── Step D: Write result to devices collection ── */
    const deviceRecord = {
      device_id: deviceId,
      user_phone: userPhone,
      file_id: fileID,
      image_url: tempUrl || fileID,
      ai_result: aiResult,
      ai_model: providerKey === 'custom' ? (customModelName || 'custom') : providerKey,
      upload_time: db.serverDate(),
      upload_time_ms: Date.now(),
      image_size: imageBuffer.length,
      status: 'completed'
    }

    const addRes = await db.collection(DEVICES).add({ data: deviceRecord })
    console.log('Written to devices collection, _id=', addRes._id)

    /* ── Step E: Extract and store vocabulary words ── */
    const vocabCount = await writeVocabulary(
      aiResult.words,
      deviceId,
      userPhone,
      addRes._id
    )

    /* ── Log success ── */
    await writeLog({
      device_id: deviceId,
      user_phone: userPhone,
      result: 'success',
      content_type: contentType,
      file_id: fileID,
      bytes: imageBuffer.length,
      ai_model: providerKey === 'custom' ? (customModelName || 'custom') : providerKey,
      devices_record_id: addRes._id
    })

    return response(200, {
      code: 0,
      msg: 'Image processed successfully',
      data: {
        fileID,
        device_id: deviceId,
        ai_result: aiResult,
        ai_model: providerKey === 'custom' ? (customModelName || 'custom') : providerKey,
        record_id: addRes._id,
        vocabulary_count: vocabCount || 0
      }
    })

  } catch (err) {
    const message = err && err.message ? err.message : 'internal error'
    console.error('uploadImage error', err)
    await writeLog({
      device_id: deviceId,
      result: 'error',
      error: String(message),
      content_type: contentType
    })
    return response(500, { code: -1, msg: message })
  }
}
