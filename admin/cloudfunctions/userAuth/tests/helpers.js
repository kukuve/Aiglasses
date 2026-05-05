const crypto = require('crypto')

const HASH_SECRET = 'AIGlass_Auth_Secret'

function normalizePhoneNumber(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const compact = raw.replace(/[\s-]/g, '')
  if (compact.startsWith('+')) {
    const normalized = `+${compact.slice(1).replace(/\D/g, '')}`
    if (/^\+\d{8,20}$/.test(normalized)) return normalized
    return ''
  }
  const digits = compact.replace(/\D/g, '')
  if (/^1\d{10}$/.test(digits)) return `+86${digits}`
  if (/^\d{8,20}$/.test(digits)) return `+${digits}`
  return ''
}

function maskPhone(phoneNormalized) {
  const value = String(phoneNormalized || '')
  if (value.length <= 7) return '***'
  return `${value.slice(0, 4)}****${value.slice(-3)}`
}

function phoneHash(phoneNormalized) {
  return crypto
    .createHash('sha256')
    .update(`phone:${String(phoneNormalized || '').trim()}:${HASH_SECRET}`)
    .digest('hex')
}

function resolveAutoBindDecision(existingBindingUserId, currentUserId) {
  if (!existingBindingUserId) return 'create'
  if (existingBindingUserId === currentUserId) return 'noop'
  return 'conflict'
}

module.exports = {
  normalizePhoneNumber,
  maskPhone,
  phoneHash,
  resolveAutoBindDecision
}
