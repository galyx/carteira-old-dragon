import { describe, expect, it } from 'vitest'
import { balanceOf, coinBalanceOf, formatCoins, fromPence, payWithChange, PENCE_PER_CROWN, PENCE_PER_SHILLING, toPence } from './currency'
import type { Transaction } from './types'

describe('moedas', () => {
  it('converte Coroas, Xelins e Pences para a menor unidade', () => {
    expect(PENCE_PER_CROWN).toBe(240)
    expect(toPence({ crowns: 1, shillings: 0, pence: 0 })).toBe(240)
    expect(toPence({ crowns: 0, shillings: 1, pence: 0 })).toBe(PENCE_PER_SHILLING)
  })
  it('normaliza valores na forma das três moedas', () => {
    expect(fromPence(240)).toMatchObject({ crowns: 1, shillings: 0, pence: 0 })
    expect(fromPence(12)).toMatchObject({ crowns: 0, shillings: 1, pence: 0 })
    expect(fromPence(-241)).toMatchObject({ negative: true, crowns: 1, shillings: 0, pence: 1 })
  })
  it('permite que um gasto deixe a carteira negativa', () => {
    const transactions: Transaction[] = [
      { id: '1', characterId: 'c', type: 'income', description: '', date: '2026-01-01', crowns: 0, shillings: 1, pence: 0, totalPence: 12, createdAt: '2026-01-01' },
      { id: '2', characterId: 'c', type: 'expense', description: '', date: '2026-01-02', crowns: 0, shillings: 2, pence: 0, totalPence: 24, createdAt: '2026-01-02' }
    ]
    expect(balanceOf(transactions)).toBe(-12)
  })
  it('preserva as quantidades físicas sem converter Shillings em Coroas', () => {
    const transactions: Transaction[] = [
      { id: '1', characterId: 'c', type: 'income', description: '', date: '2026-01-01', crowns: 8, shillings: 200, pence: 3, totalPence: 4323, createdAt: '2026-01-01' },
      { id: '2', characterId: 'c', type: 'expense', description: '', date: '2026-01-02', crowns: 1, shillings: 5, pence: 2, totalPence: 302, createdAt: '2026-01-02' }
    ]
    expect(coinBalanceOf(transactions)).toEqual({ crowns: 7, shillings: 195, pence: 1 })
    expect(formatCoins({ crowns: 8, shillings: 200, pence: 3 })).toBe('8 C · 200 S · 3 P')
  })
  it('troca moedas somente quando faltam peças para um pagamento', () => {
    expect(payWithChange(
      { crowns: 8, shillings: 200, pence: 0 },
      { crowns: 1, shillings: 300, pence: 0 },
    )).toMatchObject({ remaining: { crowns: 2, shillings: 0, pence: 0 }, exchanged: true })
    expect(payWithChange(
      { crowns: 8, shillings: 400, pence: 0 },
      { crowns: 1, shillings: 300, pence: 0 },
    )).toMatchObject({ remaining: { crowns: 7, shillings: 100, pence: 0 }, exchanged: false })
  })
})
