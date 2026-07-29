import Logger from 'logger'
import { action, computed, makeObservable, observable, runInAction } from 'mobx'
import { EmptyObject, objectEquals } from 'ytil'
import { Database } from './Database'
import {
  DocumentFetchResponse,
  DocumentOptions,
  FetchOptions,
  FetchStatus,
  IdOf,
  isErrorResponse,
  OptimisticUpdateSpec,
  SetParamsOptions,
} from './types'

const logger = new Logger('mobx-document')

export abstract class Document<
  T,
  Id = IdOf<T>,
  P extends object = EmptyObject,
  M extends object = EmptyObject
> {

  constructor(
    public readonly id: Id,
    database: Database<T, M, Id> | null = null,
    protected readonly options: DocumentOptions<T, M, P> = {},
  ) {
    this.database = database ?? new Database()

    makeObservable(this)

    this.defaultParams = {...this.options.defaultParams as P}
    this.params = {...this.options.initialParams as P}

    if (options.initialData != null) {
      this.set(options.initialData, options.initialMeta)
    }
  }

  public database: Database<T, M, Id>

  // #region Data

  @computed
  public get data(): T | null {
    return this.database.get(this.id)
  }

  @computed
  public get meta(): M | null {
    return (this.database.getMeta(this.id) ?? null) as M | null
  }

  protected defaultParams: P

  @observable
  public accessor params: P

  @computed
  public get empty() {
    return this.data == null
  }

  @action
  public set(data: T | null, meta?: M) {
    this.database.store(data as T, meta)

    if (this.data != null) {
      this.fetchStatus = 'done'
    }

    this.onDidChange()
  }

  protected onDidChange() { /**/ }

  // #endregion

  // #region Params

  @action
  public setParams(params: Partial<P>, options: SetParamsOptions<P> = {}) {
    const {
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

    const shouldFetch = fetch === 'always' || (fetch === 'refetch' && this.fetchStatus === 'done')
    if (shouldFetch) { this.fetch() }
  }

  // #endregion

  // #region Fetch

  @observable
  public accessor fetchStatus: FetchStatus = 'idle'

  private fetchPromise: Promise<unknown> | null = null

  public async fetchIfNeeded(options: FetchOptions = {}): Promise<void> {
    if (this.fetchStatus !== 'done' && this.fetchStatus !== 'fetching') {
      await this.fetch(options)
    }
  }

  @action
  public fetch(options: FetchOptions = {}): Promise<void> {
    if (!options.force && this.fetchPromise != null) {
      return this.fetchPromise.then(() => undefined)
    }

    this.fetchStatus = 'fetching'

    const promise = this.performFetch(options)
    this.fetchPromise = promise

    return promise.then(
      this.onFetchSuccess.bind(this, promise),
      this.onFetchError.bind(this, promise),
    )
  }

  public get mergedParams(): P {
    return {
      ...this.defaultParams,
      ...this.params,
    }
  }

  protected abstract performFetch(options: FetchOptions): Promise<DocumentFetchResponse<T | null, M> | null | undefined>

  @action
  private onFetchSuccess = (promise: Promise<unknown>, response: DocumentFetchResponse<T | null, M> | null | undefined) => {
      if (promise !== this.fetchPromise) { return }

      this.fetchPromise = null
      if (response == null) { return }

      if (!isErrorResponse(response)) {
        this.fetchStatus = 'done'
        this.set(response.data, response.meta)
      } else {
        this.fetchStatus = response.error
      }
    }

  @action
  private onFetchError = (promise: Promise<unknown>, error: Error) => {
      if (promise !== this.fetchPromise) { return }

      this.fetchPromise = null
      this.fetchStatus = error
      logger.error('Error while fetching document', error)
    }

  // #endregion

  // #region Optimistic updates

  @action
  protected async performOptimisticUpdate(spec: OptimisticUpdateSpec<T, M>) {
    const original = this.data
    if (spec.prepare != null && original != null) {
      runInAction(() => {
        const tmp = spec.prepare(original)
        this.set(tmp)
      })
    }

    const response = await spec.update()
    return runInAction(() => {
      if (isErrorResponse(response)) {
        this.set(original)
        return false
      } else {
        this.set(response.data, response.meta)
        return true
      }
    })
  }

  // #endregion

}