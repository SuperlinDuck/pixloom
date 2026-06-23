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

type ReferenceImageInput = {
  data: string
  mimeType: string
}

export interface ProductImageRequest {
  prompt: string
  style: string
  platform: string
  aspectRatio: string
  productName?: string
  highlights?: string
}

export interface TryOnImageRequest {
  prompt?: string
  gender: string
  ageGroup: string
  skinTone: string
  bodyType: string
  aspectRatio: string
  clothingImages: ReferenceImageInput[]
}

export interface ProductImageResult {
  prompt: string
  imageUrl: string
  model: string
}

export interface TryOnImageResult {
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

function buildTryOnPrompt(input: TryOnImageRequest) {
  return [
    "你是电商服装上身图生成助手。",
    `请基于用户提供的${input.clothingImages.length}张服装参考图，生成一张${input.aspectRatio}比例的服装上身效果图。`,
    `模特性别：${input.gender}`,
    `模特年龄段：${input.ageGroup}`,
    `模特肤色：${input.skinTone}`,
    `模特身材：${input.bodyType}`,
    input.prompt ? `补充要求：${input.prompt}` : null,
    "要求：尽量保留服装版型、材质、颜色和关键细节；模特姿态自然；服装贴合真实人体；输出适合电商展示；避免多余肢体、服装破损、结构错误和畸变。",
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

async function generateImage(parts: VertexPart[]) {
  const apiKey = process.env.VERTEX_AI_API_KEY
  const model = process.env.VERTEX_AI_IMAGE_MODEL || DEFAULT_MODEL

  if (!apiKey) {
    throw new Error("缺少 Vertex AI 配置，请设置 VERTEX_AI_API_KEY")
  }

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
          parts,
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

  return {
    imageBase64: await parseStreamResponse(response),
    model,
  }
}

export async function generateProductImage(input: ProductImageRequest): Promise<ProductImageResult> {
  const finalPrompt = buildPrompt(input)
  const { imageBase64, model } = await generateImage([{ text: finalPrompt }])

  const uploaded = await uploadImage(imageBase64, "image/png")

  return {
    prompt: finalPrompt,
    imageUrl: uploaded.url,
    model,
  }
}

export async function generateTryOnImage(input: TryOnImageRequest): Promise<TryOnImageResult> {
  const finalPrompt = buildTryOnPrompt(input)
  const parts: VertexPart[] = [
    { text: finalPrompt },
    ...input.clothingImages.map((image) => ({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    })),
  ]

  const { imageBase64, model } = await generateImage(parts)
  const uploaded = await uploadImage(imageBase64, "image/png")

  return {
    prompt: finalPrompt,
    imageUrl: uploaded.url,
    model,
  }
}
