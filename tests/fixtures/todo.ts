// A deterministic model fixture for Docker integration; never used by the product.
import type { BrowserStep } from '../../src/lib/browser-schema'
export const todoSource = `import React, { useState } from 'react'
export default function App() {
  const [todos, setTodos] = useState(() => { try { return JSON.parse(localStorage.getItem('todos') || '[]') } catch { return [] } })
  const [text, setText] = useState('')
  const save = (next) => { setTodos(next); try { localStorage.setItem('todos', JSON.stringify(next)) } catch {} }
  return <main><h1>待办应用</h1>
    <section>
      <label>新待办<input value={text} onChange={e => setText(e.target.value)} /></label><button type="button" onClick={() => { if (text.trim()) { save([...todos, { id: Date.now(), text: text.trim(), done: false }]); setText('') } }}>添加</button>
    </section>
    <ul>{todos.map(todo => <li key={todo.id}>
      <label><input type="checkbox" checked={todo.done} onChange={() => save(todos.map(t => t.id === todo.id ? { ...t, done: !t.done } : t))}/>{todo.text}</label>
      <button onClick={() => save(todos.filter(t => t.id !== todo.id))}>删除</button>
    </li>)}</ul>
  </main>
}`
export const categorizedTodoSource = todoSource
  .replace(
    "const [text, setText] = useState('')",
    "const [text, setText] = useState('')\n  const [category, setCategory] = useState('工作')\n  const [filter, setFilter] = useState('全部')",
  )

  .replace('done: false }', 'done: false, category }')
  .replace(
    '<section>',
    '<section><label>待办分类<select value={category} onChange={e => setCategory(e.target.value)}><option>工作</option><option>生活</option></select></label>',
  )
  .replace(
    '<ul>{todos.map',
    '<label>分类筛选<select value={filter} onChange={e => setFilter(e.target.value)}><option>全部</option><option>工作</option><option>生活</option></select></label><ul>{todos.filter(t => filter === "全部" || (t.category || "工作") === filter).map',
  )

const action = (
  action: BrowserStep['action'],
  selector: string,
  value = '',
): BrowserStep => ({ action, selector, value })
export const todoSteps: BrowserStep[] = [
  action('fill', 'input:not([type])', '浏览器验收任务'),
  action('click', 'section button'),
  action('assert_count', 'li', '1'),
  action('assert_text', 'li', '浏览器验收任务'),
  action('check', 'input[type="checkbox"]'),
  action('assert_checked', 'input[type="checkbox"]', 'true'),
  action('click', 'li button'),
  action('assert_count', 'li', '0'),
]
export const categorizedTodoSteps: BrowserStep[] = [
  action('fill', 'input:not([type])', '工作任务'),
  action('click', 'section button'),
  action('select', 'section select', '生活'),
  action('fill', 'input:not([type])', '生活任务'),
  action('click', 'section button'),
  action('assert_count', 'li', '2'),
  action('select', 'main > label select', '工作'),
  action('assert_count', 'li', '1'),
  action('assert_text', 'li', '工作任务'),
  action('select', 'main > label select', '生活'),
  action('assert_count', 'li', '1'),
  action('assert_text', 'li', '生活任务'),
  action('check', 'input[type="checkbox"]'),
  action('assert_checked', 'input[type="checkbox"]', 'true'),
  action('click', 'li button'),
  action('assert_count', 'li', '0'),
  action('select', 'main > label select', '全部'),
  action('assert_count', 'li', '1'),
  action('assert_text', 'li', '工作任务'),
]
