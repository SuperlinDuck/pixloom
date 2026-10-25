// DNS labels are case insensitive. Normalize before both validation and storage.
export function normalizePublicationPrefix(value: string) {
  return value.trim().toLowerCase()
}

export function publicationPrefixError(value: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value))
    return '域名前缀须为 1–63 位字母、数字或连字符，且首尾不能是连字符'
  if (/^p-[a-f0-9]{32}$/.test(value)) return '该域名前缀为系统保留，请换一个'
  return null
}
