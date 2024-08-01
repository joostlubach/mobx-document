import Logger from 'logger'
import { action, computed, makeObservable, observable, runInAction } from 'mobx'
import { EmptyObject, Primitive } from 'ytil'

import {
  DocumentFetchResponse,
  DocumentOptions,
  FetchOptions,
  FetchStatus,
  isErrorResponse,
  OptimisticUpdateSpec,
} from './types'

const logger = new Logger('mobx-document')

export default abstract class Document<T, ID extends Primitive = string, P extends object = EmptyObject, M extends object = EmptyObject> {

  constructor(
    public readonly id: ID,
    options: DocumentOptions<T, M> = {},
  ) {
    makeObservable(this)

    if (options.initialData != null) {
      this.set(options.initialData, options.initialMeta)
    }
  }

  @observable.ref
  public data: T | null = null

  @observable.ref
  public meta: M | null = null

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

  // ------
  // Fetch

  public readonly defaultParams: P | null = null

  public fetchStatus: FetchStatus = 'idle'

  private fetchPromise: Promise<unknown> | null = null

  public async fetchIfNeeded(params?: P): Promise<void> {
    if (this.fetchStatus !== 'done' && this.fetchStatus !== 'fetching') {
      await this.fetch(params)
    }
  }

  public fetch(params?: P, options: FetchOptions = {}): Promise<void> {
    if (!options.force && this.fetchPromise != null) {
      return this.fetchPromise.then(() => undefined)
    }

    if (this.defaultParams == null && params == null) {
      throw new Error("Cannot fetch document without params")
    }

    this.fetchStatus = 'fetching'

    const coercedParams = this.coerceParams(params)
    const promise = this.performFetch(coercedParams)
    this.fetchPromise = promise

    return promise.then(
      this.onFetchSuccess.bind(this, promise),
      this.onFetchError.bind(this, promise),
    )
  }

  private coerceParams(params: P | undefined): P {
    if (params != null) {
      return params
    } else if (this.defaultParams != null) {
      return this.defaultParams
    } else {
      throw new Error("Cannot fetch document without params")
    }
  }

  protected abstract performFetch(params: P): Promise<DocumentFetchResponse<T | null, M> | null | undefined>

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
