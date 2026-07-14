"use client"

import { useLocale } from "next-intl"
import { useRouter, usePathname } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Globe } from "lucide-react"

const localeNames: Record<string, string> = {
  zh: "中文",
  en: "EN",
}

export function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const toggleLocale = () => {
    const newLocale = locale === "zh" ? "en" : "zh"
    router.replace(pathname, { locale: newLocale })
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggleLocale} className="gap-1.5">
      <Globe className="h-4 w-4" />
      <span>{localeNames[locale]}</span>
    </Button>
  )
}
