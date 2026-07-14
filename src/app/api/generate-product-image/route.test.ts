import { describe, expect, it } from "vitest"

describe("POST /api/generate-product-image", () => {
  it("returns 404 while product image generation is not released", async () => {
    const { POST } = await import("./route")
    const response = await POST()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Not Found",
    })
  })
})
