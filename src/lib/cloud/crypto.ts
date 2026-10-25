import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { encryptionKey } from './config'
import { StoreError } from '../store'

export function seal(value: string, purpose: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(purpose))
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.')
}
export function unseal(value: string, purpose: string) {
  try {
    const [version, iv, tag, data, extra] = value.split('.')
    if (version !== 'v1' || extra || !iv || !tag || !data) throw new Error()
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(iv, 'base64url'),
    )
    decipher.setAAD(Buffer.from(purpose))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new StoreError('Cloud 凭证无法解密，请检查加密密钥或重新授权', 503)
  }
}
