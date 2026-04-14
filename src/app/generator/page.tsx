import { Badge } from "@/components/ui/badge"
import { ProductImageGenerator } from "@/components/product-image-generator"
import { Navbar } from "@/components/navbar"

export default function GeneratorPage() {
  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      111112222
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-4">
            Gemini / Vertex AI
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">商品图生成工作台</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            初版先支持商品主图生成：填写商品信息、选择电商平台与视觉风格，调用 Vertex AI 上的 Gemini 图片生成模型返回预览图。
          </p>
        </div>

        <ProductImageGenerator />
      </section>
    </main>
  )
}
