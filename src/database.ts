import type { Character, Transaction } from './types'

const DATABASE = 'carteira-do-dragao'
const VERSION = 1
const CHARACTERS = 'characters'
const TRANSACTIONS = 'transactions'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CHARACTERS)) db.createObjectStore(CHARACTERS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(TRANSACTIONS)) {
        const store = db.createObjectStore(TRANSACTIONS, { keyPath: 'id' })
        store.createIndex('characterId', 'characterId')
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function readAll<T>(store: string): Promise<T[]> {
  const db = await openDatabase()
  return new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll()
    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}

async function put<T>(store: string, value: T): Promise<void> {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(value)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}

async function remove(store: string, id: string): Promise<void> {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}

export const db = {
  getCharacters: () => readAll<Character>(CHARACTERS),
  getTransactions: () => readAll<Transaction>(TRANSACTIONS),
  saveCharacter: (character: Character) => put(CHARACTERS, character),
  saveTransaction: (transaction: Transaction) => put(TRANSACTIONS, transaction),
  deleteCharacter: (id: string) => remove(CHARACTERS, id),
  deleteTransaction: (id: string) => remove(TRANSACTIONS, id),
  async deleteCharacterAndTransactions(id: string): Promise<void> {
    const database = await openDatabase()
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([CHARACTERS, TRANSACTIONS], 'readwrite')
      transaction.objectStore(CHARACTERS).delete(id)
      const index = transaction.objectStore(TRANSACTIONS).index('characterId')
      const request = index.openCursor(IDBKeyRange.only(id))
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) { cursor.delete(); cursor.continue() }
      }
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    })
  },
  async replaceAll(characters: Character[], transactions: Transaction[]) {
    const database = await openDatabase()
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([CHARACTERS, TRANSACTIONS], 'readwrite')
      const characterStore = transaction.objectStore(CHARACTERS)
      const transactionStore = transaction.objectStore(TRANSACTIONS)
      characterStore.clear()
      transactionStore.clear()
      characters.forEach((character) => characterStore.put(character))
      transactions.forEach((item) => transactionStore.put(item))
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    })
  }
}
