const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'device_bindings'

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION)
    return { created: true }
  } catch (err) {
    const message = String(err && err.message ? err.message : err)
    if (message.includes('exists') || message.includes('exist')) {
      return { created: false }
    }
    throw err
  }
}

async function ensureIndexes() {
  const results = []
  const indexes = [
    {
      name: 'idx_device_id_unique',
      keys: [{ name: 'device_id', direction: 1 }],
      unique: true
    },
    {
      name: 'idx_device_id',
      keys: [{ name: 'device_id', direction: 1 }],
      unique: false
    },
    {
      name: 'idx_user_id',
      keys: [{ name: 'user_id', direction: 1 }],
      unique: false
    },
    {
      name: 'idx_user_phone',
      keys: [{ name: 'user_phone', direction: 1 }],
      unique: false
    }
  ]

  for (const indexItem of indexes) {
    try {
      // CloudBase supports createIndex on collection in cloud function runtime.
      await db.collection(COLLECTION).createIndex(indexItem)
      results.push({ name: indexItem.name, status: 'created' })
    } catch (err) {
      const msg = String(err && err.message ? err.message : err)
      if (msg.includes('exists') || msg.includes('duplicate')) {
        results.push({ name: indexItem.name, status: 'exists' })
      } else {
        results.push({ name: indexItem.name, status: 'failed', message: msg })
      }
    }
  }

  return results
}

exports.main = async () => {
  try {
    const collection = await ensureCollection()
    const indexes = await ensureIndexes()
    return {
      code: 0,
      msg: 'device_bindings 初始化完成',
      data: {
        collection,
        indexes,
        schema: {
          device_id: 'String (required, unique)',
          user_id: 'String (required)',
          user_phone: 'String (required)',
          bind_time: 'Timestamp (required)',
          bind_time_ms: 'Number (recommended)',
          created_at: 'Timestamp',
          updated_at: 'Timestamp'
        }
      }
    }
  } catch (err) {
    console.error('initDeviceBindings error', err)
    return {
      code: -1,
      msg: err.message || '初始化失败'
    }
  }
}
