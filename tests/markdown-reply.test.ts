import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownReply } from '../src/components/markdown-reply'

const render = (text: string) =>
  renderToStaticMarkup(createElement(MarkdownReply, { children: text }))

describe('agent Markdown replies', () => {
  it('renders Chinese replies with headings, emphasis, nested lists and code', () => {
    const html = render(
      [
        '已实现 **番茄钟**。',
        '',
        '### 核心亮点',
        '',
        '1. **专注时段管理**',
        '   - 支持工作和休息',
        '   - 使用 `localStorage` 保存',
        '',
        '```js',
        'const minutes = 25',
        '```',
      ].join('\n'),
    )

    expect(html).toContain('<strong>番茄钟</strong>')
    expect(html).toContain('<h3>核心亮点</h3>')
    expect(html).toMatch(/<ol>\s*<li>[\s\S]*<ul>/)
    expect(html).toContain('<code>localStorage</code>')
    expect(html).toContain(
      '<pre><code class="language-js">const minutes = 25\n</code></pre>',
    )
    expect(html).not.toContain('###')
  })

  it('supports tables, task lists, strikethrough and links', () => {
    const html = render(`| 模式 | 时长 |
| --- | --- |
| 工作 | 25 分钟 |

- [x] 已完成
- [ ] 待处理

~~旧版本~~ [预览](https://example.com)`)

    expect(html).toContain('<div class="markdown-table"><table>')
    expect(html).toContain('<th>模式</th>')
    expect(html).toContain('<td>25 分钟</td>')
    expect(html).toContain('type="checkbox" disabled="" checked=""')
    expect(html).toContain('<del>旧版本</del>')
    expect(html).toContain(
      'href="https://example.com" target="_blank" rel="noopener noreferrer"',
    )
  })

  it('keeps raw HTML inert and blocks executable link URLs', () => {
    const html = render(`<script>alert(1)</script>

<img src=x onerror="alert(1)">

[危险链接](javascript:alert%281%29)`)

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('危险链接')
  })

  it('still renders plain text fallback replies', () => {
    expect(render('修改已完成，预览已更新。')).toContain(
      '<p>修改已完成，预览已更新。</p>',
    )
  })
})
