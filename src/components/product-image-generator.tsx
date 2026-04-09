"use client"

import Image from "next/image"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type GenerateResponse = {
  data?: {
    prompt: string
    imageUrl: string
    model: string
  }
  error?: string
}

const styles = ["高级棚拍", "极简电商", "自然生活方式"]
const platforms = ["淘宝", "Amazon", "Shopee", "TikTok Shop"]
const aspectRatios = ["1:1", "4:5", "16:9"]

export function ProductImageGenerator() {
  const [productName, setProductName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [highlights, setHighlights] = useState("")
  const [style, setStyle] = useState(styles[0])
  const [platform, setPlatform] = useState(platforms[0])
  const [aspectRatio, setAspectRatio] = useState(aspectRatios[0])
  const [result, setResult] = useState<GenerateResponse["data"]>()
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setResult(undefined)
    setIsLoading(true)

    try {
      const response = await fetch("/api/generate-product-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productName,
          prompt,
          highlights,
          style,
          platform,
          aspectRatio,
        }),
      })

      const payload = (await response.json()) as GenerateResponse

      if (!response.ok) {
        throw new Error(payload.error || "生成失败")
      }

      setResult(payload.data)
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "生成失败"
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <CardHeader>
          <CardTitle>商品图生成初版</CardTitle>
          <CardDescription>
            基于 Gemini 图片生成模型，先完成商品主图的 Prompt 填写、参数选择与结果预览闭环。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="productName">
                商品名称
              </label>
              <input
                id="productName"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="例如：316 不锈钢保温杯"
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="prompt">
                商品描述 / Prompt
              </label>
              <textarea
                id="prompt"
                required
                className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="例如：生成一张适合淘宝主图的高级棚拍商品图，突出保温杯金属质感和大容量卖点"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="highlights">
                核心卖点
              </label>
              <textarea
                id="highlights"
                className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="可填写 2-4 条卖点，用分号或换行分隔"
                value={highlights}
                onChange={(event) => setHighlights(event.target.value)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="style">
                  视觉风格
                </label>
                <select
                  id="style"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                >
                  {styles.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="platform">
                  目标平台
                </label>
                <select
                  id="platform"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value)}
                >
                  {platforms.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="aspectRatio">
                  图片比例
                </label>
                <select
                  id="aspectRatio"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value)}
                >
                  {aspectRatios.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button type="submit" size="lg" disabled={isLoading}>
              {isLoading ? "生成中..." : "立即生成商品图"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>生成结果预览</CardTitle>
          <CardDescription>当前先展示 Gemini 返回的首张图片与最终拼接 Prompt。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {result ? (
            <>
              <div className="overflow-hidden rounded-lg border bg-muted">
                <div className="relative aspect-square w-full">
                  <Image src={result.imageUrl} alt={result.prompt} fill unoptimized className="object-cover" />
                </div>
              </div>
              <div className="space-y-2 rounded-lg border p-4">
                <p className="text-sm font-medium">最终 Prompt</p>
                <p className="text-sm text-muted-foreground">{result.prompt}</p>
              </div>
              <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                模型：{result.model}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
              提交表单后，这里会展示生成图片、最终 Prompt 和模型信息。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
