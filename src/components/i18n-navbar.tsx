"use client"

import { useTranslations } from "next-intl"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { Zap, Image, Sparkles, FileText, User, Dog, Wand2, Palette, Scissors, ImagePlus, Stamp } from "lucide-react"
import { LanguageSwitcher } from "@/components/language-switcher"
import { UserButton } from "@/components/auth/user-button"
import { Link } from "@/i18n/routing"

export function I18nNavbar() {
  const t = useTranslations()

  const productImageMenus = [
    { name: t("productImageMenus.mainImage"), icon: Image, href: "/generator" },
    { name: t("productImageMenus.sellingPoints"), icon: Sparkles, href: "#features" },
    { name: t("productImageMenus.detailPage"), icon: FileText, href: "#features" },
  ]

  const sceneImageMenus = [
    { name: t("sceneImageMenus.humanModel"), icon: User },
    { name: t("sceneImageMenus.petModel"), icon: Dog },
    { name: t("sceneImageMenus.partialGeneration"), icon: Wand2 },
    { name: t("sceneImageMenus.replaceBackground"), icon: Palette },
  ]

  const imageToolMenus = [
    { name: t("imageToolMenus.removeBackground"), icon: Scissors },
    { name: t("imageToolMenus.referenceGeneration"), icon: ImagePlus },
    { name: t("imageToolMenus.logoGeneration"), icon: Stamp },
  ]

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">FlashLoom</span>
        </Link>

        <NavigationMenu className="hidden md:flex">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink
                href="#home"
                className="group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
              >
                {t("common.home")}
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuTrigger>{t("nav.productImage")}</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid grid-cols-3 gap-2 p-4 w-[480px]">
                  {productImageMenus.map((item) => {
                    const Icon = item.icon
                    return (
                      <li key={item.name}>
                        <NavigationMenuLink asChild>
                          <a
                            href={item.href}
                            className="flex flex-col items-center gap-2 select-none rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          >
                            <Icon className="h-6 w-6" />
                            <span className="text-sm font-medium">{item.name}</span>
                          </a>
                        </NavigationMenuLink>
                      </li>
                    )
                  })}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuTrigger>{t("nav.sceneImage")}</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid grid-cols-3 gap-2 p-4 w-[480px]">
                  {sceneImageMenus.map((item) => {
                    const Icon = item.icon
                    return (
                      <li key={item.name}>
                        <NavigationMenuLink asChild>
                          <a
                            href="#features"
                            className="flex flex-col items-center gap-2 select-none rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          >
                            <Icon className="h-6 w-6" />
                            <span className="text-sm font-medium">{item.name}</span>
                          </a>
                        </NavigationMenuLink>
                      </li>
                    )
                  })}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuTrigger>{t("nav.imageTools")}</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid grid-cols-3 gap-2 p-4 w-[480px]">
                  {imageToolMenus.map((item) => {
                    const Icon = item.icon
                    return (
                      <li key={item.name}>
                        <NavigationMenuLink asChild>
                          <a
                            href="#features"
                            className="flex flex-col items-center gap-2 select-none rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          >
                            <Icon className="h-6 w-6" />
                            <span className="text-sm font-medium">{item.name}</span>
                          </a>
                        </NavigationMenuLink>
                      </li>
                    )
                  })}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink
                href="#pricing"
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
            <a href="#home" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("common.home")}
            </a>
            <details>
              <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-accent">
                {t("nav.productImage")}
              </summary>
              <div className="mt-1 space-y-1 pl-4">
                {productImageMenus.map((item) => (
                  <a key={item.name} href={item.href} className="block rounded-md px-2 py-1 hover:bg-accent">
                    {item.name}
                  </a>
                ))}
              </div>
            </details>
            <details>
              <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-accent">
                {t("nav.sceneImage")}
              </summary>
              <div className="mt-1 space-y-1 pl-4">
                {sceneImageMenus.map((item) => (
                  <a key={item.name} href="#features" className="block rounded-md px-2 py-1 hover:bg-accent">
                    {item.name}
                  </a>
                ))}
              </div>
            </details>
            <details>
              <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-accent">
                {t("nav.imageTools")}
              </summary>
              <div className="mt-1 space-y-1 pl-4">
                {imageToolMenus.map((item) => (
                  <a key={item.name} href="#features" className="block rounded-md px-2 py-1 hover:bg-accent">
                    {item.name}
                  </a>
                ))}
              </div>
            </details>
            <a href="#pricing" className="block rounded-md px-2 py-1 hover:bg-accent">
              {t("common.pricing")}
            </a>
          </div>
        </details>
      </div>
    </header>
  )
}
