"use client"

import { useTranslations } from "next-intl"
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu"
import { LanguageSwitcher } from "@/components/language-switcher"
import { UserButton } from "@/components/auth/user-button"
import { Link, usePathname } from "@/i18n/routing"
import { PixLoomWordmark } from "@/components/pixloom-wordmark"
import { cn } from "@/lib/utils"

const navLinkClassName =
  "group relative inline-flex h-10 w-max items-center justify-center px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-0 after:-translate-x-1/2 after:rounded-full after:bg-[#FA4DAD] after:transition-[width] after:duration-300 after:ease-out hover:after:w-[calc(100%-2rem)] focus-visible:after:w-[calc(100%-2rem)]"

export function I18nNavbar() {
  const t = useTranslations()
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const pageLinkClassName = (href: string) =>
    cn(
      navLinkClassName,
      isActive(href) &&
        "text-foreground after:w-[calc(100%-2rem)] after:shadow-[0_0_8px_rgba(250,77,173,0.55)]"
    )

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto grid h-[72px] w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex w-max items-center gap-2">
          <PixLoomWordmark className="text-[28px] leading-none" />
        </Link>

        <NavigationMenu className="hidden md:flex">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/" className={pageLinkClassName("/")}>
                  {t("common.home")}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/generator" className={pageLinkClassName("/generator")}>
                  {t("nav.workflow")}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/try-on" className={pageLinkClassName("/try-on")}>
                  {t("nav.tryOn")}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/#features" className={navLinkClassName}>
                  {t("nav.features")}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/#pricing" className={navLinkClassName}>
                  {t("common.pricing")}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <div className="flex items-center justify-self-end gap-3">
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
            <Link href="/try-on" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("nav.tryOn")}
            </Link>
            <Link href="/#features" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("nav.features")}
            </Link>
            <Link href="/#pricing" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("common.pricing")}
            </Link>
          </div>
        </details>
      </div>
    </header>
  )
}
