"use client"

import { useState } from "react"
import { Check, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import { I18nNavbar } from "@/components/i18n-navbar"
import { PixLoomWordmark } from "@/components/pixloom-wordmark"
import { cn } from "@/lib/utils"

type BillingCycle = "monthly" | "yearly"
type PlanName = "free" | "plus" | "pro"

const plans: Array<{ name: PlanName; featureCount: number; featured?: boolean }> = [
  { name: "free", featureCount: 5 },
  { name: "plus", featureCount: 6, featured: true },
  { name: "pro", featureCount: 7 },
]

export default function PricingPage() {
  const t = useTranslations("pricing")
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("yearly")

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <I18nNavbar />

      <section className="relative border-b border-[#ded4cb]">
        <div className="signal-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute left-1/2 top-8 h-72 w-72 -translate-x-1/2 rounded-full bg-[#c8b8b2]/35 blur-[110px]" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-20 text-center sm:px-6 sm:pb-20 sm:pt-24 lg:px-8">
          <div className="mx-auto flex max-w-3xl flex-col items-center">
            <div className="flex items-center gap-2 rounded-full border border-[#d8ccc2] bg-white/50 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#8a7469] shadow-sm">
              <Sparkles className="size-3.5" />
              {t("eyebrow")}
            </div>
            <h1 className="mt-6 font-display text-5xl font-extrabold tracking-[-0.045em] sm:text-6xl">
              {t("title")}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#6f6a64] sm:text-lg">
              {t("description")}
            </p>

            <div className="mt-9 inline-flex rounded-lg border border-[#d8ccc2] bg-[#ebe3da] p-1 shadow-inner" role="group" aria-label={t("billingLabel")}>
              {(["monthly", "yearly"] as const).map((cycle) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                  aria-pressed={billingCycle === cycle}
                  className={cn(
                    "relative rounded-md px-5 py-2.5 text-sm font-semibold text-[#6f6a64] transition-all",
                    billingCycle === cycle && "bg-[#fffdf9] text-[#24211f] shadow-sm"
                  )}
                >
                  {t(`billing.${cycle}`)}
                  {cycle === "yearly" && (
                    <span className="ml-2 rounded-full bg-[#dce7e4] px-2 py-0.5 text-[11px] text-[#547773]">
                      {t("billing.save")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="grid items-stretch gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={cn(
                "relative flex min-h-[580px] flex-col rounded-xl border bg-[#f7f3ed]/80 p-7 shadow-[0_18px_50px_rgba(104,82,69,0.08)] sm:p-8",
                plan.featured
                  ? "border-[#9a7e72] bg-[#fffdf9] shadow-[0_26px_70px_rgba(104,82,69,0.16)] lg:-translate-y-3"
                  : "border-[#d8ccc2]"
              )}
            >
              {plan.featured && (
                <div className="absolute right-5 top-5 rounded-full bg-[#8a7469] px-3 py-1 text-xs font-semibold text-white">
                  {t("recommended")}
                </div>
              )}

              <div>
                <h2 className="font-display text-2xl font-extrabold tracking-tight">
                  {t(`plans.${plan.name}.name`)}
                </h2>
                <p className="mt-2 min-h-12 text-sm leading-6 text-[#6f6a64]">
                  {t(`plans.${plan.name}.description`)}
                </p>
              </div>

              <div className="mt-7 border-y border-[#ded4cb] py-6">
                <div className="flex items-end gap-1.5">
                  <span className="pb-1.5 text-lg font-semibold text-[#4f4944]">{t("currency")}</span>
                  <span className="font-display text-5xl font-extrabold tracking-[-0.05em]">
                    {t(`plans.${plan.name}.prices.${billingCycle}`)}
                  </span>
                  <span className="pb-1.5 text-sm text-[#6f6a64]">/ {t(`billing.unit.${billingCycle}`)}</span>
                </div>
                <p className="mt-2 min-h-5 text-xs text-[#8a817a]">
                  {billingCycle === "yearly"
                    ? t(`plans.${plan.name}.yearlyNote`)
                    : t("billing.monthlyNote")}
                </p>
              </div>

              <div className="mt-6 flex-1">
                <p className="text-sm font-bold">{t("includes")}</p>
                <ul className="mt-4 space-y-3.5">
                  {Array.from({ length: plan.featureCount }, (_, index) => (
                    <li key={index} className="flex gap-3 text-sm leading-5 text-[#4f4944]">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#dce7e4] text-[#547773]">
                        <Check className="size-3.5" strokeWidth={2.5} />
                      </span>
                      {t(`plans.${plan.name}.features.${index + 1}`)}
                    </li>
                  ))}
                </ul>
              </div>

              {/* TODO: 正式上线商品图生成功能时恢复以下入口。
              <Button
                size="lg"
                variant={plan.featured ? "default" : "outline"}
                className="mt-8 h-12 w-full"
                asChild
              >
                <Link href="/products/new">
                  {t(`plans.${plan.name}.cta`)}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              */}
            </article>
          ))}
        </div>

        <div className="mt-10 rounded-lg border border-[#d8ccc2] bg-[#eee6dd]/75 px-6 py-5 text-center text-sm text-[#6f6a64] sm:px-8">
          <span className="font-semibold text-[#24211f]">{t("footer.title")}</span>{" "}
          {t("footer.description")}
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
