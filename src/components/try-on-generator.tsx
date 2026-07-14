"use client"

import Image from "next/image"
import { ChangeEvent, useState } from "react"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"

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

type ClothingImage = {
  id: string
  name: string
  dataUrl: string
  base64: string
  mimeType: string
}

const genderKeys = ["female", "male", "neutral"] as const
const ageGroupKeys = ["child", "teen", "youngAdult", "adult", "senior"] as const
const skinToneKeys = ["fair", "medium", "tan", "deep"] as const
const bodyTypeKeys = ["slim", "average", "athletic", "curvy", "plus"] as const
const aspectRatios = ["4:5", "3:4", "1:1", "16:9"]
const MAX_IMAGES = 6

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function fileToImage(file: File) {
  return new Promise<{ dataUrl: string; base64: string; mimeType: string }>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      const base64 = result.split(",")[1] ?? ""
      resolve({ dataUrl: result, base64, mimeType: file.type })
    }
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

export function TryOnGenerator() {
  const t = useTranslations("tryOn")

  const [images, setImages] = useState<ClothingImage[]>([])
  const [gender, setGender] = useState<typeof genderKeys[number]>(genderKeys[0])
  const [ageGroup, setAgeGroup] = useState<typeof ageGroupKeys[number]>(ageGroupKeys[2])
  const [skinTone, setSkinTone] = useState<typeof skinToneKeys[number]>(skinToneKeys[0])
  const [bodyType, setBodyType] = useState<typeof bodyTypeKeys[number]>(bodyTypeKeys[1])
  const [aspectRatio, setAspectRatio] = useState(aspectRatios[0])
  const [prompt, setPrompt] = useState("")
  const [result, setResult] = useState<GenerateResponse["data"]>()
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleImagesChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""

    if (files.length === 0) {
      return
    }

    const invalid = files.some((file) => !file.type.startsWith("image/"))
    if (invalid) {
      setError(t("form.imageTypeError"))
      return
    }

    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) {
      setError(t("form.imageLimitError", { max: MAX_IMAGES }))
      return
    }

    setError("")

    try {
      const accepted = files.slice(0, remaining)
      const loaded = await Promise.all(
        accepted.map(async (file) => {
          const { dataUrl, base64, mimeType } = await fileToImage(file)
          return {
            id: `${file.name}-${file.size}-${createId()}`,
            name: file.name,
            dataUrl,
            base64,
            mimeType,
          }
        })
      )
      setImages((prev) => [...prev, ...loaded])
    } catch {
      setError(t("form.imageReadError"))
    }
  }

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((image) => image.id !== id))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (images.length === 0) {
      setError(t("form.requiredError"))
      return
    }

    setError("")
    setResult(undefined)
    setIsLoading(true)

    try {
      const response = await fetch("/api/generate-try-on-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          gender: t(`gender.${gender}`),
          ageGroup: t(`ageGroup.${ageGroup}`),
          skinTone: t(`skinTone.${skinTone}`),
          bodyType: t(`bodyType.${bodyType}`),
          aspectRatio,
          clothingImages: images.map((image) => ({
            data: image.base64,
            mimeType: image.mimeType,
          })),
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
              <label className="text-sm font-medium" htmlFor="clothing-upload">
                {t("form.clothingImages")}
              </label>
              <label
                htmlFor="clothing-upload"
                className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 p-6 text-center"
              >
                <span className="text-sm font-medium">{t("form.imageHintTitle")}</span>
                <span className="mt-2 text-sm text-muted-foreground">
                  {t("form.imageHintDescription", { max: MAX_IMAGES })}
                </span>
              </label>
              <input
                id="clothing-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImagesChange}
              />

              {images.length > 0 ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {images.map((image) => (
                    <div key={image.id} className="group relative overflow-hidden rounded-lg border bg-muted">
                      <div className="relative aspect-square w-full">
                        <Image src={image.dataUrl} alt={image.name} fill unoptimized className="object-cover" />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeImage(image.id)}
                        aria-label={t("form.removeImage")}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-foreground shadow transition hover:bg-background"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="gender">
                  {t("form.gender")}
                </label>
                <select
                  id="gender"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={gender}
                  onChange={(event) => setGender(event.target.value as typeof genderKeys[number])}
                >
                  {genderKeys.map((key) => (
                    <option key={key} value={key}>
                      {t(`gender.${key}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="ageGroup">
                  {t("form.ageGroup")}
                </label>
                <select
                  id="ageGroup"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={ageGroup}
                  onChange={(event) => setAgeGroup(event.target.value as typeof ageGroupKeys[number])}
                >
                  {ageGroupKeys.map((key) => (
                    <option key={key} value={key}>
                      {t(`ageGroup.${key}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="skinTone">
                  {t("form.skinTone")}
                </label>
                <select
                  id="skinTone"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={skinTone}
                  onChange={(event) => setSkinTone(event.target.value as typeof skinToneKeys[number])}
                >
                  {skinToneKeys.map((key) => (
                    <option key={key} value={key}>
                      {t(`skinTone.${key}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="bodyType">
                  {t("form.bodyType")}
                </label>
                <select
                  id="bodyType"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={bodyType}
                  onChange={(event) => setBodyType(event.target.value as typeof bodyTypeKeys[number])}
                >
                  {bodyTypeKeys.map((key) => (
                    <option key={key} value={key}>
                      {t(`bodyType.${key}`)}
                    </option>
                  ))}
                </select>
              </div>
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

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="prompt">
                {t("form.prompt")}
              </label>
              <textarea
                id="prompt"
                className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t("form.promptPlaceholder")}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
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
                <div className="relative aspect-[4/5] w-full">
                  <Image src={result.imageUrl} alt={result.prompt} fill unoptimized className="object-cover" />
                </div>
              </div>
              <div className="space-y-2 rounded-lg border p-4">
                <p className="text-sm font-medium">{t("result.finalPrompt")}</p>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{result.prompt}</p>
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
