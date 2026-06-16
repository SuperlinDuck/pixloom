import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
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

        <Card className="border-dashed">
          <CardContent className="grid gap-4 p-6 md:grid-cols-3">
            <div>
              <p className="text-sm font-medium">{t("workflow.step1Title")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("workflow.step1Description")}</p>
            </div>
            <div>
              <p className="text-sm font-medium">{t("workflow.step2Title")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("workflow.step2Description")}</p>
            </div>
            <div>
              <p className="text-sm font-medium">{t("workflow.step3Title")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("workflow.step3Description")}</p>
            </div>
          </CardContent>
        </Card>

        <ProductImageGenerator />
      </section>
    </main>
  )
}
