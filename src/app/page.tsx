export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          FlashLoom
        </h1>
        <p className="text-2xl text-gray-600 mb-8">
          AI 商品图生成平台
        </p>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto">
          通过 AI 技术为电商卖家快速生成高质量的商品展示图
        </p>
        <div className="mt-12 flex gap-4 justify-center">
          <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            开始使用
          </button>
          <button className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            了解更多
          </button>
        </div>
      </div>
    </main>
  )
}
