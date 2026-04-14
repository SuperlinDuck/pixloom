"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Link } from "@/i18n/routing"
import { I18nNavbar } from "@/components/i18n-navbar"

export default function Home() {
  const t = useTranslations()

  const featureCards = [
    {
      title: t("features.productImage.title"),
      description: t("features.productImage.description"),
    },
    {
      title: t("features.sceneImage.title"),
      description: t("features.sceneImage.description"),
    },
    {
      title: t("features.collaboration.title"),
      description: t("features.collaboration.description"),
    },
  ]

  return (
    <main className="min-h-screen bg-background">
      <I18nNavbar />

      <section id="home" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-20 sm:px-6">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-4">
            {t("hero.badge")}
          </Badge>
          <h1 className="text-4xl font-bold leading-tight tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
            {t("hero.title")}
          </h1>
          <p className="mt-6 text-lg text-muted-foreground sm:text-xl">{t("hero.description")}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button size="lg" asChild>
              <Link href="/generator">{t("common.tryNow")}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#pricing">{t("common.viewPricing")}</a>
            </Button>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("features.title")}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t("features.description")}</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {featureCards.map((card) => (
            <Card key={card.title}>
              <CardHeader>
                <CardTitle>{card.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">{card.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <Card className="p-8">
          <CardHeader>
            <CardTitle className="text-3xl">{t("pricing.title")}</CardTitle>
            <CardDescription className="text-base">{t("pricing.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="#home">{t("common.contactSales")}</a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
