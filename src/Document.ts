import Logger from 'logger'
import { action, computed, makeObservable, observable, runInAction } from 'mobx'
import { EmptyObject, objectEquals } from 'ytil'
import {
  DocumentFetchResponse,
  DocumentOptions,
  FetchOptions,
  FetchStatus,
  isErrorResponse,
  OptimisticUpdateSpec,
  SetParamsOptions,
} from './types'

const logger = new Logger('mobx-document')

export default abstract class Document<
  T,
  ID = string,
  P extends object = EmptyObject,
  M extends object = EmptyObject
> {

  constructor(
    public readonly id: ID,
    protected readonly options: DocumentOptions<T, M, P> = {},
  ) {
    makeObservable(this)

    this.defaultParams = {...this.options.defaultParams as P}
    this.params = {...this.options.initialParams as P}

    if (options.initialData != null) {
      this.set(options.initialData, options.initialMeta)
    }
  }

  @observable.ref
  public data: T | null = null

  @observable.ref
  public meta: M | null = null

  protected defaultParams: P

  @observable.ref
  public params: P

  @computed
  public get empty() {
    return this.data == null
  }

  @action
  public clear() {
    this.data = null
    this.meta = null
    this.fetchStatus = 'idle'

    this.onDidChange()
  }

  @action
  public set(data: T | null, meta?: M | null, replaceMeta: boolean = false) {
    this.data = data

    if (meta !== undefined) {
      if (this.meta != null && !replaceMeta) {
        this.meta = {...this.meta, ...meta}
      } else {
        this.meta = meta
      }
    }

    if (this.data != null) {
      this.fetchStatus = 'done'
    }

    this.onDidChange()
  }

  @action
  public setMeta(meta: M) {
    this.meta = meta
    this.onDidChange()
  }

  @action
  public mergeMeta(meta: Partial<M>) {
    if (this.meta == null) { return }

    this.meta = {...this.meta, meta}
    this.onDidChange()
  }

  @action
  public updateMeta(meta: Partial<M>) {
    if (this.meta == null) { return }
    this.meta = {...this.meta, ...meta}

    this.onDidChange()
  }

  protected onDidChange() { /**/ }

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

  // ------
  // Fetch

  public fetchStatus: FetchStatus = 'idle'

  private fetchPromise: Promise<unknown> | null = null

  public async fetchIfNeeded(params?: P): Promise<void> {
    if (this.fetchStatus !== 'done' && this.fetchStatus !== 'fetching') {
      await this.fetch(params)
    }
  }

  public fetch(options: FetchOptions = {}): Promise<void> {
    if (!options.force && this.fetchPromise != null) {
      return this.fetchPromise.then(() => undefined)
    }

    this.fetchStatus = 'fetching'

    const promise = this.performFetch()
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

  protected abstract performFetch(): Promise<DocumentFetchResponse<T | null, M> | null | undefined>

  private onFetchSuccess = action((promise: Promise<unknown>, response: DocumentFetchResponse<T | null, M> | null | undefined) => {
    if (promise !== this.fetchPromise) { return }

    this.fetchPromise = null
    if (response == null) { return }

    if (!isErrorResponse(response)) {
      this.fetchStatus = 'done'
      this.set(response.data, response.meta)
    } else {
      this.fetchStatus = response.error
    }
  })

  private onFetchError = action((promise: Promise<unknown>, error: Error) => {
    if (promise !== this.fetchPromise) { return }

    this.fetchPromise = null
    this.fetchStatus = error
    logger.error('Error while fetching document', error)
  })

  // ------
  // Optimistic updates

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

}