import type { Character, MasterSession, PlayerStoryAccess, Story, Transaction } from './types'

const DATABASE = 'carteira-do-dragao'
const VERSION = 4
const CHARACTERS = 'characters'
const TRANSACTIONS = 'transactions'
const MASTER_SESSION = 'masterSession'
const STORIES = 'stories'
const PLAYER_STORIES = 'playerStories'

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
      if (!db.objectStoreNames.contains(MASTER_SESSION)) db.createObjectStore(MASTER_SESSION, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORIES)) db.createObjectStore(STORIES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(PLAYER_STORIES)) db.createObjectStore(PLAYER_STORIES, { keyPath: 'id' })
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
  getMasterSessions: () => readAll<MasterSession>(MASTER_SESSION),
  getStories: () => readAll<Story>(STORIES),
  getPlayerStories: () => readAll<PlayerStoryAccess>(PLAYER_STORIES),
  saveCharacter: (character: Character) => put(CHARACTERS, character),
  saveTransaction: (transaction: Transaction) => put(TRANSACTIONS, transaction),
  saveMasterSession: (session: MasterSession) => put(MASTER_SESSION, session),
  saveStory: (story: Story) => put(STORIES, story),
  savePlayerStory: (access: PlayerStoryAccess) => put(PLAYER_STORIES, access),
  deleteStory: (id: string) => remove(STORIES, id),
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
