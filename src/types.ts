import { isPlainObject, UnknownObject } from 'ytil'
import Document from './Document'
import Endpoint from './Endpoint'

// ------
// Database

export interface DatabaseOptions<D extends AnyDocument> {
  getID:         (item: DocumentData<D>) => D['id']
  getDocument:   (item: DocumentData<D>) => D
  emptyDocument: (id: D['id']) => D
}

// ------
// Endpoint

export type AnyEndpoint = Endpoint<AnyDocument, any, any>

export interface EndpointOptions<P, D extends AnyDocument, M = unknown> {
  defaultParams?: P
  initialParams?: P
  data?:          Array<DocumentData<D>>
  meta?:          M | null
}

export interface CollectionFetchOptions {
  append?: boolean
}

export interface AppendOptions {
  ignoreIfExists?: boolean
}

export interface SetParamsOptions<P> {
  /**
   * Set to `'always'` to always fetch, `'refetch'` to only fetch if the endpoint is already done, or `'never'` to never
   * fetch. Default: `'refetch'`.
   */
  fetch?: 'always' | 'refetch' | 'never'

  /**
   * Clears the endpoint before setting the new parameters. Set this to `true` if you want to show a loading screen
   * if the endpoint is empty, like when switching pages. Set this to `false` if you just want to update an existing
   * view. You can also specify a function to compare the previous parameters to the current ones. Default: `false`.
   */
  clear?: boolean | ((prevParams: P, currParams: P) => boolean)

  /**
   * If not specified, or left to `false`, if the new parameters are not different than the existing
   * parameters, the call will be a no-op. Set this to `true` to always replace parameters and optionall re-fetch.
   * Default: `false`.
   */
  force?: boolean
}

// ------
// Document

export type AnyDocument = Document<any, any, any, any>

export interface DocumentOptions<T, M, P> {
  initialData?: T | null
  initialMeta?: M | null

  defaultParams?: P
  initialParams?: P
}

export type DocumentData<D extends Document<any, any, any, any>> =
  D extends Document<infer T, any, any, any> ? T : never

export interface FetchOptions {
  force?: boolean
}

// ------
// Optimistic updates

export interface OptimisticUpdateSpec<D, M = unknown> {
  prepare: (data: D) => D
  update:  () => Promise<DocumentFetchResponse<D, M>>
}

// ------
// Responses

export type FetchStatus = 'idle' | 'fetching' | 'done' | Error

export type CollectionFetchResponse<T = UnknownObject<string>, M = unknown> = CollectionFetchResponseSuccess<T, M> | FetchResponseError
export type DocumentFetchResponse<T = UnknownObject<string>, M = unknown> = DocumentFetchResponseSuccess<T, M> | FetchResponseError

export interface CollectionFetchResponseSuccess<T, M = unknown> {
  data:  T[]
  meta?: M
}

export interface DocumentFetchResponseSuccess<T, M = unknown> {
  data:  T
  meta?: M
}

export interface FetchResponseError {
  error: Error
}

function isSuccessResponse<T, M = unknown>(response: CollectionFetchResponse<T, M>): response is CollectionFetchResponseSuccess<T, M>
function isSuccessResponse<T, M = unknown>(response: DocumentFetchResponse<T, M>): response is DocumentFetchResponseSuccess<T, M>
function isSuccessResponse(response: unknown) {
  if (!isPlainObject(response)) { return false }
  return response.data != null
}

function isErrorResponse(response: CollectionFetchResponse<unknown, unknown> | DocumentFetchResponse<unknown, unknown>): response is FetchResponseError {
  if (!isPlainObject(response)) { return false }
  return response.error != null
}

function isNotFoundResponse(response: CollectionFetchResponse<unknown, unknown> | DocumentFetchResponse<unknown, unknown>): response is FetchResponseError {
  if (!isPlainObject(response)) { return false }
  if (!isPlainObject(response.error)) { return false }

  return response.error.status === 404
}

export { isSuccessResponse, isErrorResponse, isNotFoundResponse }
