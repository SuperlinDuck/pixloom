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
  overrides: Partial<TaskSummary> = {},
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
        ...overrides,
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

  it('excludes final replies and their historical model copies from progress', () => {
    for (const status of ['running', 'completed'] as const) {
      for (const warning of ['', '\n\n自动测试提示：尚未进行功能测试。']) {
        const html = render(
          [
            event('接下来添加 **收藏筛选**。', 'model'),
            event('工具 edit_file · src/App.jsx', 'tool', 'edit_file'),
            event('已完成收藏功能。', 'model'),
            event('构建成功，预览就绪。', 'ready'),
            event(`已完成收藏功能。${warning}`, 'reply'),
          ],
          status,
        )
        expect(html).toContain('<strong>收藏筛选</strong>')
        expect(html).toContain('编辑文件 src/App.jsx')
        expect(html).toContain('构建成功，预览就绪。')
        expect(html).not.toContain('已完成收藏功能。')
        expect(html).not.toContain('自动测试提示')
        if (status === 'running')
          expect(html.split('class="task-latest-progress"')[1]).toContain(
            '构建成功，预览就绪。',
          )
      }
    }
  })

  it('excludes replies that have no historical model copy', () => {
    const html = render([
      event('工具 build', 'tool', 'build'),
      event('最终回复只应出现在正文。', 'reply'),
    ])
    expect(html).toContain('运行构建')
    expect(html).not.toContain('最终回复只应出现在正文。')
  })

  it('excludes the final model message used as a legacy completed reply', () => {
    const html = render(
      [
        event('先检查现有页面。', 'model'),
        event('工具 build', 'tool', 'build'),
        event('旧任务的完成回复。', 'model'),
        event('模型第 3/100 步 · gemini-3.5-flash', 'model'),
      ],
      'completed',
      {
        agent: {
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          prompt: '创建食谱',
          steps: 3,
          toolCalls: 1,
          buildFailures: 0,
          responseBytes: 100,
          reservedOutputTokens: 0,
          usage: { inputTokens: 10, outputTokens: 10 },
          startedAt: null,
        },
      },
    )
    expect(html).toContain('先检查现有页面。')
    expect(html).toContain('运行构建')
    expect(html).not.toContain('旧任务的完成回复。')
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
