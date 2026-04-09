const DEFAULT_MODEL = "gemini-2.0-flash-preview-image-generation"
const DEFAULT_LOCATION = process.env.VERTEX_AI_LOCATION || "global"

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

export async function generateProductImage(input: ProductImageRequest): Promise<ProductImageResult> {
  const apiKey = process.env.VERTEX_AI_API_KEY
  const projectId = process.env.VERTEX_AI_PROJECT_ID
  const model = process.env.VERTEX_AI_IMAGE_MODEL || DEFAULT_MODEL

  if (!apiKey || !projectId) {
    throw new Error("缺少 Vertex AI 配置，请设置 VERTEX_AI_API_KEY 和 VERTEX_AI_PROJECT_ID")
  }

  const finalPrompt = buildPrompt(input)
  const endpoint = `https://${DEFAULT_LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${DEFAULT_LOCATION}/publishers/google/models/${model}:generateContent?key=${apiKey}`

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

  const payload = (await response.json()) as VertexResponse
  const imageBase64 = extractImageBase64(payload)

  if (!imageBase64) {
    throw new Error("Gemini 未返回图片数据")
  }

  return {
    prompt: finalPrompt,
    imageUrl: `data:image/png;base64,${imageBase64}`,
    model,
  }
}
