export type SourceFile = { path: string; content: string }
export type RuntimeAction =
  'create' | 'start' | 'build' | 'stop' | 'remove' | 'write'
export type RuntimeState = 'absent' | 'running' | 'ready' | 'stopped' | 'error'
export type RuntimeJob = {
  id: string
  projectId: string
  action: RuntimeAction
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  payload: { path?: string; content?: string }
  events: { at: string; message: string }[]
  error: string | null
  createdAt: string
  updatedAt: string
}
export type RuntimeWorkspace = {
  projectId: string
  token: string
  state: RuntimeState
  built: boolean
  files: SourceFile[]
  updatedAt: string
}
export type DockerHealth = {
  available: boolean
  imageReady: boolean
  reason: string | null
  serverVersion?: string
}
export type RuntimeDetail = {
  workspace: RuntimeWorkspace | null
  jobs: RuntimeJob[]
}
export type CommandResult = {
  exitCode: number
  output: string
  timedOut: boolean
}
export type PreviewAsset = { status: number; contentType: string; body: string }
export interface ProjectRuntime {
  health(): Promise<DockerHealth>
  prepare(signal?: AbortSignal): Promise<void>
  create(
    projectId: string,
    token: string,
    files: SourceFile[],
    signal?: AbortSignal,
  ): Promise<void>
  start(
    projectId: string,
    files: SourceFile[],
    signal?: AbortSignal,
  ): Promise<void>
  state(projectId: string): Promise<'absent' | 'running' | 'stopped'>
  stop(projectId: string): Promise<void>
  remove(projectId: string): Promise<void>
  listFiles(projectId: string): Promise<{ path: string; size: number }[]>
  searchFiles(
    projectId: string,
    query: string,
  ): Promise<{ path: string; line: number; text: string }[]>
  readFile(
    projectId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<string>
  writeFile(
    projectId: string,
    path: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<void>
  execute(
    projectId: string,
    command: 'build',
    signal?: AbortSignal,
  ): Promise<CommandResult>
  logs(projectId: string): Promise<string>
  preview(projectId: string, path: string): Promise<PreviewAsset>
}
export class RuntimeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}
