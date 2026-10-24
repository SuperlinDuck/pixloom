export type Provider = 'gemini' | 'openai'
export type TaskStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type Project = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  currentVersionId: string | null
}
export type TaskEvent = { at: string; message: string }
export type Usage = { inputTokens: number; outputTokens: number }
export type Task = {
  id: string
  projectId: string
  prompt: string
  provider: Provider
  model: string
  status: TaskStatus
  events: TaskEvent[]
  error: string | null
  createdAt: string
  updatedAt: string
  usage: Usage | null
}
export type Version = {
  id: string
  projectId: string
  taskId: string | null
  number: number
  summary: string
  html: string
  createdAt: string
}
export type ProjectDetail = {
  project: Project
  tasks: Task[]
  versions: Version[]
}
export type ModelOption = {
  provider: Provider
  model: string
  label: string
  configured: boolean
}
export type SystemStatus = {
  models: ModelOption[]
  workerOnline: boolean
  storage: 'sqlite'
}
export const isActive = (task: Task) =>
  task.status === 'queued' || task.status === 'running'
