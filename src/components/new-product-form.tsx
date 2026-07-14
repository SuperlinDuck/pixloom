"use client"

import Image from "next/image"
import { ChangeEvent, useState } from "react"
import { useTranslations } from "next-intl"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const categoryKeys = ["drinkware", "beauty", "fashion", "home"] as const
const useCaseKeys = ["mainImage", "sceneImage", "sellingPoints", "detailSet"] as const
const sceneKeys = ["studio", "kitchen", "livingRoom", "outdoor"] as const

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

export function NewProductForm() {
  const t = useTranslations("newProduct")

  const [productName, setProductName] = useState("")
  const [productDescription, setProductDescription] = useState("")
  const [highlights, setHighlights] = useState("")
  const [category, setCategory] = useState<typeof categoryKeys[number]>("drinkware")
  const [useCase, setUseCase] = useState<typeof useCaseKeys[number]>("sceneImage")
  const [scene, setScene] = useState<typeof sceneKeys[number]>("studio")
  const [imageDataUrl, setImageDataUrl] = useState("")
  const [imageName, setImageName] = useState("")
  const [error, setError] = useState("")

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!file.type.startsWith("image/")) {
      setError(t("form.imageTypeError"))
      return
    }

    setError("")

    try {
      const dataUrl = await fileToDataUrl(file)
      setImageDataUrl(dataUrl)
      setImageName(file.name)
    } catch {
      setError(t("form.imageReadError"))
    }
  }

  /* TODO: 正式上线商品图生成功能时恢复提交逻辑和下方提交按钮。
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isReady) {
      setError(t("form.requiredError"))
      return
    }

    setIsSaving(true)
    setError("")

    const draft: ProductDraft = {
      productName: productName.trim(),
      productDescription: productDescription.trim(),
      highlights: highlights.trim(),
      category,
      useCase,
      scene,
      imageDataUrl,
      imageName,
    }

    sessionStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify(draft))
    router.push("/generator")
  }
  */

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t("form.title")}</CardTitle>
          <CardDescription>{t("form.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="product-image-upload">
                {t("form.image")}
              </label>
              <label
                htmlFor="product-image-upload"
                className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 p-6 text-center"
              >
                <span className="text-sm font-medium">{t("form.imageHintTitle")}</span>
                <span className="mt-2 text-sm text-muted-foreground">{t("form.imageHintDescription")}</span>
                {imageName ? <span className="mt-3 text-xs text-muted-foreground">{imageName}</span> : null}
              </label>
              <input id="product-image-upload" type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
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
              <label className="text-sm font-medium" htmlFor="productDescription">
                {t("form.productDescription")}
              </label>
              <textarea
                id="productDescription"
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
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {/* TODO: 正式上线商品图生成功能时恢复以下入口。
            <Button type="submit" size="lg" disabled={isSaving || !isReady}>
              {isSaving ? t("form.saving") : t("form.submit")}
            </Button>
            */}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("preview.title")}</CardTitle>
          <CardDescription>{t("preview.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {imageDataUrl ? (
            <div className="overflow-hidden rounded-lg border bg-muted">
              <div className="relative aspect-square w-full">
                <Image src={imageDataUrl} alt={imageName || productName || "product"} fill unoptimized className="object-cover" />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
              {t("preview.empty")}
            </div>
          )}

          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">{t("preview.nextTitle")}</p>
            <div className="mt-3 grid gap-3 text-sm text-muted-foreground">
              <div className="rounded-md bg-muted/40 p-3">{t("preview.step1")}</div>
              <div className="rounded-md bg-muted/40 p-3">{t("preview.step2")}</div>
              <div className="rounded-md bg-muted/40 p-3">{t("preview.step3")}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
