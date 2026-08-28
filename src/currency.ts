import type { CurrencyInput, Transaction } from './types'

export const PENCE_PER_SHILLING = 12
export const SHILLINGS_PER_CROWN = 20
export const PENCE_PER_CROWN = PENCE_PER_SHILLING * SHILLINGS_PER_CROWN

export function toPence({ crowns, shillings, pence }: CurrencyInput): number {
  return crowns * PENCE_PER_CROWN + shillings * PENCE_PER_SHILLING + pence
}

export function fromPence(amount: number): CurrencyInput & { negative: boolean } {
  const negative = amount < 0
  let remaining = Math.abs(amount)
  const crowns = Math.floor(remaining / PENCE_PER_CROWN)
  remaining %= PENCE_PER_CROWN
  const shillings = Math.floor(remaining / PENCE_PER_SHILLING)
  const pence = remaining % PENCE_PER_SHILLING
  return { crowns, shillings, pence, negative }
}

export function formatMoney(amount: number): string {
  const { crowns, shillings, pence, negative } = fromPence(amount)
  return `${negative ? '−' : ''}${crowns} C · ${shillings} X · ${pence} P`
}

export function signedValue(transaction: Transaction): number {
  return transaction.type === 'income' ? transaction.totalPence : -transaction.totalPence
}

export function balanceOf(transactions: Transaction[]): number {
  return transactions.reduce((balance, transaction) => balance + signedValue(transaction), 0)
}
