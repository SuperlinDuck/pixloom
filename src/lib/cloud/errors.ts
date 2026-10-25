import { StoreError } from '../store'

// Candidate source can be repaired by the Engineer; credentials, quotas and upstream failures cannot.
export class CloudDefinitionError extends StoreError {}

export class CloudApiError extends StoreError {
  constructor(
    message: string,
    status: number,
    readonly outcome: 'rejected' | 'unknown',
  ) {
    super(message, status)
  }
}
