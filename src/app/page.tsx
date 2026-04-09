import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Zap, Image, Sparkles, FileText, User, Dog, Wand2, Palette, Scissors, ImagePlus, Stamp } from "lucide-react"

const productImageMenus = [
  { name: "商品主图", icon: Image, href: "/generator" },
  { name: "卖点图", icon: Sparkles, href: "#features" },
  { name: "详情页图", icon: FileText, href: "#features" },
]

const sceneImageMenus = [
  { name: "人物模特", icon: User },
  { name: "宠物模特", icon: Dog },
  { name: "模特局部生成", icon: Wand2 },
  { name: "替换背景", icon: Palette },
]

const imageToolMenus = [
  { name: "一键抠图", icon: Scissors },
  { name: "参考图生成", icon: ImagePlus },
  { name: "Logo生成", icon: Stamp },
]

const featureCards = [
  {
    title: "商品图生成",
    description: "输入商品信息，快速生成主图、卖点图和详情页图，覆盖完整电商素材链路。",
  },
  {
    title: "场景图生成",
    description: "支持人物模特、宠物模特、局部重绘与背景替换，轻松打造高质感营销视觉。",
  },
  {
    title: "高效协作",
    description: "统一素材管理与版本留存，支持团队快速迭代，提升上新效率。",
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#home" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">FlashLoom</span>
          </a>

          <NavigationMenu className="hidden md:flex">
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink
                  href="#home"
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
                  定价
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        <div className="border-t px-4 py-3 md:hidden sm:px-6">
          <details>
            <summary className="cursor-pointer list-none text-sm font-semibold">导航菜单</summary>
            <div className="mt-3 space-y-3 text-sm">
              <a href="#home" className="block rounded-md px-2 py-1 hover:bg-accent">
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
                    <a key={item.name} href="#features" className="block rounded-md px-2 py-1 hover:bg-accent">
                      {item.name}
                    </a>
                  ))}
                </div>
              </details>
              <details>
                <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-accent">图片工具</summary>
                <div className="mt-1 space-y-1 pl-4">
                  {imageToolMenus.map((item) => (
                    <a key={item.name} href="#features" className="block rounded-md px-2 py-1 hover:bg-accent">
                      {item.name}
                    </a>
                  ))}
                </div>
              </details>
              <a href="#pricing" className="block rounded-md px-2 py-1 hover:bg-accent">
                定价
              </a>
            </div>
          </details>
        </div>
      </header>

      <section id="home" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-20 sm:px-6">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-4">
            AI 电商视觉生产平台
          </Badge>
          <h1 className="text-4xl font-bold leading-tight tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
            一站式生成商品主图、场景图与详情页素材
          </h1>
          <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
            FlashLoom 通过智能生成与编辑能力，让品牌和商家在几分钟内产出高质量商品视觉内容，快速完成上新与投放。
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button size="lg" asChild>
              <a href="/generator">立即体验</a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#pricing">查看定价</a>
            </Button>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">产品介绍</h2>
          <p className="mt-4 text-lg text-muted-foreground">覆盖商品内容生成全流程，让视觉素材创作更快、更稳、更具商业转化力。</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {featureCards.map((card) => (
            <Card key={card.title}>
              <CardHeader>
                <CardTitle>{card.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">{card.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <Card className="p-8">
          <CardHeader>
            <CardTitle className="text-3xl">定价</CardTitle>
            <CardDescription className="text-base">
              提供灵活套餐，支持按量付费与企业定制。可根据团队规模与出图需求自由扩展。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="#home">联系销售</a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
