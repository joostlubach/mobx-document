import { isFunction } from 'lodash'
import Logger from 'logger'
import { action, computed, makeObservable, observable } from 'mobx'
import { EmptyObject, isPlainObject, objectEquals } from 'ytil'
import Database from './Database'
import { Fetch } from './Fetch'
import {
  AnyDocument,
  AppendOptions,
  CollectionFetchOptions,
  CollectionFetchResponse,
  DocumentData,
  EndpointOptions,
  FetchStatus,
  isErrorResponse,
  SetParamsOptions,
} from './types'

const logger = new Logger('mobx-document')

export default abstract class Endpoint<
  D extends AnyDocument,
  P extends object = EmptyObject<string>,
  M extends object = EmptyObject<string>
> {

  constructor(
    public readonly database: Database<D>,
    ...args: {} extends P ? [options?: EndpointOptions<P, D, M>] : [options: EndpointOptions<P, D, M> & {initialParams: P}]
  ) {
    this.options = args[0] ?? {}

    this.defaultParams = {...this.options.defaultParams as P}
    this.params = {...this.options.initialParams as P}

    if (this.options.meta != null) {
      this.meta = this.options.meta
    }

    makeObservable(this)

    if (this.options.data != null) {
      this.replace(this.options.data)
      this.fetchStatus = 'done'
    }
  }

  protected options:       EndpointOptions<P, D, M>
  protected defaultParams: P

  @observable.ref
  protected params: P

  public param<K extends keyof P>(name: K): P[K] {
    return this.params[name]
  }

  @action
  public setParams(params: Partial<P>, options: SetParamsOptions<P> = {}) {
    const {
      clear = false,
      fetch = 'refetch',
      force = false,
    } = options

    const paramsBefore = this.params
    this.params = {
      ...this.params,
      ...params,
    }

    const firstFetch = this.fetchStatus === 'idle'
    if (!force && !firstFetch && objectEquals(paramsBefore, this.params)) {
      return
    }

    const shouldClear = isFunction(clear) ? clear(paramsBefore, this.params) : clear
    if (shouldClear) { this.clear() }
    
    const shouldFetch = fetch === 'always' || (fetch === 'refetch' && this.fetchStatus === 'done')
    if (shouldFetch) { this.fetch() }
  }

  @action
  public reset(params?: Partial<P>) {
    this.params = {
      ...this.defaultParams,
      ...params,
    }
    this.fetch()
  }

  @observable.ref
  public ids: Array<D['id']> = []

  @computed
  public get documents() {
    return this.database.listDocuments(this.ids)
  }

  @computed
  public get data() {
    return this.database.list(this.ids)
  }

  @computed
  public get count(): number {
    return this.ids.length
  }

  @computed
  public get empty() {
    return this.data.length === 0
  }

  @observable.shallow
  public meta: M | null = null

  @computed
  public get asFetch(): Fetch<DocumentData<D>[]> {
    if (this.fetchStatus !== 'done') {
      return {status: this.fetchStatus}
    } else {
      return {status: 'done', data: this.data}
    }
  }

  // ------
  // Fetch

  @observable
  public fetchStatus: FetchStatus = 'idle'

  private lastFetchPromise: Promise<void> | null = null
  private lastFetchParams:  object | null = null

  @action
  public markFetched() {
    this.fetchStatus = 'done'
  }

  @action
  public async fetchIfNeeded(options: CollectionFetchOptions = {}): Promise<void> {
    if (this.fetchStatus === 'done') { return }
    await this.fetch(options)
  }

  @action
  public fetch(options: CollectionFetchOptions = {}): Promise<void> {
    const {params, lastFetchParams} = this
    if (this.lastFetchPromise != null && lastFetchParams != null && objectEquals(params, lastFetchParams)) {
      return this.lastFetchPromise
    }

    this.fetchStatus = 'fetching'

    const promise: Promise<void> = this
      .performFetch(this.mergedParams, options)
      .then(
        response => this.onFetchSuccess(promise, response, options),
        response => this.onFetchError(promise, response),
      )

    this.lastFetchParams = {...params}
    this.lastFetchPromise = promise

    return promise
  }

  public get mergedParams() {
    return {
      ...this.defaultParams,
      ...this.params,
    }
  }

  protected abstract performFetch(params: P, options: CollectionFetchOptions): Promise<CollectionFetchResponse<DocumentData<D>, M> | null>

  private onFetchSuccess = action((promise: Promise<unknown>, response: CollectionFetchResponse<DocumentData<D>, M> | null, options: CollectionFetchOptions) => {
    if (promise !== this.lastFetchPromise) { return }

    this.lastFetchPromise = null
    this.lastFetchParams = null

    if (response == null) { return }

    if (isErrorResponse(response)) {
      this.fetchStatus = response.error
      this.meta = this.options.meta ?? null
    } else if (options.append) {
      this.fetchStatus = 'done'
      this.append(response.data, response.meta)
    } else {
      this.fetchStatus = 'done'
      this.replace(response.data, response.meta)
    }
  })

  @action
  private onFetchError = (promise: Promise<unknown>, error: Error) => {
    if (promise !== this.lastFetchPromise) { return }

    this.lastFetchPromise = null
    this.lastFetchParams = null
    this.fetchStatus = error
    logger.error(`Error while fetching collection: ${error.message}`, error)
  }

  // ------
  // Updates

  @action
  public replace(data: DocumentData<D>[], meta?: M) {
    this.ids = []
    this.append(data, meta)
    this.fetchStatus = 'done'
  }

  @action
  public replaceMeta(meta: M) {
    this.meta = meta
  }

  @action
  public updateMeta(meta: Partial<M>) {
    if (this.meta == null) { return }
    this.meta = {...this.meta, meta}
  }

  @action
  public append(data: DocumentData<D>[], meta?: M) {
    for (const item of data) {
      if (isPlainObject(item) && 'data' in item && 'meta' in item) {
        this.add(item.data as DocumentData<D>, item.meta as M)
      } else {
        this.add(item)
      }
    }

    if (meta !== undefined) {
      this.meta = meta
    }
  }

  @action
  public add(item: DocumentData<D>, meta?: D['meta'], replaceMeta: boolean = false) {
    const document = this.store(item)
    if (meta != null) {
      if (document.meta != null && !replaceMeta) {
        document.mergeMeta(meta)
      } else {
        document.setMeta(meta)
      }
    }
    this.ids = [...this.ids, document.id]
  }

  @action
  public insert(item: DocumentData<D>, index: number) {
    const document = this.store(item)
    this.ids = [
      ...this.ids.slice(0, index),
      document.id,
      ...this.ids.slice(index),
    ]
  }

  @action
  public appendIDs(ids: D['id'][], options: AppendOptions = {}) {
    for (const id of ids) {
      this.appendID(id, options)
    }
  }

  @action
  public appendID(id: D['id'], options: AppendOptions = {}) {
    const {
      ignoreIfExists = true,
    } = options

    if (ignoreIfExists && this.ids.includes(id)) { return }
    this.ids = [...this.ids, id]
  }

  @action
  public remove(ids: Array<D['id']>, deleteFromDB: boolean = true) {
    this.ids = this.ids.filter(id => !ids.includes(id))

    if (deleteFromDB) {
      for (const id of ids) {
        this.database.delete(id)
      }
    }
  }

  @action
  public clear() {
    this.ids = []
    this.meta = this.options.meta ?? null
    this.fetchStatus = 'idle'
  }

  @action
  protected store(item: DocumentData<D>): D {
    return this.database.store(item)
  }

}
