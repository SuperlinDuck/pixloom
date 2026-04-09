import { describe, expect, it, vi, beforeEach } from "vitest"

const generateProductImage = vi.fn()

vi.mock("@/lib/ai/gemini-image", () => ({
  generateProductImage,
}))

describe("POST /api/generate-product-image", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 400 when prompt is missing", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost/api/generate-product-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ style: "高级棚拍" }),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "商品描述不能为空",
    })
  })

  it("calls Gemini service and returns image result", async () => {
    generateProductImage.mockResolvedValue({
      prompt: "生成一张简约风保温杯商品主图",
      imageUrl: "data:image/png;base64,abc123",
      model: "gemini-2.0-flash-preview-image-generation",
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost/api/generate-product-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "简约风保温杯主图",
          style: "高级棚拍",
          platform: "淘宝",
          aspectRatio: "1:1",
          productName: "316不锈钢保温杯",
          highlights: "大容量, 真空保温",
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(generateProductImage).toHaveBeenCalledWith({
      prompt: "简约风保温杯主图",
      style: "高级棚拍",
      platform: "淘宝",
      aspectRatio: "1:1",
      productName: "316不锈钢保温杯",
      highlights: "大容量, 真空保温",
    })
    await expect(response.json()).resolves.toEqual({
      data: {
        prompt: "生成一张简约风保温杯商品主图",
        imageUrl: "data:image/png;base64,abc123",
        model: "gemini-2.0-flash-preview-image-generation",
      },
    })
  })
})
