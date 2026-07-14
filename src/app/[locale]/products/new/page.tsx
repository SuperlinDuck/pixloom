import { useTranslations } from "next-intl"

import { I18nNavbar } from "@/components/i18n-navbar"
import { Badge } from "@/components/ui/badge"
import { NewProductForm } from "@/components/new-product-form"
import { SiteFooter } from "@/components/site-footer"

export default function NewProductPage() {
  const t = useTranslations("newProduct")

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

        <NewProductForm />
      </section>
      <SiteFooter />
    </main>
  )
}
