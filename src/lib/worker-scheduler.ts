import { claimTask } from './store'
import { workerConcurrency } from './worker-config'
import type { Task } from './types'

// Keep tasks here until their cleanup finishes, even if the API has already
// cancelled them. Otherwise a new attempt could race the old container cleanup.
export class WorkerScheduler {
  private active = new Map<string, { task: Task; done: Promise<void> }>()

  constructor(
    private readonly owner: string,
    private readonly execute: (task: Task) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  dispatch() {
    while (this.active.size < workerConcurrency()) {
      const task = claimTask(this.owner, {
        excludeProjects: Array.from(this.active.values()).map(
          ({ task }) => task.projectId,
        ),
      })
      if (!task) break
      const done = Promise.resolve()
        .then(() => this.execute(task))
        .catch(this.onError)
        .finally(() => this.active.delete(task.id))
      this.active.set(task.id, { task, done })
    }
  }

  async drain() {
    await Promise.all(Array.from(this.active.values()).map(({ done }) => done))
  }
}
