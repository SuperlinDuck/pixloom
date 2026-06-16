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
      title: t("features.workflow.productUpload.title"),
      description: t("features.workflow.productUpload.description"),
    },
    {
      title: t("features.workflow.sceneGeneration.title"),
      description: t("features.workflow.sceneGeneration.description"),
    },
    {
      title: t("features.workflow.exportPack.title"),
      description: t("features.workflow.exportPack.description"),
    },
  ]

  const sceneCards = [
    t("scenes.studio"),
    t("scenes.kitchen"),
    t("scenes.livingRoom"),
    t("scenes.outdoor"),
  ]

  const deliverables = [
    t("home.deliverables.mainImage"),
    t("home.deliverables.sceneImage"),
    t("home.deliverables.sellingPoints"),
    t("home.deliverables.detailSet"),
  ]

  return (
    <main className="min-h-screen bg-background">
      <I18nNavbar />

      <section id="home" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-20 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
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
                <Link href="/products/new">{t("home.primaryCta")}</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#workflow">{t("home.secondaryCta")}</a>
              </Button>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {deliverables.map((item) => (
                <div key={item} className="rounded-lg border bg-muted/40 px-4 py-3 text-sm font-medium">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <Card className="border-primary/20 bg-gradient-to-br from-background to-muted/50">
            <CardHeader>
              <CardTitle>{t("home.heroCard.title")}</CardTitle>
              <CardDescription>{t("home.heroCard.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {sceneCards.map((item) => (
                  <div key={item} className="rounded-lg border bg-background p-4 text-sm">
                    {item}
                  </div>
                ))}
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-sm font-medium">{t("home.heroCard.outputTitle")}</p>
                <p className="mt-2 text-sm text-muted-foreground">{t("home.heroCard.outputDescription")}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="workflow" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("home.workflowTitle")}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t("home.workflowDescription")}</p>
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

      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
        <Card className="p-8">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="text-3xl">{t("features.title")}</CardTitle>
            <CardDescription className="text-base">{t("features.description")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 px-0 pb-0 md:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="font-medium">{t("features.productImage.title")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("features.productImage.description")}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">{t("features.sceneImage.title")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("features.sceneImage.description")}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">{t("features.collaboration.title")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("features.collaboration.description")}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <Card className="p-8">
          <CardHeader>
            <CardTitle className="text-3xl">{t("pricing.title")}</CardTitle>
            <CardDescription className="text-base">{t("pricing.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <Button asChild>
                <Link href="/products/new">{t("home.primaryCta")}</Link>
              </Button>
              <Button variant="outline" asChild>
                <a href="#home">{t("common.contactSales")}</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
