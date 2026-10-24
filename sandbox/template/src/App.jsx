import React, { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="workspace">
      <header>
        <span>✳ PIXLOOM LAB</span>
        <span>REACT + VITE</span>
      </header>
      <section>
        <p className="eyebrow">YOUR FIRST CONTAINER WORKSPACE</p>
        <h1>
          让一个想法，
          <br />
          <em>真正运行起来。</em>
        </h1>
        <p className="description">
          这个 React 应用在独立 Docker
          环境中构建。试试下面的按钮，确认应用已就绪。
        </p>
        <div className="counter">
          <button aria-label="减一" onClick={() => setCount(count - 1)}>
            −
          </button>
          <output aria-live="polite">{count}</output>
          <button aria-label="加一" onClick={() => setCount(count + 1)}>
            +
          </button>
        </div>
        <button className="reset" onClick={() => setCount(0)}>
          重新开始 ↺
        </button>
      </section>
      <footer>
        <span>手写环境验证模板 · 非 AI 生成</span>
        <span>BUILD. RUN. ITERATE.</span>
      </footer>
    </main>
  )
}
