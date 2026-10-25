export type SourceFile = { path: string; content: string }
export type DockerHealth = {
  available: boolean
  imageReady: boolean
  reason: string | null
  serverVersion?: string
}
export type CommandResult = {
  exitCode: number
  output: string
  timedOut: boolean
}
export type PreviewAsset = { status: number; contentType: string; body: string }
export interface ProjectRuntime {
  managedProjects?(): Promise<string[]>
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
    artifactId?: string,
  ): Promise<CommandResult>
  replaceFiles(
    projectId: string,
    files: SourceFile[],
    signal?: AbortSignal,
  ): Promise<void>
  exportBuild(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<import('../types').BuildAsset[]>
  templateId(): Promise<string>
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
