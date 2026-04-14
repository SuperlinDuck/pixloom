import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { ProductImageGenerator } from "@/components/product-image-generator"
import { I18nNavbar } from "@/components/i18n-navbar"

export default function GeneratorPage() {
  const t = useTranslations("generator")

  return (
    <main className="min-h-screen bg-background">
      <I18nNavbar />
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-4">
            {t("badge")}
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 text-lg text-muted-foreground">{t("description")}</p>
        </div>

        <ProductImageGenerator />
      </section>
    </main>
  )
}
