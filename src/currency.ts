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
  return `${negative ? '−' : ''}${crowns} Coroas · ${shillings} Chirlins · ${pence} Pencils`
}

/** Mostra as moedas físicas sem normalizar ou trocar uma denominação por outra. */
export function formatCoins({ crowns, shillings, pence }: CurrencyInput): string {
  return `${crowns} Coroas · ${shillings} Chirlins · ${pence} Pencils`
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

/** Conversão da carteira: quebrar, juntar ou normalizar para valores definitivos (1 Coroa = 20 Chirlins = 240 Pencils). */
export type WalletConvertKind = 'break-crowns' | 'break-chirlins' | 'join-chirlins' | 'join-pencils' | 'normalize'

export function inferConvertKind(request: CurrencyInput, kind?: WalletConvertKind | null): WalletConvertKind | null {
  if (kind) return kind
  // Pedidos antigos: uma denominação só = quebra daquela moeda.
  const parts = [request.crowns > 0, request.shillings > 0, request.pence > 0].filter(Boolean).length
  if (parts === 1 && request.crowns > 0) return 'break-crowns'
  if (parts === 1 && request.shillings > 0) return 'break-chirlins'
  if (parts === 0) return 'normalize'
  return null
}

export function bankConversionDelta(balance: CurrencyInput, request: CurrencyInput, kind?: WalletConvertKind | null): CurrencyInput | null {
  const mode = inferConvertKind(request, kind)
  if (!mode) return null

  if (mode === 'break-crowns') {
    const n = request.crowns > 0 ? request.crowns : balance.crowns
    if (n <= 0 || balance.crowns < n) return null
    return { crowns: -n, shillings: n * SHILLINGS_PER_CROWN, pence: 0 }
  }
  if (mode === 'break-chirlins') {
    const n = request.shillings > 0 ? request.shillings : balance.shillings
    if (n <= 0 || balance.shillings < n) return null
    return { crowns: 0, shillings: -n, pence: n * PENCE_PER_SHILLING }
  }
  if (mode === 'join-chirlins') {
    const available = request.shillings > 0 ? Math.min(request.shillings, balance.shillings) : balance.shillings
    const crowns = Math.floor(available / SHILLINGS_PER_CROWN)
    if (crowns <= 0) return null
    const used = crowns * SHILLINGS_PER_CROWN
    if (balance.shillings < used) return null
    return { crowns, shillings: -used, pence: 0 }
  }
  if (mode === 'join-pencils') {
    const available = request.pence > 0 ? Math.min(request.pence, balance.pence) : balance.pence
    const chirlins = Math.floor(available / PENCE_PER_SHILLING)
    if (chirlins <= 0) return null
    const used = chirlins * PENCE_PER_SHILLING
    if (balance.pence < used) return null
    return { crowns: 0, shillings: chirlins, pence: -used }
  }
  // normalize → valores definitivos (máximo de Coroas, depois Chirlins, resto Pencils)
  const total = toPence(balance)
  if (total <= 0) return null
  const next = fromPence(total)
  const delta = {
    crowns: next.crowns - balance.crowns,
    shillings: next.shillings - balance.shillings,
    pence: next.pence - balance.pence,
  }
  if (delta.crowns === 0 && delta.shillings === 0 && delta.pence === 0) return null
  return delta
}

export function convertKindLabel(kind: WalletConvertKind, balance: CurrencyInput): string {
  if (kind === 'break-crowns') return `Quebrar ${balance.crowns} Coroa(s) → ${balance.crowns * SHILLINGS_PER_CROWN} Chirlins`
  if (kind === 'break-chirlins') return `Quebrar ${balance.shillings} Chirlin(s) → ${balance.shillings * PENCE_PER_SHILLING} Pencils`
  if (kind === 'join-chirlins') {
    const crowns = Math.floor(balance.shillings / SHILLINGS_PER_CROWN)
    return `Juntar ${crowns * SHILLINGS_PER_CROWN} Chirlin(s) → ${crowns} Coroa(s)`
  }
  if (kind === 'join-pencils') {
    const chirlins = Math.floor(balance.pence / PENCE_PER_SHILLING)
    return `Juntar ${chirlins * PENCE_PER_SHILLING} Pencil(s) → ${chirlins} Chirlin(s)`
  }
  const next = fromPence(toPence(balance))
  return `Valores definitivos → ${formatCoins(next)}`
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
