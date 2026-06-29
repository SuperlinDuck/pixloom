"use client"

import { useTranslations } from "next-intl"
import {
  ArrowRight,
  Check,
  ImageIcon,
  Layers3,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  Users,
  WandSparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { I18nNavbar } from "@/components/i18n-navbar"
import { PixLoomWordmark } from "@/components/pixloom-wordmark"

export default function Home() {
  const t = useTranslations()

  const workflow = [
    {
      icon: UploadCloud,
      title: t("features.workflow.productUpload.title"),
      description: t("features.workflow.productUpload.description"),
      accent: "text-signal",
    },
    {
      icon: SlidersHorizontal,
      title: t("features.workflow.sceneGeneration.title"),
      description: t("features.workflow.sceneGeneration.description"),
      accent: "text-iris",
    },
    {
      icon: Layers3,
      title: t("features.workflow.exportPack.title"),
      description: t("features.workflow.exportPack.description"),
      accent: "text-pulse",
    },
  ]

  const deliverables = [
    t("home.deliverables.mainImage"),
    t("home.deliverables.sceneImage"),
    t("home.deliverables.sellingPoints"),
    t("home.deliverables.detailSet"),
  ]

  const features = [
    {
      icon: ImageIcon,
      title: t("features.productImage.title"),
      description: t("features.productImage.description"),
    },
    {
      icon: WandSparkles,
      title: t("features.sceneImage.title"),
      description: t("features.sceneImage.description"),
    },
    {
      icon: Users,
      title: t("features.collaboration.title"),
      description: t("features.collaboration.description"),
    },
  ]

  return (
    <main className="min-h-screen overflow-hidden bg-background">
      <I18nNavbar />

      <section id="home" className="relative">
        <div className="signal-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute left-[68%] top-20 h-80 w-80 rounded-full bg-iris/20 blur-[120px]" />
        <div className="relative mx-auto grid w-full max-w-7xl gap-14 px-4 pb-24 pt-20 sm:px-6 md:pt-28 lg:grid-cols-[1.12fr_0.88fr] lg:items-center lg:px-8 lg:pb-32">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-signal">
              <Sparkles className="size-3.5" />
              {t("hero.badge")}
            </div>
            <h1 className="max-w-4xl font-display text-5xl font-extrabold leading-[0.98] tracking-[-0.055em] text-foreground sm:text-6xl md:text-7xl xl:text-[82px]">
              {t("hero.title")}
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {t("hero.description")}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button size="lg" asChild className="h-12 px-6">
                <Link href="/products/new">
                  {t("home.primaryCta")}
                  <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="h-12 px-6">
                <a href="#workflow">{t("home.secondaryCta")}</a>
              </Button>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
              {deliverables.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <Check className="size-4 text-signal" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:mx-0">
            <div className="absolute -inset-10 rounded-full bg-gradient-to-br from-signal/10 via-iris/10 to-pulse/10 blur-3xl" />
            <div className="relative overflow-hidden rounded-xl border border-border bg-card/90 p-3 shadow-iris backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-border px-3 pb-3 pt-1">
                <PixLoomWordmark className="text-2xl" accent="cyan" />
                <span className="rounded-full border border-signal/25 bg-signal/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal">
                  AI Studio
                </span>
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-background/70 p-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">01 / Product</p>
                    <div className="mt-4 aspect-square rounded-md border border-dashed border-signal/35 bg-gradient-to-br from-signal/10 to-transparent p-5">
                      <div className="flex h-full items-center justify-center rounded-full border border-signal/20 bg-signal/[0.04]">
                        <UploadCloud className="size-9 text-signal" />
                      </div>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-border">
                    <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-signal via-iris to-pulse" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {["Studio", "Scene", "Detail", "Social"].map((label, index) => (
                    <div
                      key={label}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-background/75 p-3"
                    >
                      <div
                        className={`absolute inset-0 opacity-60 ${
                          index === 0
                            ? "bg-[radial-gradient(circle_at_50%_45%,rgba(70,230,242,.28),transparent_45%)]"
                            : index === 1
                              ? "bg-[radial-gradient(circle_at_70%_25%,rgba(123,92,255,.30),transparent_48%)]"
                              : index === 2
                                ? "bg-[radial-gradient(circle_at_30%_70%,rgba(250,76,174,.22),transparent_48%)]"
                                : "bg-[radial-gradient(circle_at_60%_55%,rgba(70,230,242,.18),transparent_52%)]"
                        }`}
                      />
                      <div className="relative flex h-full flex-col justify-between">
                        <Sparkles className="size-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-foreground/85">{label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mx-3 mb-3 flex items-center justify-between rounded-lg border border-border bg-background/70 p-3">
                <div>
                  <p className="text-xs font-semibold">{t("home.heroCard.outputTitle")}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">4 assets · ready to refine</p>
                </div>
                <div className="flex gap-1.5">
                  <span className="h-1.5 w-8 rounded-full bg-signal" />
                  <span className="h-1.5 w-8 rounded-full bg-pulse" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="border-y border-border/70 bg-card/30">
        <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-signal">01 / Workflow</p>
            <h2 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
              {t("home.workflowTitle")}
            </h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              {t("home.workflowDescription")}
            </p>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
            {workflow.map((item, index) => {
              const Icon = item.icon
              return (
                <article key={item.title} className="group bg-card p-7 transition-colors hover:bg-accent/70 sm:p-8">
                  <div className="flex items-center justify-between">
                    <Icon className={`size-6 ${item.accent}`} />
                    <span className="font-display text-4xl font-extrabold text-border">0{index + 1}</span>
                  </div>
                  <h3 className="mt-12 font-display text-xl font-bold tracking-tight">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-pulse">02 / Product</p>
            <h2 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
              {t("features.title")}
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">{t("features.description")}</p>
          </div>
          <div className="space-y-4">
            {features.map((feature, index) => {
              const Icon = feature.icon
              return (
                <article key={feature.title} className="group grid gap-5 rounded-lg border border-border bg-card/60 p-6 transition-all hover:border-primary/40 hover:bg-card sm:grid-cols-[auto_1fr_auto] sm:items-start">
                  <div className="flex size-11 items-center justify-center rounded-md border border-primary/20 bg-primary/[0.06] text-signal">
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-bold tracking-tight">{feature.title}</h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{feature.description}</p>
                  </div>
                  <span className="text-xs font-semibold tracking-[0.18em] text-muted-foreground">0{index + 1}</span>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-xl border border-border bg-card p-8 sm:p-12 lg:p-16">
          <div className="absolute -right-20 -top-32 h-80 w-80 rounded-full bg-iris/25 blur-[100px]" />
          <div className="absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-pulse/10 blur-[100px]" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-iris">03 / Start creating</p>
              <h2 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
                {t("pricing.title")}
              </h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">{t("pricing.description")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild className="h-12 px-6">
                <Link href="/products/new">
                  {t("home.primaryCta")}
                  <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="h-12 px-6">
                <a href="#home">{t("common.contactSales")}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <PixLoomWordmark className="text-2xl text-foreground" />
          <p>AI product imagery, tuned for commerce.</p>
        </div>
      </footer>
    </main>
  )
}
