import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TaskProgress } from '../src/components/task-progress'
import type { TaskEvent, TaskSummary } from '../src/lib/types'

const event = (message: string, type?: TaskEvent['type'], tool?: string) => ({
  at: '2026-10-25T15:00:00Z',
  message,
  type,
  tool,
})
const render = (
  events: TaskEvent[],
  status: TaskSummary['status'] = 'running',
) =>
  renderToStaticMarkup(
    createElement(TaskProgress, {
      label: '正在处理需求',
      task: {
        id: 'task',
        projectId: 'project',
        kind: 'agent',
        status,
        baseVersionId: null,
        expectedDraftRevision: 1,
        attemptId: null,
        targetVersionId: null,
        resultVersionId: null,
        summary: '创建食谱',
        agent: null,
        events,
        error: null,
        createdAt: '2026-10-25T15:00:00Z',
        updatedAt: '2026-10-25T15:00:00Z',
      },
    }),
  )

describe('task progress presentation', () => {
  it('hides model turn markers from history and keeps the last meaningful progress', () => {
    const html = render([
      event('模型第 4/100 步 · gemini-3.5-flash', 'model'),
      event('工具 read_file · src/App.jsx', 'tool', 'read_file'),
      event('模型第 5/100 步 · gemini-3.5-flash', 'model'),
      event('  '),
    ])
    expect(html).not.toContain('模型第')
    expect(html).not.toContain('gemini-3.5-flash')
    expect(html).toContain('读取文件 src/App.jsx')
    expect(html.split('class="task-latest-progress"')[1]).toContain(
      '读取文件 src/App.jsx',
    )
  })

  it('renders historical tool events without metadata and keeps model explanations', () => {
    const html = render([
      event('工具 list_files'),
      event('工具 edit_file · src/App.jsx'),
      event('接下来添加 **收藏筛选**。', 'model'),
      event('工具 future_tool · 额外信息', 'tool', 'future_tool'),
    ])
    expect(html).toContain('列出文件')
    expect(html).toContain('编辑文件 src/App.jsx')
    expect(html).toContain('<strong>收藏筛选</strong>')
    expect(html).toContain('工具 future_tool · 额外信息')
  })

  it('preserves complete multiline logs behind an expandable action row', () => {
    const html = render([event('构建失败\nsrc/App.jsx:12 缺少右括号', 'build')])
    expect(html).toContain('<details class="task-event-details">')
    expect(html).toContain('<pre class="task-log">构建失败\n')
    expect(html).toContain('src/App.jsx:12 缺少右括号')
  })

  it('handles empty meaningful history and hides latest progress after all terminal states', () => {
    const events = [event('模型第 1/100 步 · gemini-3.5-flash', 'model')]
    expect(render(events)).toContain('等待新的进展…')
    expect(render(events)).not.toContain('task-latest-progress')
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const html = render([event('工具 build', 'tool', 'build')], status)
      expect(html).not.toContain('task-latest-progress')
      expect(html).toContain('运行构建')
      expect(html).not.toContain(' open=')
    }
  })
})
