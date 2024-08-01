import { every, some } from 'lodash'

import { FetchStatus } from '../types'

export function combinedFetchStatus(...statuses: FetchStatus[]) {
  if (every(statuses, s => s === 'idle')) { return 'idle' }
  if (some(statuses, s => s === 'fetching')) { return 'fetching' }

  const errors = statuses.filter(s => s instanceof Error)
  if (errors.length > 0) {
    return errors[0]
  }

  // Special case: if multiple documents are waiting for each other, this should be considered fetching.
  if (some(statuses, s => s === 'idle') && some(statuses, s => s === 'done')) {
    return 'fetching'
  }

  return 'done'
}
