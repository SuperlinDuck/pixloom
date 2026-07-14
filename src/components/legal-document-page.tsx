"use client"

import { useLocale } from "next-intl"
import { I18nNavbar } from "@/components/i18n-navbar"
import { SiteFooter } from "@/components/site-footer"
import { getLegalDocument } from "@/lib/legal-content"

type Props = {
  document: "terms" | "privacy" | "refund" | "cancellation"
}

export function LegalDocumentPage({ document }: Props) {
  const locale = useLocale()
  const content = getLegalDocument(locale, document)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <I18nNavbar />
      <article className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <header className="border-b border-[#ded4cb] pb-10">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8a7469]">PixLoom</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-5xl">
            {content.title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-[#6f6a64]">{content.summary}</p>
          <p className="mt-4 text-sm text-[#827970]">{content.updated}</p>
        </header>

        <div className="space-y-10 py-10">
          {content.sections.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-2xl font-bold tracking-tight">{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-4 leading-7 text-[#5f5954]">{paragraph}</p>
              ))}
              {section.bullets && (
                <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-[#5f5954]">
                  {section.bullets.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      </article>
      <SiteFooter />
    </main>
  )
}

