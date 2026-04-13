import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"

export interface UploadResult {
  url: string
  path: string
  size: number
}

/**
 * 统一图片上传接口
 * - 本地开发：保存到 public/uploads/
 * - 生产环境：上传到图片服务器
 */
export async function uploadImage(base64: string, mimeType = "image/png"): Promise<UploadResult> {
  const useRemote = !!process.env.IMAGE_SERVER_URL

  if (useRemote) {
    return uploadToRemote(base64, mimeType)
  } else {
    return uploadToLocal(base64, mimeType)
  }
}

/**
 * 本地开发：保存到 public/uploads/
 */
async function uploadToLocal(base64: string, mimeType: string): Promise<UploadResult> {
  const ext = mimeType === "image/jpeg" ? "jpg" : "png"
  const datePath = getDatePath()
  const filename = `${randomUUID()}.${ext}`
  const relativePath = `${datePath}/${filename}`

  const uploadDir = path.join(process.cwd(), "public/uploads", datePath)
  await mkdir(uploadDir, { recursive: true })

  const buffer = Buffer.from(base64, "base64")
  const fullPath = path.join(uploadDir, filename)
  await writeFile(fullPath, buffer)

  return {
    url: `/uploads/${relativePath}`,
    path: relativePath,
    size: buffer.length,
  }
}

/**
 * 生产环境：上传到图片服务器
 */
async function uploadToRemote(base64: string, mimeType: string): Promise<UploadResult> {
  const uploadUrl = process.env.IMAGE_SERVER_URL
  const uploadToken = process.env.IMAGE_UPLOAD_TOKEN

  if (!uploadUrl || !uploadToken) {
    throw new Error("Missing IMAGE_SERVER_URL or IMAGE_UPLOAD_TOKEN")
  }

  const response = await fetch(`${uploadUrl}/api/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Upload-Token": uploadToken,
    },
    body: JSON.stringify({ base64, mimeType }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Image upload failed: ${error}`)
  }

  return response.json()
}

/**
 * 生成日期路径：2026/04/13
 */
function getDatePath(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}/${month}/${day}`
}
