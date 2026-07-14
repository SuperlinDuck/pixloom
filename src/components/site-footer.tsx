"use client"

import { useTranslations } from "next-intl"
import { Link } from "@/i18n/routing"
import { PixLoomWordmark } from "@/components/pixloom-wordmark"

const SUPPORT_EMAIL = "support@pixloom.io"

export function SiteFooter() {
  const t = useTranslations("siteFooter")

  return (
    <footer className="border-t border-[#ded4cb] bg-[#efe9e1]/60">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 text-sm text-[#6f6a64] sm:px-6 md:grid-cols-[1.2fr_1fr] lg:px-8">
        <div>
          <PixLoomWordmark className="text-2xl text-foreground" />
          <p className="mt-3 text-xs leading-5 text-[#827970]">{t("operator")}</p>
          <p className="mt-4">
            {t("supportLabel")}{" "}
            <a className="font-semibold text-foreground underline underline-offset-4" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
          <p className="mt-1 text-xs text-[#827970]">{t("responseTime")}</p>
        </div>

        <nav aria-label={t("legalNavigation")} className="md:justify-self-end">
          <p className="font-semibold text-foreground">{t("legalTitle")}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3">
            <Link className="hover:text-foreground hover:underline" href="/terms">{t("terms")}</Link>
            <Link className="hover:text-foreground hover:underline" href="/privacy">{t("privacy")}</Link>
            <Link className="hover:text-foreground hover:underline" href="/refund-policy">{t("refund")}</Link>
            <Link className="hover:text-foreground hover:underline" href="/cancellation-policy">{t("cancellation")}</Link>
          </div>
          <p className="mt-6 text-xs">© 2026 PixLoom. {t("rights")}</p>
        </nav>
      </div>
    </footer>
  )
}
