import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TaskProgress } from '../src/components/task-progress'
import type { TaskEvent, TaskSummary } from '../src/lib/types'

const event = (
  message: string,
  type?: TaskEvent['type'],
  tool?: string,
  output?: string,
) => ({
  at: '2026-10-25T15:00:00Z',
  message,
  type,
  tool,
  output,
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

  it('uses concise per-record summaries and shows actual tool results in each detail', () => {
    const html = render([
      event(
        '工具 read_file · src/App.jsx · 请求 1:1–100 行 · 返回 1:1–40:20（共 120 行） · 已截断\n续读参数：{"startLine":40,"startColumn":21}',
        'tool',
        'read_file',
        '1: const category = "工作"\n2: return <button>新增分类</button>\n\n…本次返回内容已截断，可继续读取。',
      ),
      event(
        '工具 search_files · "新增分类" · 命中 2 处\n匹配位置：\nsrc/App.jsx:40\nsrc/styles.css:12',
        'tool',
        'search_files',
        'src/App.jsx:40\n<button>新增分类</button>\n\nsrc/styles.css:12\n.category { color: blue; }',
      ),
    ])
    expect(html).toContain('读取文件 src/App.jsx</span>')
    expect(html).toContain('搜索文件 &quot;新增分类&quot;</span>')
    expect(html).toContain('const category = &quot;工作&quot;')
    expect(html).toContain('&lt;button&gt;新增分类&lt;/button&gt;')
    expect(html).not.toContain('<button>新增分类</button>')
    expect(html).toContain('已截断')
    expect(html).not.toContain('请求 1:1')
    expect(html).not.toContain('续读参数')
    expect(html).not.toContain('startColumn')
    expect(html).not.toContain('命中 2 处')
    expect(html).toContain('src/styles.css:12')
    expect(html).toContain('.category { color: blue; }')
    expect(html).toContain('<details class="task-event-details">')
    expect(html.match(/<details class="task-event-details">/g)).toHaveLength(2)
    expect(html).not.toContain('查看技术日志')
    expect(html.split('class="task-latest-progress"')[1]).not.toContain('命中')
  })

  it('expands short errors and empty results, and explains missing historical output', () => {
    const html = render([
      event(
        '工具 read_file · src/missing.jsx · 请求 1:1–10 行 · 失败：文件不存在',
        'tool',
        'read_file',
        '文件不存在',
      ),
      event(
        '工具 search_files · "missing" · 命中 0 处',
        'tool',
        'search_files',
        '未找到匹配内容。',
      ),
      event('工具 list_files', 'tool', 'list_files', ''),
      event(
        '工具 read_file · src/old.jsx · 请求 1:1–10 行\n请求范围已完整返回。',
        'tool',
        'read_file',
      ),
    ])
    expect(html).toContain('<pre class="task-log">文件不存在</pre>')
    expect(html).toContain('<pre class="task-log">未找到匹配内容。</pre>')
    expect(html).toContain('没有返回文本。')
    expect(html).toContain('此历史记录未保存工具返回内容。')
    expect(html).not.toContain('请求范围已完整返回')
    expect(html).not.toContain('请求 1:1')
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
