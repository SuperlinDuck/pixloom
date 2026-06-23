import { NextResponse } from "next/server"
import { z } from "zod"

import { generateTryOnImage } from "@/lib/ai/gemini-image"

const clothingImageSchema = z.object({
  data: z.string().min(1),
  mimeType: z.string().min(1),
})

const requestSchema = z.object({
  prompt: z.string().optional(),
  gender: z.string().min(1),
  ageGroup: z.string().min(1),
  skinTone: z.string().min(1),
  bodyType: z.string().min(1),
  aspectRatio: z.string().default("4:5"),
  clothingImages: z.array(clothingImageSchema).min(1).max(6),
})

export async function POST(request: Request) {
  try {
    const json = await request.json()
    const parsed = requestSchema.safeParse(json)

    if (!parsed.success) {
      return NextResponse.json({ error: "请至少上传一张服装图并完善模特信息" }, { status: 400 })
    }

    const result = await generateTryOnImage(parsed.data)
    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
