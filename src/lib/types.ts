export type Provider = 'gemini' | 'openai'
export type Usage = { inputTokens: number; outputTokens: number }
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
export type SourceFile = { path: string; content: string }
export type Project = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  currentVersionId: string | null
}
export type Draft = {
  projectId: string
  baseVersionId: string | null
  revision: number
  files: SourceFile[]
  hash: string
  updatedAt: string
}
export type AgentState = {
  provider: Provider
  model: string
  prompt: string
  steps: number
  toolCalls: number
  buildFailures: number
  validationFailures?: number
  responseBytes: number
  reservedOutputTokens: number
  usage: Usage
  startedAt: number | null
}
export type TaskKind =
  | 'agent'
  | 'initialize'
  | 'commit'
  | 'restore'
  | 'preview'
  | 'start'
  | 'stop'
  | 'remove'
export type TaskStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TaskEvent = {
  at: string
  message: string
  type?: 'model' | 'tool' | 'build' | 'validation' | 'ready' | 'usage'
  tool?: string
}
export type Task = {
  id: string
  projectId: string
  kind: TaskKind
  status: TaskStatus
  baseVersionId: string | null
  expectedDraftRevision: number
  attemptId: string | null
  targetVersionId: string | null
  candidateFiles: SourceFile[]
  resultVersionId: string | null
  summary: string
  agent: AgentState | null
  events: TaskEvent[]
  error: string | null
  createdAt: string
  updatedAt: string
}
export type TaskSummary = Omit<Task, 'candidateFiles'>
export type Version = {
  id: string
  projectId: string
  number: number
  parentVersionId: string | null
  restoredFromVersionId: string | null
  source: 'template' | 'manual' | 'restore' | 'agent'
  taskId: string
  summary: string
  hash: string
  templateId: string
  artifactId: string
  createdAt: string
}
export type VersionDetail = Version & { files: SourceFile[] }
export type RuntimeInfo = {
  projectId: string
  state: 'absent' | 'running' | 'stopped' | 'error'
  loadedHash: string | null
  updatedAt: string
}
export type ProjectDetail = {
  project: Project
  draft: Omit<Draft, 'files'>
  tasks: TaskSummary[]
  versions: Version[]
  runtime: RuntimeInfo | null
}
export type FileOperation =
  | { type: 'write'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'rename'; path: string; to: string }
export type BuildAsset = { path: string; contentType: string; body: string }
export const isActive = (task: { status: TaskStatus }) =>
  task.status === 'queued' || task.status === 'running'
