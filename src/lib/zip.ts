import { crc32 } from 'node:zlib'

export type ArchiveFile = { path: string; body: Buffer }

// Bounded ZIP32, STORE method. No shell, temporary files, or executable entries.
// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
export function createZip(files: ArchiveFile[]) {
  if (!files.length || files.length > 256) throw new Error('交付文件数量无效')
  const paths = new Set<string>()
  let bytes = 0
  for (const file of files) {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(file.path) ||
      file.path.length > 400 ||
      file.path.split('/').some((part) => !part || part.startsWith('.')) ||
      paths.has(file.path)
    )
      throw new Error('交付文件路径无效')
    paths.add(file.path)
    bytes += file.body.length
  }
  for (const file of files) {
    const parts = file.path.split('/')
    for (let i = 1; i < parts.length; i++)
      if (paths.has(parts.slice(0, i).join('/')))
        throw new Error('交付文件与目录冲突')
  }
  if (bytes > 12 * 1024 * 1024) throw new Error('交付文件超过 12 MiB')

  const local: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.path)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6) // UTF-8
    header.writeUInt16LE(0x0021, 12) // 1980-01-01; deterministic archive
    header.writeUInt32LE(crc32(file.body), 14)
    header.writeUInt32LE(file.body.length, 18)
    header.writeUInt32LE(file.body.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, file.body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    header.copy(entry, 6, 4, 30)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += header.length + name.length + file.body.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
