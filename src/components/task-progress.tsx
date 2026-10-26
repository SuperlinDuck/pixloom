import {
  Check,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  Hammer,
  ListChecks,
  Loader2,
  MessageSquare,
  Pencil,
  Search,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react'
import type { TaskEvent, TaskSummary } from '@/lib/types'
import { isActive } from '@/lib/types'
import { MarkdownReply } from './markdown-reply'

// Hide internal setup messages that were recorded by older tasks.
const internalSetupMessages = new Set([
  '操作已排队，等待 Worker',
  '完整装载候选文件，当前可用版本和预览保持可访问',
])

const toolLabels = {
  list_files: { label: '列出文件', icon: Folder },
  read_file: { label: '读取文件', icon: FileText },
  search_files: { label: '搜索文件', icon: Search },
  write_file: { label: '写入文件', icon: Pencil },
  edit_file: { label: '编辑文件', icon: Pencil },
  delete_file: { label: '删除文件', icon: Trash2 },
  build: { label: '运行构建', icon: Hammer },
  browser_test: { label: '验证页面交互', icon: ListChecks },
  read_errors: { label: '读取错误日志', icon: Terminal },
  cloud_enable: { label: '配置云端服务', icon: Cloud },
  cloud_schema: { label: '读取数据表结构', icon: Cloud },
  cloud_test_account: { label: '准备测试账号', icon: ListChecks },
}

function eventPresentation(event: TaskEvent) {
  const tool = event.tool || event.message.match(/^工具\s+(\w+)/)?.[1]
  const action = toolLabels[tool as keyof typeof toolLabels]
  if (action) {
    let detail = event.message
      .replace(/^工具\s+\w+\s*(?:·\s*)?/, '')
      .split('\n')[0]
    if (tool === 'read_file') detail = detail.split(' · ')[0]
    if (tool === 'search_files')
      detail = detail.match(/^"(?:[^"\\]|\\.)*"/)?.[0] || ''
    if (detail.startsWith('失败：')) detail = ''
    return {
      icon: action.icon,
      text: `${action.label}${detail ? ` ${detail}` : ''}`,
    }
  }
  return {
    icon:
      event.type === 'build'
        ? Hammer
        : event.type === 'validation'
          ? ListChecks
          : event.type === 'ready'
            ? Check
            : event.type === 'model'
              ? MessageSquare
              : Terminal,
    text: event.message,
  }
}

function eventOutput(event: TaskEvent) {
  if (event.output !== undefined) return event.output || '没有返回文本。'
  const tool = event.tool || event.message.match(/^工具\s+(\w+)/)?.[1]
  if (tool === 'read_file' || tool === 'search_files')
    return '此历史记录未保存工具返回内容。'
  return event.message
}

function EventLine({ event }: { event: TaskEvent }) {
  const { icon: Icon, text } = eventPresentation(event)
  return (
    <>
      <Icon className="task-event-icon" size={14} aria-hidden="true" />
      <span className="task-event-text" title={text}>
        {text
          .split('\n')[0]
          .trimEnd()
          .replace(/[：:]$/, '')}
      </span>
    </>
  )
}

export function TaskProgress({
  task,
  label,
}: {
  task: TaskSummary
  label: string
}) {
  const reply = [...task.events]
    .reverse()
    .find((event) => event.type === 'reply' && event.message.trim())
  // Older tasks also recorded their final answer as a model event.
  const finalModel = [...task.events]
    .reverse()
    .find(
      (event) =>
        event.type === 'model' &&
        event.message.trim() &&
        (reply
          ? reply.message === event.message ||
            reply.message.startsWith(`${event.message}\n\n自动测试提示：`)
          : task.agent &&
            task.status === 'completed' &&
            !event.message.startsWith('模型第 ')),
    )
  const events = task.events.filter(
    (event) =>
      event.type !== 'reply' &&
      event !== finalModel &&
      event.message.trim() &&
      !(!event.type && internalSetupMessages.has(event.message.trim())) &&
      !/^模型第\s*\d+\s*\/\s*\d+\s*步(?:\s|·|$)/.test(event.message.trim()),
  )
  const latest = events[events.length - 1]
  const active = isActive(task)
  return (
    <div className="task-progress">
      <details className="task-process" key={active ? 'active' : 'finished'}>
        <summary
          className={`task-state ${task.status}`}
          aria-label={`${label}，执行详情`}
          title="展开或收起执行详情"
        >
          {active ? (
            <Loader2 className="spin" size={13} />
          ) : task.status === 'completed' ? (
            <Check size={13} />
          ) : (
            <Square size={12} />
          )}
          {label}
          <ChevronRight
            className="task-process-chevron"
            size={13}
            aria-hidden="true"
          />
        </summary>
        <div className="process">
          {events.length ? (
            <ol aria-label="执行记录">
              {events.map((event, index) => (
                <li key={index}>
                  {event.type === 'model' ? (
                    <div className="task-progress-note">
                      <MarkdownReply>{event.message}</MarkdownReply>
                    </div>
                  ) : event.output !== undefined ||
                    event.message.includes('\n') ||
                    event.message.length > 160 ? (
                    <details className="task-event-details">
                      <summary className="task-event-row">
                        <EventLine event={event} />
                        <ChevronRight
                          className="task-event-chevron"
                          size={12}
                          aria-hidden="true"
                        />
                      </summary>
                      <pre className="task-log">{eventOutput(event)}</pre>
                    </details>
                  ) : (
                    <div className="task-event-row">
                      <EventLine event={event} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="task-progress-empty">等待新的进展…</p>
          )}
        </div>
      </details>
      {task.status === 'queued' && (
        <div className="task-latest-progress" role="status">
          <p className="task-latest-note">
            {task.queue?.waitingForUser
              ? '等待你的上一项任务结束后执行。'
              : task.queue && task.queue.ahead > 0
                ? `当前有 ${task.queue.ahead} 位用户排在前面，系统会按用户轮流调度。`
                : '已进入队列，等待空闲执行名额。'}
          </p>
        </div>
      )}
      {task.status === 'running' && latest && (
        <div className="task-latest-progress" role="status">
          {latest.type === 'model' ? (
            <p className="task-latest-note" title={latest.message}>
              {latest.message}
            </p>
          ) : (
            <div className="task-event-row">
              <EventLine event={latest} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
