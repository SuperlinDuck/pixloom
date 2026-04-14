import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Navbar } from "@/components/navbar"
import { Zap, Image, Sparkles } from "lucide-react"

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
      <Navbar />

      <section id="home" className="relative overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-primary/20 via-primary/5 to-transparent blur-3xl" />
          <div className="absolute right-0 top-1/4 h-[400px] w-[400px] rounded-full bg-gradient-to-bl from-blue-500/10 via-purple-500/5 to-transparent blur-3xl" />
        </div>
        
        <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-24 sm:px-6 lg:pt-32">
          <div className="max-w-4xl">
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium">
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              AI 电商视觉生产平台
            </Badge>
            <h1 className="font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
              <span className="block">一站式生成</span>
              <span className="mt-2 block bg-gradient-to-r from-primary via-blue-600 to-purple-600 bg-clip-text text-transparent">
                商品主图、场景图
              </span>
              <span className="block">与详情页素材</span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              FlashLoom 通过智能生成与编辑能力，让品牌和商家在几分钟内产出高质量商品视觉内容，快速完成上新与投放。
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button size="lg" className="h-12 px-8 text-base font-semibold shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30" asChild>
                <a href="/generator">
                  <Zap className="mr-2 h-4 w-4" />
                  立即体验
                </a>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-8 text-base font-semibold" asChild>
                <a href="#pricing">查看定价</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-t bg-muted/30">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <div className="mb-14 text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">产品介绍</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
              覆盖商品内容生成全流程，让视觉素材创作更快、更稳、更具商业转化力。
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {featureCards.map((card, index) => (
              <Card key={card.title} className="group relative overflow-hidden border-0 bg-background shadow-lg transition-all hover:-translate-y-1 hover:shadow-xl">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-blue-500 to-purple-500 opacity-0 transition-opacity group-hover:opacity-100" />
                <CardHeader className="pb-4">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    {index === 0 && <Image className="h-6 w-6" />}
                    {index === 1 && <Sparkles className="h-6 w-6" />}
                    {index === 2 && <Zap className="h-6 w-6" />}
                  </div>
                  <CardTitle className="font-display text-xl">{card.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base leading-relaxed">{card.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-primary/5 via-background to-blue-500/5 p-8 shadow-xl sm:p-12">
          <div className="absolute right-0 top-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 blur-3xl" />
          <CardHeader className="relative p-0 pb-6">
            <CardTitle className="font-display text-3xl sm:text-4xl">定价方案</CardTitle>
            <CardDescription className="mt-3 max-w-xl text-base leading-relaxed">
              提供灵活套餐，支持按量付费与企业定制。可根据团队规模与出图需求自由扩展。
            </CardDescription>
          </CardHeader>
          <CardContent className="relative p-0">
            <Button size="lg" className="h-12 px-8 text-base font-semibold shadow-lg shadow-primary/25" asChild>
              <a href="#home">联系销售</a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
