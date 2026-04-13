"use client"

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { Zap, Image, Sparkles, FileText, User, Dog, Wand2, Palette, Scissors, ImagePlus, Stamp } from "lucide-react"
import { UserButton } from "@/components/auth/user-button"

const productImageMenus = [
  { name: "商品主图", icon: Image, href: "/generator" },
  { name: "卖点图", icon: Sparkles, href: "#features" },
  { name: "详情页图", icon: FileText, href: "#features" },
]

const sceneImageMenus = [
  { name: "人物模特", icon: User, href: "#features" },
  { name: "宠物模特", icon: Dog, href: "#features" },
  { name: "模特局部生成", icon: Wand2, href: "#features" },
  { name: "替换背景", icon: Palette, href: "#features" },
]

const imageToolMenus = [
  { name: "一键抠图", icon: Scissors, href: "#features" },
  { name: "参考图生成", icon: ImagePlus, href: "#features" },
  { name: "Logo生成", icon: Stamp, href: "#features" },
]

export function Navbar() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">FlashLoom</span>
        </a>

        <NavigationMenu className="hidden md:flex">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink
                href="/"
                className="group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
              >
                首页
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuTrigger>
                商品图生成
              </NavigationMenuTrigger>
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
              <NavigationMenuTrigger>
                场景图生成
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid grid-cols-3 gap-2 p-4 w-[480px]">
                  {sceneImageMenus.map((item) => {
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
              <NavigationMenuTrigger>
                图片工具
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid grid-cols-3 gap-2 p-4 w-[480px]">
                  {imageToolMenus.map((item) => {
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
              <NavigationMenuLink
                href="/#pricing"
                className="group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
              >
                定价
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <UserButton />
      </div>

      <div className="border-t px-4 py-3 md:hidden sm:px-6">
        <details>
          <summary className="cursor-pointer list-none text-sm font-semibold">导航菜单</summary>
          <div className="mt-3 space-y-3 text-sm">
            <a href="/" className="block rounded-md px-2 py-1 hover:bg-accent">
              首页
            </a>
            <details>
              <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-accent">商品图生成</summary>
              <div className="mt-1 space-y-1 pl-4">
                {productImageMenus.map((item) => (
                  <a key={item.name} href={item.href} className="block rounded-md px-2 py-1 hover:bg-accent">
                    {item.name}
                  </a>
                ))}
              </div>
            </details>
            <details>
              <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-accent">场景图生成</summary>
              <div className="mt-1 space-y-1 pl-4">
                {sceneImageMenus.map((item) => (
                  <a key={item.name} href={item.href} className="block rounded-md px-2 py-1 hover:bg-accent">
                    {item.name}
                  </a>
                ))}
              </div>
            </details>
            <details>
              <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-accent">图片工具</summary>
              <div className="mt-1 space-y-1 pl-4">
                {imageToolMenus.map((item) => (
                  <a key={item.name} href={item.href} className="block rounded-md px-2 py-1 hover:bg-accent">
                    {item.name}
                  </a>
                ))}
              </div>
            </details>
            <a href="/#pricing" className="block rounded-md px-2 py-1 hover:bg-accent">
              定价
            </a>
          </div>
        </details>
      </div>
    </header>
  )
}
