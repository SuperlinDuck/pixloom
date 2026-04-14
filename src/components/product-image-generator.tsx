"use client"

import Image from "next/image"
import { useState } from "react"
import { useTranslations } from "next-intl"

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

const styleKeys = ["studioShot", "minimalist", "lifestyle"] as const
const platforms = ["Amazon", "Shopee", "TikTok Shop", "淘宝"]
const aspectRatios = ["1:1", "4:5", "16:9"]

export function ProductImageGenerator() {
  const t = useTranslations("generator")

  const [productName, setProductName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [highlights, setHighlights] = useState("")
  const [style, setStyle] = useState<typeof styleKeys[number]>(styleKeys[0])
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
          style: t(`styles.${style}`),
          platform,
          aspectRatio,
        }),
      })

      const payload = (await response.json()) as GenerateResponse

      if (!response.ok) {
        throw new Error(payload.error || t("form.generateFailed"))
      }

      setResult(payload.data)
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : t("form.generateFailed")
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t("form.title")}</CardTitle>
          <CardDescription>{t("form.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="productName">
                {t("form.productName")}
              </label>
              <input
                id="productName"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t("form.productNamePlaceholder")}
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="prompt">
                {t("form.prompt")}
              </label>
              <textarea
                id="prompt"
                required
                className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t("form.promptPlaceholder")}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="highlights">
                {t("form.highlights")}
              </label>
              <textarea
                id="highlights"
                className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t("form.highlightsPlaceholder")}
                value={highlights}
                onChange={(event) => setHighlights(event.target.value)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="style">
                  {t("form.style")}
                </label>
                <select
                  id="style"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={style}
                  onChange={(event) => setStyle(event.target.value as typeof styleKeys[number])}
                >
                  {styleKeys.map((key) => (
                    <option key={key} value={key}>
                      {t(`styles.${key}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="platform">
                  {t("form.platform")}
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
                  {t("form.aspectRatio")}
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
              {isLoading ? t("form.generating") : t("form.generate")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("result.title")}</CardTitle>
          <CardDescription>{t("result.description")}</CardDescription>
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
                <p className="text-sm font-medium">{t("result.finalPrompt")}</p>
                <p className="text-sm text-muted-foreground">{result.prompt}</p>
              </div>
              <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                {t("result.model")}: {result.model}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
              {t("result.placeholder")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
