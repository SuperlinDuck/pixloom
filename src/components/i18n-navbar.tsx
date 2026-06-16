"use client"

import { useTranslations } from "next-intl"
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu"
import { Zap } from "lucide-react"
import { LanguageSwitcher } from "@/components/language-switcher"
import { UserButton } from "@/components/auth/user-button"
import { Link } from "@/i18n/routing"

export function I18nNavbar() {
  const t = useTranslations()

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">PixLoom</span>
        </Link>

        <NavigationMenu className="hidden md:flex">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink
                href="/"
                className="group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
              >
                {t("common.home")}
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink
                href="/generator"
                className="group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
              >
                {t("nav.workflow")}
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink
                href="/#features"
                className="group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
              >
                {t("nav.features")}
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink
                href="/#pricing"
                className="group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
              >
                {t("common.pricing")}
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <UserButton />
        </div>
      </div>

      <div className="border-t px-4 py-3 md:hidden sm:px-6">
        <details>
          <summary className="cursor-pointer list-none text-sm font-semibold">{t("common.navigation")}</summary>
          <div className="mt-3 space-y-3 text-sm">
            <Link href="/" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("common.home")}
            </Link>
            <Link href="/generator" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("nav.workflow")}
            </Link>
            <a href="/#features" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("nav.features")}
            </a>
            <a href="/#pricing" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("common.pricing")}
            </a>
          </div>
        </details>
      </div>
    </header>
  )
}
