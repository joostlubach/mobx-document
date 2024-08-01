import { action, computed, makeObservable, observable } from 'mobx'
import { sparse } from 'ytil'

import { AnyDocument, DatabaseOptions, DocumentData } from './types'

export default class Database<D extends AnyDocument> {

  constructor(
    private readonly options: DatabaseOptions<D>,
  ) {
    makeObservable(this)
  }

  @observable
  private documents: Map<D['id'], D> = new Map()

  // ------
  // Retrieval

  @computed
  public get allDocuments(): D[] {
    return Array.from(this.documents.values())
  }

  @computed
  public get nonEmptyDocuments(): D[] {
    return this.allDocuments.filter(doc => doc.data != null)
  }

  public document(id: D['id'], create?: true | undefined): D
  public document(id: D['id'], create: false): D | null
  public document(id: D['id'], create?: boolean): D | null
  public document(id: D['id'], create: boolean = true): D | null {
    const document = this.documents.get(id) ?? null
    if (!create || document != null) { return document }

    const newDocument = this.options.emptyDocument(id)
    this.documents.set(id, newDocument)
    return newDocument
  }

  public get(id: D['id']): DocumentData<D> | null {
    const document = this.document(id, false)
    if (document == null) { return null }

    return document.data as DocumentData<D>
  }

  public listDocuments(ids: Array<D['id']>, create?: boolean): D[] {
    return ids.map(id => this.document(id, create)).filter(Boolean) as D[]
  }

  public all(): DocumentData<D>[] {
    return sparse([...this.documents.values()].map(doc => doc.data as DocumentData<D> | null))
  }

  public list(ids: D['id'][]): DocumentData<D>[] {
    const documents = ids
      .map(id => this.documents.get(id))
      .filter(doc => {
        if (doc == null) { return false }
        if (doc.data == null) { return false }
        return true
      }) as D[]

    return documents.map(doc => doc.data as DocumentData<D>)
  }

  // ------
  // Updates

  @action
  public store(item: DocumentData<D>): D {
    const id = this.options.getID(item)
    const document = this.document(id, false) ?? this.options.getDocument(item)
    this.documents.set(id, document)
    document.set(item)
    return document
  }

  @action
  public delete(id: D['id']) {
    this.documents.delete(id)
  }

  @action
  public clear() {
    this.documents.clear()
  }

}
