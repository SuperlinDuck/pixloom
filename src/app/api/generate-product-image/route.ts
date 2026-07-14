import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json({ error: "Not Found" }, { status: 404 })
}

/* TODO: 正式上线商品图生成功能时恢复以下接口实现。
import { z } from "zod"

import { generateProductImage } from "@/lib/ai/gemini-image"

const requestSchema = z.object({
  prompt: z.string().min(1),
  style: z.string().default("高级棚拍"),
  platform: z.string().default("Amazon"),
  aspectRatio: z.string().default("1:1"),
  productName: z.string().optional(),
  highlights: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    const json = await request.json()
    const parsed = requestSchema.safeParse(json)

    if (!parsed.success) {
      return NextResponse.json({ error: "商品描述不能为空" }, { status: 400 })
    }

    const result = await generateProductImage(parsed.data)
    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
*/
