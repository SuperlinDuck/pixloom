"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import Image from "next/image"
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Layers3,
  SlidersHorizontal,
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
      accent: "text-[#6f928e]",
    },
    {
      icon: SlidersHorizontal,
      title: t("features.workflow.sceneGeneration.title"),
      description: t("features.workflow.sceneGeneration.description"),
      accent: "text-[#8a7469]",
    },
    {
      icon: Layers3,
      title: t("features.workflow.exportPack.title"),
      description: t("features.workflow.exportPack.description"),
      accent: "text-[#b9828f]",
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

  const showcaseItems = [
    {
      title: t("home.showcase.items.hero"),
      image: "/images/home/product-showcase-01.png",
    },
    {
      title: t("home.showcase.items.scene"),
      image: "/images/home/product-showcase-02.png",
    },
    {
      title: t("home.showcase.items.detail"),
      image: "/images/home/product-showcase-03.png",
    },
    {
      title: t("home.showcase.items.social"),
      image: "/images/home/product-showcase-04.png",
    },
    {
      title: t("home.showcase.items.marketplace"),
      image: "/images/home/product-showcase-05.png",
    },
    {
      title: t("home.showcase.items.campaign"),
      image: "/images/home/product-showcase-06.png",
    },
    {
      title: t("home.showcase.items.hero"),
      image: "/images/home/product-showcase-07.png",
    },
    {
      title: t("home.showcase.items.scene"),
      image: "/images/home/product-showcase-08.png",
    },
    {
      title: t("home.showcase.items.detail"),
      image: "/images/home/product-showcase-09.png",
    },
    {
      title: t("home.showcase.items.social"),
      image: "/images/home/product-showcase-10.png",
    },
  ]
  const [activeShowcaseIndex, setActiveShowcaseIndex] = useState(0)
  const [isShowcaseAutoPaused, setIsShowcaseAutoPaused] = useState(false)
  const resumeShowcaseTimerRef = useRef<number | null>(null)

  const pauseShowcaseAutoplay = () => {
    setIsShowcaseAutoPaused(true)

    if (resumeShowcaseTimerRef.current) {
      window.clearTimeout(resumeShowcaseTimerRef.current)
    }

    resumeShowcaseTimerRef.current = window.setTimeout(() => {
      setIsShowcaseAutoPaused(false)
      resumeShowcaseTimerRef.current = null
    }, 6000)
  }

  const moveShowcase = (direction: -1 | 1) => {
    pauseShowcaseAutoplay()
    setActiveShowcaseIndex((current) => (current + direction + showcaseItems.length) % showcaseItems.length)
  }

  const selectShowcase = (index: number) => {
    pauseShowcaseAutoplay()
    setActiveShowcaseIndex(index)
  }

  useEffect(() => {
    if (isShowcaseAutoPaused) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setActiveShowcaseIndex((current) => (current + 1) % showcaseItems.length)
    }, 3500)

    return () => window.clearInterval(timer)
  }, [isShowcaseAutoPaused, showcaseItems.length])

  useEffect(() => {
    return () => {
      if (resumeShowcaseTimerRef.current) {
        window.clearTimeout(resumeShowcaseTimerRef.current)
      }
    }
  }, [])

  const getShowcasePosition = (index: number) => {
    let offset = index - activeShowcaseIndex

    if (offset > showcaseItems.length / 2) {
      offset -= showcaseItems.length
    }

    if (offset < -showcaseItems.length / 2) {
      offset += showcaseItems.length
    }

    if (offset === 0) return "is-active"
    if (offset === -1) return "is-prev"
    if (offset === 1) return "is-next"
    if (offset === -2) return "is-prev-far"
    if (offset === 2) return "is-next-far"
    return "is-hidden"
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <I18nNavbar />

      <section id="home" className="relative flex min-h-[calc(100svh-72px)] items-center">
        <div className="signal-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute left-1/2 top-20 h-80 w-80 -translate-x-1/2 rounded-full bg-[#c8b8b2]/30 blur-[120px]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#7fa29e]/10 blur-[110px]" />
        <div className="relative mx-auto flex w-full max-w-7xl justify-center px-4 py-20 text-center sm:px-6 md:py-24 lg:px-8">
          <div className="mx-auto flex max-w-5xl flex-col items-center">
            <h1 className="max-w-4xl font-display text-5xl font-extrabold leading-[1.04] tracking-[-0.045em] text-foreground sm:text-6xl md:text-[68px] xl:text-[78px]">
              {t("hero.title")}
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-[#6f6a64] sm:text-lg">
              {t("hero.description")}
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
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
            <div className="mt-9 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-3 text-sm text-[#6f6a64]">
              {deliverables.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <Check className="size-4 text-[#6f928e]" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="border-y border-[#ded4cb] bg-[#efe9e1]/70">
        <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8a7469]">01 / Workflow</p>
            <h2 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
              {t("home.workflowTitle")}
            </h2>
            <p className="mt-5 text-base leading-7 text-[#6f6a64]">
              {t("home.workflowDescription")}
            </p>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-[#d8ccc2] bg-[#d8ccc2] shadow-[0_24px_70px_rgba(104,82,69,0.12)] md:grid-cols-3">
            {workflow.map((item, index) => {
              const Icon = item.icon
              return (
                <article key={item.title} className="group bg-[#f7f3ed] p-7 transition-colors hover:bg-white/80 sm:p-8">
                  <div className="flex items-center justify-between">
                    <Icon className={`size-6 ${item.accent}`} />
                    <span className="font-display text-4xl font-extrabold text-[#d8ccc2]">0{index + 1}</span>
                  </div>
                  <h3 className="mt-12 font-display text-xl font-bold tracking-tight">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#6f6a64]">{item.description}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section id="showcase" className="w-full overflow-hidden bg-[#f7f7f5] py-24 text-[#242424]">
        <div className="mx-auto w-full max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#777]">02 / Showcase</p>
            <h2 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
              {t("home.showcase.title")}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[#6f6f6f]">
              {t("home.showcase.description")}
            </p>
          </div>
        </div>

        <div className="showcase-carousel mt-14 h-[300px] sm:h-[420px] lg:h-[520px]">
          {showcaseItems.map((item, index) => (
            <button
              key={item.image}
              type="button"
              className={`showcase-carousel-card ${getShowcasePosition(index)}`}
              onClick={() => selectShowcase(index)}
              aria-label={item.title}
            >
              <div className="showcase-carousel-card-inner">
                <Image
                  src={item.image}
                  alt={item.title}
                  width={800}
                  height={800}
                  sizes="(min-width: 1024px) 420px, (min-width: 640px) 340px, 260px"
                  className="h-full w-full object-cover"
                />
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 flex justify-center gap-2.5">
          <button
            type="button"
            onClick={() => moveShowcase(-1)}
            className="flex size-12 items-center justify-center rounded-md bg-[#e6e6e6] text-[#626262] transition hover:bg-[#dcdcdc] hover:text-[#2a2a2a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9a9a9a]"
            aria-label="Previous image"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            onClick={() => moveShowcase(1)}
            className="flex size-12 items-center justify-center rounded-md bg-[#e6e6e6] text-[#626262] transition hover:bg-[#dcdcdc] hover:text-[#2a2a2a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9a9a9a]"
            aria-label="Next image"
          >
            <ChevronRight className="size-6" />
          </button>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#b9828f]">03 / Product</p>
            <h2 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
              {t("features.title")}
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-[#6f6a64]">{t("features.description")}</p>
          </div>
          <div className="space-y-4">
            {features.map((feature, index) => {
              const Icon = feature.icon
              return (
                <article key={feature.title} className="group grid gap-5 rounded-lg border border-[#d8ccc2] bg-[#f7f3ed]/75 p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8b8b2] hover:bg-white/80 hover:shadow-[0_18px_50px_rgba(104,82,69,0.12)] sm:grid-cols-[auto_1fr_auto] sm:items-start">
                  <div className="flex size-11 items-center justify-center rounded-md border border-[#c8b8b2] bg-white/55 text-[#8a7469]">
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-bold tracking-tight">{feature.title}</h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-[#6f6a64]">{feature.description}</p>
                  </div>
                  <span className="text-xs font-semibold tracking-[0.18em] text-[#9c8d83]">0{index + 1}</span>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-xl border border-[#d8ccc2] bg-[#eee6dd] p-8 shadow-[0_28px_80px_rgba(104,82,69,0.13)] sm:p-12 lg:p-16">
          <div className="absolute -right-20 -top-32 h-80 w-80 rounded-full bg-[#c8b8b2]/40 blur-[100px]" />
          <div className="absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-[#7fa29e]/15 blur-[100px]" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6f928e]">04 / Start creating</p>
              <h2 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
                {t("pricing.title")}
              </h2>
              <p className="mt-5 text-base leading-7 text-[#6f6a64]">{t("pricing.description")}</p>
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

      <footer className="border-t border-[#ded4cb] bg-[#efe9e1]/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-[#6f6a64] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <PixLoomWordmark className="text-2xl text-foreground" />
          <p>AI product imagery, tuned for commerce.</p>
        </div>
      </footer>
    </main>
  )
}
