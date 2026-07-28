import { isFunction } from 'lodash'
import Logger from 'logger'
import { action, computed, makeObservable, observable, runInAction } from 'mobx'
import { EmptyObject, objectEquals } from 'ytil'
import { Database } from './Database'
import { Fetch } from './Fetch'
import {
  AppendOptions,
  CollectionFetchOptions,
  CollectionFetchResponse,
  EndpointOptions,
  FetchStatus,
  IdOf,
  isErrorResponse,
  SetParamsOptions,
} from './types'

const logger = new Logger('mobx-document')

export abstract class Endpoint<
  T,
  Id = IdOf<T>,
  P extends object = EmptyObject,
  M extends object = EmptyObject
> {

  constructor(
    database: Database<T, M, Id> | null = null,
    ...args: {} extends P ? [options?: EndpointOptions<P, T, M>] : [options: EndpointOptions<P, T, M> & {initialParams: P}]
  ) {
    this.database = database ?? new Database()
    this.options = args[0] ?? {}

    this.defaultParams = {...this.options.defaultParams as P}
    this._params = {
      ...this.defaultParams as P,
      ...this.options.initialParams as P,
    }

    if (this.options.meta != null) {
      this.meta = this.options.meta
    }

    makeObservable(this)

    if (this.options.data != null) {
      this.replace(this.options.data)
      runInAction(() => {
        this.fetchStatus = 'done'
      })
    }
  }

  public readonly database: Database<T, M, Id>

  protected options:       EndpointOptions<P, T, M>
  protected defaultParams: Readonly<P>

  @observable
  protected accessor _params: Readonly<P>
  public get params(): Readonly<P> {
    return this._params
  }

  public param<K extends keyof P>(name: K): P[K] {
    return this._params[name]
  }

  @action
  public setParams(params: Partial<P>, options: SetParamsOptions<P> = {}) {
    const {
      clear = false,
      fetch = 'refetch',
      force = false,
    } = options

    const prevParams = this._params
    this._params = this.mergeParams(this._params, params, 'update')

    const firstFetch = this.fetchStatus === 'idle'
    if (!force && !firstFetch && this.paramsEquals(prevParams, this._params)) {
      return
    }

    const shouldClear = isFunction(clear) ? clear(prevParams, this._params) : clear
    if (shouldClear) { this.clear() }
    
    const shouldFetch = fetch === 'always' || (fetch === 'refetch' && (this.fetchStatus === 'done' || this.fetchStatus instanceof Error))
    if (shouldFetch) { this.fetch() }
  }

  protected mergeParams(prev: P, update: Partial<P>, _context: 'defaults' | 'update'): P {
    return {...prev, ...update}
  }

  protected paramsEquals(params1: P, params2: P) {
    return objectEquals(params1, params2)
  }

  @observable
  public accessor ids: Array<Id> = []

  @computed
  public get data() {
    return this.database.list(this.ids)
  }

  public get(id: Id): T | null {
    if (!this.ids.includes(id)) { return null }
    return this.database.get(id)
  }

  @computed
  public get count(): number {
    return this.ids.length
  }

  @computed
  public get empty() {
    return this.data.length === 0
  }

  @observable
  public accessor meta: M | null = null

  @computed
  public get asFetch(): Fetch<T[]> {
    if (this.fetchStatus !== 'done') {
      return {status: this.fetchStatus}
    } else {
      return {status: 'done', data: this.data}
    }
  }

  // ------
  // Fetch

  @observable
  public accessor fetchStatus: FetchStatus = 'idle'
  public accessor appending: boolean = false

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
    const {_params: params, lastFetchParams} = this
    if (this.lastFetchPromise != null && lastFetchParams != null && objectEquals(params, lastFetchParams)) {
      return this.lastFetchPromise
    }

    this.fetchStatus = 'fetching'
    this.appending = options.append ?? false

    const promise: Promise<void> = this
      .performFetch(options)
      .then(
        response => this.onFetchSuccess(promise, response, options),
        response => this.onFetchError(promise, response),
      )
      .finally(action(() => {
        this.appending = false
      }))

    this.lastFetchParams = {...params}
    this.lastFetchPromise = promise

    return promise
  }

  public get mergedParams() {
    return this.mergeParams(this.defaultParams, this._params, 'defaults')
  }

  protected abstract performFetch(options: CollectionFetchOptions): Promise<CollectionFetchResponse<T, M> | null>

  @action
  private onFetchSuccess = (promise: Promise<unknown>, response: CollectionFetchResponse<T, M> | null, options: CollectionFetchOptions) => {
      if (promise !== this.lastFetchPromise) { return }

      this.lastFetchPromise = null
      this.lastFetchParams = null

      if (response == null) {
        this.fetchStatus = 'done'
      } else if (isErrorResponse(response)) {
        this.fetchStatus = response.error
        this.meta = this.options.meta ?? null
      } else if (options.append) {
        this.fetchStatus = 'done'

        const data = ('data' in response.data ? response.data.data : response.data) as T[]
        const meta = ('meta' in response.data ? response.data.meta : undefined) as M | undefined
        this.append(...data)
        this.replaceMeta(meta)
      } else {
        this.fetchStatus = 'done'

        const data = ('data' in response.data ? response.data.data : response.data) as T[]
        const meta = ('meta' in response.data ? response.data.meta : undefined) as M | undefined
        this.replace(data)
        this.replaceMeta(meta)
      }
    }

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
  public replace(data: T[]) {
    this.ids = []
    this.append(...data)
    this.fetchStatus = 'done'
  }

  @action
  public replaceMeta(meta: M | undefined) {
    if (meta == null) { return }
    this.meta = meta
  }

  @action
  public updateMeta(meta: Partial<M>) {
    if (this.meta == null) { return }
    this.meta = {...this.meta, meta}
  }

  @action
  public append(...data: T[]) {
    for (const item of data) {
      this.add(item)
    }
  }

  @action
  public add(...data: T[]) {
    for (const item of data) {
      this.database.store(item)
    }

    const ids = data.map(item => this.database.id(item))
    this.ids = [...this.ids, ...ids]
  }

  @action
  public insert(data: T[], index: number) {
    for (const item of data) {
      this.database.store(item)
    }

    const ids = data.map(item => this.database.id(item))
    this.ids = [
      ...this.ids.slice(0, index),
      ...ids,
      ...this.ids.slice(index),
    ]
  }

  @action
  public appendIDs(ids: Id[], options: AppendOptions = {}) {
    for (const id of ids) {
      this.appendID(id, options)
    }
  }

  @action
  public replaceIDs(ids: Id[]) {
    this.ids = ids
  }

  @action
  public appendID(id: Id, options: AppendOptions = {}) {
    const {
      ignoreIfExists = true,
    } = options

    if (ignoreIfExists && this.ids.includes(id)) { return }
    this.ids = [...this.ids, id]
  }

  @action
  public remove(ids: Id[], deleteFromDB: boolean = true) {
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
  protected store(item: T) {
    return this.database.store(item)
  }

}
