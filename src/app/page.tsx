import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Navbar } from "@/components/navbar"

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
