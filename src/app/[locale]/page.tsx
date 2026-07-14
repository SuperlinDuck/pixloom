"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import Image from "next/image"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Layers3,
  Mail,
  SlidersHorizontal,
  UploadCloud,
  Users,
  WandSparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { I18nNavbar } from "@/components/i18n-navbar"
import { SiteFooter } from "@/components/site-footer"

export default function Home() {
  const t = useTranslations()
  const locale = useLocale()

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

  const heroVisuals = [
    {
      src: "/images/home/session-1/product-01.png",
      alt: t("home.heroShowcase.outputs.main"),
      className: "left-[40%] top-[1%] w-[45%] rotate-[1.5deg]",
    },
    {
      src: "/images/home/session-1/product-02.png",
      alt: t("home.heroShowcase.outputs.scene"),
      className: "right-[0%] top-[34%] w-[50%] rotate-[3deg]",
    },
    {
      src: "/images/home/session-1/product-03.png",
      alt: t("home.heroShowcase.outputs.detail"),
      className: "left-[22%] bottom-[1%] w-[42%] -rotate-[2deg]",
    },
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
        <div className="pointer-events-none absolute left-1/2 top-20 h-80 w-80 -translate-x-1/2 rounded-full bg-[#c8b8b2]/30 blur-[120px]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#7fa29e]/10 blur-[110px]" />
        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-14 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(25rem,0.82fr)] lg:px-8 lg:py-20 xl:gap-20">
          <div className="mx-auto flex max-w-5xl flex-col items-center text-center lg:mx-0 lg:items-start lg:text-left">
            <h1
              className={`max-w-4xl font-display font-extrabold leading-[1.04] tracking-[-0.045em] text-foreground ${
                locale === "en"
                  ? "text-2xl sm:text-[40px] md:text-[48px] lg:text-[48px] xl:text-[56px]"
                  : "text-5xl sm:text-6xl md:text-[68px] xl:text-[78px]"
              }`}
            >
              {t("hero.title").split("\n").map((line) => (
                <span key={line} className="block whitespace-nowrap">
                  {line}
                </span>
              ))}
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-[#6f6a64] sm:text-lg">
              {t("hero.description")}
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3 lg:justify-start">
              <Button size="lg" asChild className="h-12 px-6">
                <a href="mailto:support@pixloom.io?subject=PixLoom%20Early%20Access">
                  {t("home.earlyAccessCta")}
                  <Mail />
                </a>
              </Button>
            </div>
            <div className="mt-9 grid w-fit grid-cols-[max-content_max-content] gap-x-6 gap-y-3 text-sm text-[#6f6a64]">
              {deliverables.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <Check className="size-4 text-[#6f928e]" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="relative mx-auto hidden aspect-[0.92] w-full max-w-[34rem] lg:block" aria-label={t("home.heroShowcase.label")}>
            <div className="absolute left-[0%] top-[34%] z-20 w-[24%] -rotate-[2deg] rounded-md shadow-[0_18px_45px_rgba(85,70,58,0.16)]">
              <Image
                src="/images/home/session-1/product-image.png"
                alt={t("home.heroShowcase.input")}
                width={1024}
                height={1024}
                sizes="150px"
                priority
                className="aspect-square w-full rounded-md object-cover"
              />
            </div>

            <div className="pointer-events-none absolute left-[6%] top-[12%] z-40 w-[31%] -rotate-[7deg]" aria-hidden="true">
              <Image
                src="/images/home/session-1/hero-arrow.png"
                alt=""
                width={623}
                height={478}
                sizes="180px"
                priority
                className="h-auto w-full object-contain"
              />
            </div>

            {heroVisuals.map((item) => (
              <div
                key={item.src}
                className={`absolute z-30 overflow-hidden rounded-md shadow-[0_24px_60px_rgba(85,70,58,0.18)] ${item.className}`}
              >
                <Image
                  src={item.src}
                  alt={item.alt}
                  width={1254}
                  height={1254}
                  sizes="(min-width: 1280px) 280px, 220px"
                  priority
                  className="aspect-square w-full object-cover"
                />
              </div>
            ))}
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

      <SiteFooter />
    </main>
  )
}
