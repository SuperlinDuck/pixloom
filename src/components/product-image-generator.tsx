"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PRODUCT_DRAFT_STORAGE_KEY, ProductDraft } from "@/lib/product-draft"

type GenerateResponse = {
  data?: {
    prompt: string
    imageUrl: string
    model: string
  }
  error?: string
}

const styleKeys = ["studioShot", "minimalist", "lifestyle"] as const
const useCaseKeys = ["mainImage", "sceneImage", "sellingPoints", "detailSet"] as const
const categoryKeys = ["drinkware", "beauty", "fashion", "home"] as const
const sceneKeys = ["studio", "kitchen", "livingRoom", "outdoor"] as const
const platforms = ["Amazon", "Shopee", "TikTok Shop", "淘宝"]
const aspectRatios = ["1:1", "4:5", "16:9"]

export function ProductImageGenerator() {
  const t = useTranslations("generator")

  const [productName, setProductName] = useState("")
  const [productDescription, setProductDescription] = useState("")
  const [highlights, setHighlights] = useState("")
  const [useCase, setUseCase] = useState<typeof useCaseKeys[number]>(useCaseKeys[0])
  const [category, setCategory] = useState<typeof categoryKeys[number]>(categoryKeys[0])
  const [scene, setScene] = useState<typeof sceneKeys[number]>(sceneKeys[0])
  const [style, setStyle] = useState<typeof styleKeys[number]>(styleKeys[0])
  const [platform, setPlatform] = useState(platforms[0])
  const [aspectRatio, setAspectRatio] = useState(aspectRatios[0])
  const [productImageUrl, setProductImageUrl] = useState("")
  const [productImageName, setProductImageName] = useState("")
  const [result, setResult] = useState<GenerateResponse["data"]>()
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const rawDraft = sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY)

    if (!rawDraft) {
      return
    }

    try {
      const draft = JSON.parse(rawDraft) as ProductDraft

      setProductName(draft.productName || "")
      setProductDescription(draft.productDescription || "")
      setHighlights(draft.highlights || "")
      setCategory(draft.category || categoryKeys[0])
      setUseCase(draft.useCase || useCaseKeys[0])
      setScene(draft.scene || sceneKeys[0])
      setProductImageUrl(draft.imageDataUrl || "")
      setProductImageName(draft.imageName || "")
    } catch {
      sessionStorage.removeItem(PRODUCT_DRAFT_STORAGE_KEY)
    }
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setResult(undefined)
    setIsLoading(true)

    try {
      const composedPrompt = [
        t(`useCases.${useCase}`),
        t(`categories.${category}`),
        t(`scenes.${scene}`),
        productDescription,
        highlights,
      ]
        .filter(Boolean)
        .join("；")

      const response = await fetch("/api/generate-product-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productName,
          prompt: composedPrompt,
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
            {productImageUrl ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("form.productImage")}</p>
                <div className="overflow-hidden rounded-lg border bg-muted">
                  <div className="relative aspect-[4/3] w-full">
                    <Image
                      src={productImageUrl}
                      alt={productImageName || productName || t("form.productImage")}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                </div>
                {productImageName ? <p className="text-xs text-muted-foreground">{productImageName}</p> : null}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="useCase">
                  {t("form.useCase")}
                </label>
                <select
                  id="useCase"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={useCase}
                  onChange={(event) => setUseCase(event.target.value as typeof useCaseKeys[number])}
                >
                  {useCaseKeys.map((key) => (
                    <option key={key} value={key}>
                      {t(`useCases.${key}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="category">
                  {t("form.category")}
                </label>
                <select
                  id="category"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as typeof categoryKeys[number])}
                >
                  {categoryKeys.map((key) => (
                    <option key={key} value={key}>
                      {t(`categories.${key}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

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
              <label className="text-sm font-medium" htmlFor="productDescription">
                {t("form.productDescription")}
              </label>
              <textarea
                id="productDescription"
                required
                className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t("form.productDescriptionPlaceholder")}
                value={productDescription}
                onChange={(event) => setProductDescription(event.target.value)}
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

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="scene">
                  {t("form.scene")}
                </label>
                <select
                  id="scene"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={scene}
                  onChange={(event) => setScene(event.target.value as typeof sceneKeys[number])}
                >
                  {sceneKeys.map((key) => (
                    <option key={key} value={key}>
                      {t(`scenes.${key}`)}
                    </option>
                  ))}
                </select>
              </div>

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
            </div>

            <div className="grid gap-4 md:grid-cols-2">
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

            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm font-medium">{t("form.workflowTitle")}</p>
              <div className="mt-3 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
                <div className="rounded-md bg-background p-3">{t("workflow.step1")}</div>
                <div className="rounded-md bg-background p-3">{t("workflow.step2")}</div>
                <div className="rounded-md bg-background p-3">{t("workflow.step3")}</div>
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
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">{t("result.output.mainImageTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("result.output.mainImageDescription")}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">{t("result.output.sceneImageTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("result.output.sceneImageDescription")}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">{t("result.output.detailSetTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("result.output.detailSetDescription")}</p>
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
            <div className="space-y-4 rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
              <p>{t("result.placeholder")}</p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border bg-muted/40 p-4">
                  <p className="font-medium text-foreground">{t("result.preview.mainImageTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("result.preview.mainImageDescription")}</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-4">
                  <p className="font-medium text-foreground">{t("result.preview.sceneImageTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("result.preview.sceneImageDescription")}</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-4">
                  <p className="font-medium text-foreground">{t("result.preview.sellingPointsTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("result.preview.sellingPointsDescription")}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
