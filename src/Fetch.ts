export type Fetch<T> = FetchIdle | FetchFetching | FetchDone<T> | FetchError

export type FetchIdle = {status: 'idle'}
export type FetchFetching = {status: 'fetching'}
export type FetchDone<T> = {status: 'done', data: T}
export type FetchError = {status: Error}

export const Fetch: {
  idle(): FetchIdle
  map<T, U>(fetched: Fetch<T>, map: (data: T) => U): Fetch<U>
} = {
  idle: () => ({status: 'idle'}),
  map:  (fetched, map) => {
    if (fetched.status === 'done') {
      return {status: 'done', data: map(fetched.data)}
    } else {
      return {...fetched}
    }
  },
}
