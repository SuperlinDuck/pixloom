const productImageMenus = ["商品主图", "卖点图", "详情页图"]
const sceneImageMenus = ["人物模特", "宠物模特", "模特局部生成", "替换背景"]

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
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#home" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500 text-sm font-bold text-white">
              FL
            </span>
            <span className="text-lg font-semibold tracking-tight text-slate-100">FlashLoom</span>
          </a>

          <nav className="hidden items-center gap-1 md:flex">
            <a
              href="#home"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              首页
            </a>

            <div className="group relative">
              <button className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800">
                商品图生成
              </button>
              <div className="invisible absolute left-0 top-full mt-2 w-40 rounded-lg border border-slate-700 bg-slate-900 p-2 opacity-0 shadow-xl shadow-slate-950/40 transition group-hover:visible group-hover:opacity-100">
                {productImageMenus.map((item) => (
                  <a
                    key={item}
                    href="#features"
                    className="block rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    {item}
                  </a>
                ))}
              </div>
            </div>

            <div className="group relative">
              <button className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800">
                场景图生成
              </button>
              <div className="invisible absolute left-0 top-full mt-2 w-44 rounded-lg border border-slate-700 bg-slate-900 p-2 opacity-0 shadow-xl shadow-slate-950/40 transition group-hover:visible group-hover:opacity-100">
                {sceneImageMenus.map((item) => (
                  <a
                    key={item}
                    href="#features"
                    className="block rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    {item}
                  </a>
                ))}
              </div>
            </div>

            <a
              href="#pricing"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              定价
            </a>
          </nav>
        </div>

        <div className="border-t border-slate-800 px-4 py-3 md:hidden sm:px-6">
          <details>
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-200">导航菜单</summary>
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              <a href="#home" className="block rounded-md px-2 py-1 hover:bg-slate-800">
                首页
              </a>
              <details>
                <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-slate-800">商品图生成</summary>
                <div className="mt-1 space-y-1 pl-4">
                  {productImageMenus.map((item) => (
                    <a key={item} href="#features" className="block rounded-md px-2 py-1 hover:bg-slate-800">
                      {item}
                    </a>
                  ))}
                </div>
              </details>
              <details>
                <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-slate-800">场景图生成</summary>
                <div className="mt-1 space-y-1 pl-4">
                  {sceneImageMenus.map((item) => (
                    <a key={item} href="#features" className="block rounded-md px-2 py-1 hover:bg-slate-800">
                      {item}
                    </a>
                  ))}
                </div>
              </details>
              <a href="#pricing" className="block rounded-md px-2 py-1 hover:bg-slate-800">
                定价
              </a>
            </div>
          </details>
        </div>
      </header>

      <section id="home" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-20 sm:px-6">
        <div className="max-w-3xl">
          <p className="mb-3 inline-flex rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-sky-300">
            AI 电商视觉生产平台
          </p>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            一站式生成商品主图、场景图与详情页素材
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">
            FlashLoom 通过智能生成与编辑能力，让品牌和商家在几分钟内产出高质量商品视觉内容，快速完成上新与投放。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#features"
              className="rounded-lg bg-sky-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-400"
            >
              立即体验
            </a>
            <a
              href="#pricing"
              className="rounded-lg border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              查看定价
            </a>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="mb-8">
          <h2 className="text-2xl font-bold sm:text-3xl">产品介绍</h2>
          <p className="mt-3 text-slate-300">覆盖商品内容生成全流程，让视觉素材创作更快、更稳、更具商业转化力。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {featureCards.map((card) => (
            <article
              key={card.title}
              className="rounded-xl border border-slate-700 bg-slate-900/70 p-5 shadow-md shadow-slate-950/30"
            >
              <h3 className="text-lg font-semibold">{card.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-8 shadow-xl shadow-slate-950/30">
          <h2 className="text-2xl font-bold">定价</h2>
          <p className="mt-2 text-slate-300">提供灵活套餐，支持按量付费与企业定制。可根据团队规模与出图需求自由扩展。</p>
          <a
            href="#home"
            className="mt-5 inline-flex rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
          >
            联系销售
          </a>
        </div>
      </section>
    </main>
  )
}
