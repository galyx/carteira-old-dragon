import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { balanceOf, formatMoney, signedValue, toPence } from './currency'
import { db } from './database'
import type { Backup, Character, CurrencyInput, Transaction } from './types'

const emptyCurrency: CurrencyInput = { crowns: 0, shillings: 0, pence: 0 }
const today = () => new Date().toISOString().slice(0, 10)
const uid = () => crypto.randomUUID()

function validBackup(value: unknown): value is Backup {
  if (!value || typeof value !== 'object') return false
  const backup = value as Partial<Backup>
  if (backup.version !== 1 || !Array.isArray(backup.characters) || !Array.isArray(backup.transactions)) return false
  const ids = new Set<string>()
  return backup.characters.every((item) => {
    const character = item as Character
    if (typeof character.id !== 'string' || typeof character.name !== 'string' || typeof character.createdAt !== 'string') return false
    ids.add(character.id); return true
  }) && backup.transactions.every((item) => {
    const transaction = item as Transaction
    return typeof transaction.id === 'string' && ids.has(transaction.characterId) &&
      (transaction.type === 'income' || transaction.type === 'expense') && typeof transaction.description === 'string' &&
      typeof transaction.date === 'string' && [transaction.crowns, transaction.shillings, transaction.pence, transaction.totalPence].every(Number.isInteger) &&
      transaction.crowns >= 0 && transaction.shillings >= 0 && transaction.pence >= 0 && transaction.totalPence === toPence(transaction)
  })
}

export default function App() {
  const [characters, setCharacters] = useState<Character[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([db.getCharacters(), db.getTransactions()]).then(([savedCharacters, savedTransactions]) => {
      setCharacters(savedCharacters.sort((a, b) => a.name.localeCompare(b.name)))
      setTransactions(savedTransactions)
      setSelectedId(savedCharacters[0]?.id ?? null)
    }).catch(() => setNotice('Não foi possível abrir o armazenamento local.')).finally(() => setLoading(false))
  }, [])

  const selected = characters.find((character) => character.id === selectedId) ?? null
  const characterTransactions = useMemo(() => transactions.filter((item) => item.characterId === selectedId), [transactions, selectedId])

  async function addCharacter(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const character: Character = { id: uid(), name: trimmed, createdAt: new Date().toISOString() }
    await db.saveCharacter(character)
    setCharacters((current) => [...current, character].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedId(character.id)
  }

  async function renameCharacter() {
    if (!selected) return
    const name = window.prompt('Novo nome do personagem:', selected.name)?.trim()
    if (!name || name === selected.name) return
    const updated = { ...selected, name }
    await db.saveCharacter(updated)
    setCharacters((current) => current.map((item) => item.id === updated.id ? updated : item).sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function deleteCharacter() {
    if (!selected || !window.confirm(`Excluir ${selected.name} e todo o seu histórico?`)) return
    await db.deleteCharacterAndTransactions(selected.id)
    const remaining = characters.filter((item) => item.id !== selected.id)
    setCharacters(remaining)
    setTransactions((current) => current.filter((item) => item.characterId !== selected.id))
    setSelectedId(remaining[0]?.id ?? null)
  }

  async function saveTransaction(item: Transaction) {
    await db.saveTransaction(item)
    setTransactions((current) => current.some((saved) => saved.id === item.id)
      ? current.map((saved) => saved.id === item.id ? item : saved)
      : [...current, item])
  }

  async function removeTransaction(id: string) {
    if (!window.confirm('Excluir este lançamento?')) return
    await db.deleteTransaction(id)
    setTransactions((current) => current.filter((item) => item.id !== id))
  }

  function exportBackup() {
    const backup: Backup = { version: 1, exportedAt: new Date().toISOString(), characters, transactions }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `carteira-do-dragao-${today()}.json`; anchor.click()
    URL.revokeObjectURL(url)
    setNotice('Backup baixado com sucesso.')
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!validBackup(parsed)) throw new Error('invalid')
      if (!window.confirm('Importar substitui todos os dados deste aparelho. Continuar?')) return
      await db.replaceAll(parsed.characters, parsed.transactions)
      setCharacters(parsed.characters.sort((a, b) => a.name.localeCompare(b.name)))
      setTransactions(parsed.transactions)
      setSelectedId(parsed.characters[0]?.id ?? null)
      setNotice('Backup importado com sucesso.')
    } catch { setNotice('Esse arquivo não é um backup válido da Carteira do Dragão.') }
  }

  if (loading) return <main className="loading">Abrindo o livro-caixa…</main>

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><img src="/dragon-mark.svg" alt="" /><div><span>Livro-caixa</span><h1>Carteira do Dragão</h1></div></div><button className="text-button" onClick={exportBackup}>Exportar</button></header>
    {notice && <p className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso">×</button></p>}
    <section className="characters" aria-label="Personagens">
      <div className="section-heading"><h2>Personagens</h2><CharacterForm onAdd={addCharacter} /></div>
      {characters.length > 0 && <div className="character-tabs">{characters.map((character) => <button key={character.id} className={character.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(character.id)}>{character.name}</button>)}</div>}
    </section>
    {selected ? <Wallet character={selected} transactions={characterTransactions} onSave={saveTransaction} onDelete={removeTransaction} onRename={renameCharacter} onDeleteCharacter={deleteCharacter} /> : <EmptyState onAdd={addCharacter} />}
    <footer><button className="text-button" onClick={() => importInput.current?.click()}>Importar backup</button><input ref={importInput} onChange={importBackup} type="file" accept="application/json,.json" hidden /> <span>Dados salvos somente neste aparelho.</span></footer>
  </main>
}

function CharacterForm({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); await onAdd(name); setName('') }
  return <form onSubmit={submit} className="character-form"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Novo personagem" aria-label="Nome do personagem" maxLength={50} /><button>Adicionar</button></form>
}

function EmptyState({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); await onAdd(name); setName('') }
  return <section className="empty-state"><p>Comece criando a carteira de um personagem.</p><form onSubmit={submit}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Lira, a ladina" autoFocus /><button>Criar carteira</button></form></section>
}

function Wallet({ character, transactions, onSave, onDelete, onRename, onDeleteCharacter }: { character: Character; transactions: Transaction[]; onSave: (item: Transaction) => Promise<void>; onDelete: (id: string) => Promise<void>; onRename: () => Promise<void>; onDeleteCharacter: () => Promise<void> }) {
  const [editing, setEditing] = useState<Transaction | null>(null)
  const balance = balanceOf(transactions)
  const ordered = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  let running = 0
  const withBalances = ordered.map((item) => { running += signedValue(item); return { item, balance: running } }).reverse()
  return <section className="wallet">
    <div className="wallet-heading"><div><p>Carteira de</p><h2>{character.name}</h2></div><div className="character-actions"><button onClick={onRename}>Renomear</button><button className="danger" onClick={onDeleteCharacter}>Excluir</button></div></div>
    <div className={balance < 0 ? 'balance-card negative' : 'balance-card'}><span>Saldo atual</span><strong>{formatMoney(balance)}</strong><small>{balance < 0 ? 'Saldo em dívida' : 'Saldo disponível'}</small></div>
    <TransactionForm key={editing?.id ?? 'new'} characterId={character.id} existing={editing} onSave={async (item) => { await onSave(item); setEditing(null) }} onCancel={() => setEditing(null)} />
    <section className="history"><h2>Histórico</h2>{withBalances.length === 0 ? <p className="muted">Ainda não há lançamentos.</p> : <ul>{withBalances.map(({ item, balance: after }) => <li key={item.id}><div className={`movement-icon ${item.type}`}>{item.type === 'income' ? '+' : '−'}</div><div className="movement-main"><strong>{item.description || (item.type === 'income' ? 'Ganho' : 'Gasto')}</strong><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')} · saldo: {formatMoney(after)}</span></div><div className={`amount ${item.type}`}>{item.type === 'income' ? '+' : '−'}{formatMoney(item.totalPence)}<div><button onClick={() => setEditing(item)}>Editar</button><button className="danger" onClick={() => onDelete(item.id)}>Excluir</button></div></div></li>)}</ul>}</section>
  </section>
}

function TransactionForm({ characterId, existing, onSave, onCancel }: { characterId: string; existing: Transaction | null; onSave: (item: Transaction) => Promise<void>; onCancel: () => void }) {
  const [type, setType] = useState<Transaction['type']>(existing?.type ?? 'expense')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [date, setDate] = useState(existing?.date ?? today())
  const [money, setMoney] = useState<CurrencyInput>(existing ? existing : emptyCurrency)
  const [error, setError] = useState('')
  function updateMoney(field: keyof CurrencyInput, value: string) { setMoney((current) => ({ ...current, [field]: Math.max(0, Math.floor(Number(value) || 0)) })) }
  async function save(event: FormEvent) { event.preventDefault(); const totalPence = toPence(money); if (!totalPence) { setError('Informe ao menos uma moeda.'); return }; await onSave({ id: existing?.id ?? uid(), characterId: existing?.characterId ?? characterId, type, description: description.trim(), date, ...money, totalPence, createdAt: existing?.createdAt ?? new Date().toISOString() }) }
  return <form className="transaction-form" onSubmit={save}><div className="form-title"><h2>{existing ? 'Editar lançamento' : 'Novo lançamento'}</h2>{existing && <button type="button" onClick={onCancel}>Cancelar</button>}</div><div className="type-toggle"><button type="button" className={type === 'expense' ? 'selected expense' : ''} onClick={() => setType('expense')}>− Gasto</button><button type="button" className={type === 'income' ? 'selected income' : ''} onClick={() => setType('income')}>+ Ganho</button></div><label>Descrição<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Estalagem" maxLength={100} /></label><label>Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><div className="currency-fields">{([['crowns', 'Coroas'], ['shillings', 'Xelins'], ['pence', 'Pences']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" min="0" step="1" inputMode="numeric" value={money[field] || ''} onChange={(event) => updateMoney(field, event.target.value)} placeholder="0" /></label>)}</div>{error && <p className="error">{error}</p>}<button className="primary">{existing ? 'Salvar alteração' : 'Registrar lançamento'}</button></form>
}
