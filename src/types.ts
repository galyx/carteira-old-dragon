export type CurrencyInput = { crowns: number; shillings: number; pence: number }

export type Character = {
  id: string
  name: string
  createdAt: string
}

export type Transaction = CurrencyInput & {
  id: string
  characterId: string
  type: 'income' | 'expense'
  description: string
  date: string
  totalPence: number
  createdAt: string
}

export type Backup = {
  version: 1
  exportedAt: string
  characters: Character[]
  transactions: Transaction[]
}
