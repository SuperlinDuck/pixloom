import { uploadImage } from "@/lib/storage/image-storage"

const DEFAULT_MODEL = "gemini-2.0-flash-preview-image-generation"

type VertexInlineData = {
  mimeType: string
  data: string
}

type VertexPart = {
  text?: string
  inlineData?: VertexInlineData
}

type VertexCandidate = {
  content?: {
    parts?: VertexPart[]
  }
}

interface VertexResponse {
  candidates?: VertexCandidate[]
}

type StreamChunk = VertexResponse

export interface ProductImageRequest {
  prompt: string
  style: string
  platform: string
  aspectRatio: string
  productName?: string
  highlights?: string
}

export interface ProductImageResult {
  prompt: string
  imageUrl: string
  model: string
}

function buildPrompt(input: ProductImageRequest) {
  return [
    "你是电商商品图生成助手。",
    `请为${input.platform}平台生成一张${input.aspectRatio}比例的商品主图。`,
    input.productName ? `商品名称：${input.productName}` : null,
    `视觉风格：${input.style}`,
    input.highlights ? `核心卖点：${input.highlights}` : null,
    `用户需求：${input.prompt}`,
    "要求：主体突出、背景简洁、适合电商展示、质感真实、构图干净。",
  ]
    .filter(Boolean)
    .join("\n")
}

function extractImageBase64(payload: VertexResponse) {
  const candidate = payload.candidates?.[0]
  const part = candidate?.content?.parts?.find((item) => item.inlineData?.data)
  return part?.inlineData?.data
}

async function parseStreamResponse(response: Response) {
  const text = await response.text()

  let chunks: StreamChunk[] = []
  try {
    const parsed = JSON.parse(text)
    chunks = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    chunks = lines
      .map((line) => {
        try {
          return JSON.parse(line) as StreamChunk
        } catch {
          return null
        }
      })
      .filter((chunk): chunk is StreamChunk => chunk !== null)
  }

  for (const chunk of chunks) {
    const imageBase64 = extractImageBase64(chunk)
    if (imageBase64) {
      return imageBase64
    }
  }

  throw new Error(`Gemini 未返回图片数据: ${text}`)
}

export async function generateProductImage(input: ProductImageRequest): Promise<ProductImageResult> {
  const apiKey = process.env.VERTEX_AI_API_KEY
  const model = process.env.VERTEX_AI_IMAGE_MODEL || DEFAULT_MODEL

  if (!apiKey) {
    throw new Error("缺少 Vertex AI 配置，请设置 VERTEX_AI_API_KEY")
  }


  const finalPrompt = buildPrompt(input)
  const endpoint = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:streamGenerateContent?key=${apiKey}`

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: finalPrompt }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Vertex AI 调用失败: ${errorText}`)
  }

  const imageBase64 = await parseStreamResponse(response)

  const uploaded = await uploadImage(imageBase64, "image/png")

  return {
    prompt: finalPrompt,
    imageUrl: uploaded.url,
    model,
  }
}
