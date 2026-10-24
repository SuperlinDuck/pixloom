const fs = require('node:fs/promises')
const path = require('node:path')
const MAX_FILE = 128 * 1024
const MAX_SOURCE = 1024 * 1024
const MAX_FILES = 64

/** @param {string} value */
function validateSourcePath(value) {
  if (
    typeof value !== 'string' ||
    value.length > 160 ||
    value.split('/').length > 12 ||
    !/^[a-zA-Z0-9_./-]+$/.test(value) ||
    value
      .split('/')
      .some(
        (part) =>
          !part || part === '.' || part === '..' || part.startsWith('.'),
      )
  )
    throw new Error('文件路径无效')
  if (
    value !== 'index.html' &&
    !/^src\/.+\.(jsx|js|css|json|svg|txt|md)$/.test(value)
  )
    throw new Error('仅允许修改 index.html 和 src/ 下的源码文件')
  return value
}
/** @param {{path:string, content:string}[]} files */
function validateFiles(files) {
  if (!Array.isArray(files) || files.length > MAX_FILES)
    throw new Error('源码文件数量超过限制')
  let size = 0
  const seen = new Set()
  for (const file of files) {
    validateSourcePath(file.path)
    if (
      typeof file.content !== 'string' ||
      Buffer.byteLength(file.content) > MAX_FILE
    )
      throw new Error('单个源码文件不能超过 128 KiB')
    if (seen.has(file.path)) throw new Error('存在重复文件路径')
    seen.add(file.path)
    size += Buffer.byteLength(file.content)
  }
  if (size > MAX_SOURCE) throw new Error('源码总大小不能超过 1 MiB')
  return files
}
/** @param {string} root */
function createFileTools(root) {
  /** @param {string} relative @param {boolean} [createParents] */
  async function resolve(relative, createParents = false) {
    validateSourcePath(relative)
    const rootStat = await fs.lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new Error('工作空间根目录无效')
    const parts = relative.split('/')
    let current = root
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i])
      let stat
      try {
        stat = await fs.lstat(current)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        if (i < parts.length - 1 && createParents) {
          await fs.mkdir(current)
          stat = await fs.lstat(current)
        } else if (i < parts.length - 1) throw new Error('文件不存在')
      }
      if (
        stat?.isSymbolicLink() ||
        (stat && i < parts.length - 1 && !stat.isDirectory()) ||
        (stat && i === parts.length - 1 && !stat.isFile())
      )
        throw new Error('不允许符号链接或特殊文件')
    }
    return current
  }
  return {
    async snapshot() {
      const files = []
      async function walk(relative) {
        const entries = await fs.readdir(path.join(root, relative), {
          withFileTypes: true,
        })
        for (const entry of entries) {
          if (entry.isSymbolicLink()) throw new Error('不允许符号链接')
          const name = relative + '/' + entry.name
          if (entry.isDirectory()) {
            if (name.split('/').length > 12) throw new Error('文件目录层级过深')
            await walk(name)
          } else if (entry.isFile()) {
            validateSourcePath(name)
            files.push({ path: name, content: await thisTools.read(name) })
            validateFiles(files)
          } else throw new Error('不允许特殊文件')
        }
      }
      const thisTools = createFileTools(root)
      try {
        files.push({
          path: 'index.html',
          content: await thisTools.read('index.html'),
        })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      try {
        const stat = await fs.lstat(path.join(root, 'src'))
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new Error('源码目录无效')
        await walk('src')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      validateFiles(files)
      return files
    },
    /** @param {string} relative */
    async read(relative) {
      const target = await resolve(relative)
      const handle = await fs.open(
        target,
        require('node:fs').constants.O_RDONLY |
          require('node:fs').constants.O_NOFOLLOW,
      )
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > MAX_FILE)
          throw new Error('文件超过读取限制')
        return await handle.readFile('utf8')
      } finally {
        await handle.close()
      }
    },
    /** @param {string} relative @param {string} content */
    async write(relative, content) {
      validateFiles([{ path: relative, content }])
      const target = await resolve(relative, true)
      // O_NOFOLLOW also closes the final-component symlink window.
      const handle = await fs.open(
        target,
        require('node:fs').constants.O_WRONLY |
          require('node:fs').constants.O_CREAT |
          require('node:fs').constants.O_TRUNC |
          require('node:fs').constants.O_NOFOLLOW,
        0o600,
      )
      try {
        await handle.writeFile(content)
      } finally {
        await handle.close()
      }
    },
  }
}
module.exports = {
  createFileTools,
  validateSourcePath,
  validateFiles,
  MAX_FILE,
  MAX_SOURCE,
  MAX_FILES,
}
