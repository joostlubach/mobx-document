import { action, makeObservable, observable } from 'mobx'
import { isObject, sparse } from 'ytil'
import { DatabaseOptions, IdOf } from './types'

export class Database<T, M = unknown, Id = IdOf<T>> {

  constructor(
    private readonly options: DatabaseOptions<T, Id> = {},
  ) {
    makeObservable(this)
  }

  @observable
  private accessor data: Map<Id, T> = new Map()
  
  @observable
  private accessor meta: Map<Id, M> = new Map()

  // ------
  // Retrieval

  public get(id: Id): T | null {
    return this.data.get(id) ?? null
  }

  public getMeta(id: Id): M | null {
    return this.meta.get(id) ?? null
  }

  public all(): T[] {
    return Array.from(this.data.values())
  }

  public find(predicate: (data: T) => boolean): T | null {
    for (const item of this.data.values()) {
      if (predicate(item)) {
        return item
      }
    }

    return null
  }

  public list(ids: Id[]): T[] {
    const data = ids.map(id => this.data.get(id))
    return sparse(data)
  }

  public id(item: T): Id {
    if (this.options.id != null) {
      return this.options.id(item)
    } else if (isObject(item) && 'id' in item) {
      return item.id as Id
    }
    throw new Error('Cannot determine id of item')
  }

  // ------
  // Updates

  @action
  public store(item: T, meta?: M) {
    const id = this.id(item)
    this.data.set(id, item)
    if (meta != null) {
      this.meta.set(id, meta)
    }
    return id
  }

  @action
  public storeMeta(id: Id, meta: M) {
    this.meta.set(id, meta)
  }
  
  @action
  public delete(id: Id) {
    this.data.delete(id)
    this.meta.delete(id)
  }

  @action
  public clear() {
    this.data.clear()
    this.meta.clear()
  }

}
