import type { CurrencyInput, LedgerEntry, Transaction } from './types'

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

/** Mostra as moedas físicas sem normalizar ou trocar uma denominação por outra. */
export function formatCoins({ crowns, shillings, pence }: CurrencyInput): string {
  return `${crowns} C · ${shillings} S · ${pence} P`
}

export function coinBalanceOf(entries: Array<Transaction | LedgerEntry>): CurrencyInput {
  return entries.reduce<CurrencyInput>((balance, entry) => {
    if (entry.balanceDelta) return {
      crowns: balance.crowns + entry.balanceDelta.crowns,
      shillings: balance.shillings + entry.balanceDelta.shillings,
      pence: balance.pence + entry.balanceDelta.pence,
    }
    const direction = entry.type === 'income' ? 1 : -1
    return {
      crowns: balance.crowns + direction * entry.crowns,
      shillings: balance.shillings + direction * entry.shillings,
      pence: balance.pence + direction * entry.pence,
    }
  }, { crowns: 0, shillings: 0, pence: 0 })
}

export function payWithChange(balance: CurrencyInput, payment: CurrencyInput): { remaining: CurrencyInput; balanceDelta: CurrencyInput; exchanged: boolean } | null {
  const available = toPence(balance)
  const price = toPence(payment)
  if (price <= 0 || available < price) return null

  const hasExactCoins = balance.crowns >= payment.crowns && balance.shillings >= payment.shillings && balance.pence >= payment.pence
  const remaining = hasExactCoins
    ? { crowns: balance.crowns - payment.crowns, shillings: balance.shillings - payment.shillings, pence: balance.pence - payment.pence }
    : fromPence(available - price)

  return {
    remaining: { crowns: remaining.crowns, shillings: remaining.shillings, pence: remaining.pence },
    balanceDelta: {
      crowns: remaining.crowns - balance.crowns,
      shillings: remaining.shillings - balance.shillings,
      pence: remaining.pence - balance.pence,
    },
    exchanged: !hasExactCoins,
  }
}

export function addCoinBalances(values: CurrencyInput[]): CurrencyInput {
  return values.reduce<CurrencyInput>((total, value) => ({
    crowns: total.crowns + value.crowns,
    shillings: total.shillings + value.shillings,
    pence: total.pence + value.pence,
  }), { crowns: 0, shillings: 0, pence: 0 })
}

export function signedValue(transaction: Transaction): number {
  return transaction.type === 'income' ? transaction.totalPence : -transaction.totalPence
}

export function balanceOf(transactions: Transaction[]): number {
  return transactions.reduce((balance, transaction) => balance + signedValue(transaction), 0)
}
