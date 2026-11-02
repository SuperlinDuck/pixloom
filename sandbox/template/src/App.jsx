import React, { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="workspace">
      <section>
        <h1>计数器</h1>
        <p className="description">点击按钮调整数值。</p>
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
          重新开始
        </button>
      </section>
    </main>
  )
}
