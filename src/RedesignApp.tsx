import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { MasterCloudSession, PlayerCloudSession } from './CloudSession'
import { postMessage, type InstitutionOperation, type InstitutionOperationResult } from './cloud'
import { addCoinBalances, bankConversionDelta, coinBalanceOf, formatCoins, formatMoney, fromPence, payWithChange, toPence } from './currency'
import { db } from './database'
import type { Character, CurrencyInput, LedgerEntry, Loan, PlayerStoryAccess, Story, StoryCharacter, StoryInstitution, Transaction } from './types'

const uid = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16)).join('-')
const today = () => new Date().toISOString().slice(0, 10)
const emptyMoney: CurrencyInput = { crowns: 0, shillings: 0, pence: 0 }

export default function RedesignApp() {
  const [role, setRole] = useState<'home' | 'player' | 'master'>('home')
  const [characters, setCharacters] = useState<Character[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [stories, setStories] = useState<Story[]>([])
  const [playerStories, setPlayerStories] = useState<PlayerStoryAccess[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  useEffect(() => { Promise.all([db.getCharacters(), db.getTransactions(), db.getStories(), db.getPlayerStories()]).then(([chars, entries, savedStories, access]) => { setCharacters(chars); setTransactions(entries); setStories(savedStories); setPlayerStories(access); setSelectedCharacterId(chars[0]?.id ?? null) }).finally(() => setLoading(false)) }, [])
  const selectedCharacter = characters.find((item) => item.id === selectedCharacterId) ?? null
  const selectedStory = stories.find((item) => item.id === selectedStoryId) ?? null
  async function addCharacter(name: string) { const value = name.trim(); if (!value) return; const item = { id: uid(), name: value, createdAt: new Date().toISOString() }; await db.saveCharacter(item); setCharacters((current) => [...current, item]); setSelectedCharacterId(item.id) }
  async function deleteCharacter(id: string) {
    if (!window.confirm('Apagar este personagem e todo o histórico local? Se ele estiver em uma mesa, precisará entrar de novo com outro personagem.')) return
    await db.deleteCharacterAndTransactions(id)
    setCharacters((current) => current.filter((item) => item.id !== id))
    setTransactions((current) => current.filter((item) => item.characterId !== id))
    setPlayerStories((current) => current.filter((item) => item.characterId !== id))
    if (selectedCharacterId === id) setSelectedCharacterId(null)
  }
  async function saveTransaction(item: Transaction) { await db.saveTransaction(item); setTransactions((current) => current.some((saved) => saved.id === item.id) ? current.map((saved) => saved.id === item.id ? item : saved) : [...current, item]) }
  async function saveStory(story: Story) { const next = { ...story, updatedAt: new Date().toISOString() }; await db.saveStory(next); setStories((current) => current.some((item) => item.id === next.id) ? current.map((item) => item.id === next.id ? next : item) : [...current, next]) }
  async function savePlayerStory(access: PlayerStoryAccess) { await db.savePlayerStory(access); setPlayerStories((current) => current.some((item) => item.id === access.id) ? current.map((item) => item.id === access.id ? access : item) : [...current, access]) }
  async function createStory(name: string, description: string) { const now = new Date().toISOString(); const story: Story = { id: uid(), name: name.trim() || 'Nova História', description: description.trim(), archived: false, institutions: [], characters: [], members: [], loans: [], requests: [], createdAt: now, updatedAt: now }; await saveStory(story); setSelectedStoryId(story.id) }

  if (loading) return <main className="loading">Abrindo o livro-caixa…</main>
  return <main className="app-shell redesigned">
    <header className="topbar"><button className="brand-button" onClick={() => { setRole('home'); setSelectedStoryId(null) }}><img src={`${import.meta.env.BASE_URL}dragon-mark.svg`} alt="" /><span><small>Livro-caixa</small>Carteira do Dragão</span></button><span className="offline-badge">● Online</span></header>
    {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast('')}>×</button></div>}
    {role === 'home' && <Home onPlayer={() => setRole('player')} onMaster={() => setRole('master')} />}
    {role === 'player' && !selectedCharacter && <CharacterLibrary characters={characters} onAdd={addCharacter} onDelete={deleteCharacter} onOpen={(id) => setSelectedCharacterId(id)} onBack={() => setRole('home')} />}
    {role === 'player' && selectedCharacter && <PlayerDashboard character={selectedCharacter} allCharacters={characters} transactions={transactions.filter((item) => item.characterId === selectedCharacter.id)} storyAccess={playerStories.filter((item) => item.characterId === selectedCharacter.id)} onAccess={savePlayerStory} onSelect={setSelectedCharacterId} onSave={saveTransaction} onBack={() => setSelectedCharacterId(null)} />}
    {role === 'master' && !selectedStory && <StoryLibrary stories={stories} onCreate={createStory} onOpen={setSelectedStoryId} onSave={saveStory} onBack={() => setRole('home')} />}
    {role === 'master' && selectedStory && <StoryDashboard story={selectedStory} onSave={saveStory} onBack={() => setSelectedStoryId(null)} onToast={setToast} />}
  </main>
}

function Home({ onPlayer, onMaster }: { onPlayer: () => void; onMaster: () => void }) {
  return <section className="home-screen"><div className="welcome"><p className="eyebrow">Seu ouro, sua aventura</p><h1>Como você vai jogar hoje?</h1><p>Escolha um caminho. A carteira fica no aparelho; a mesa do mestre pode ser compartilhada online.</p></div><div className="role-grid"><button className="role-card player" onClick={onPlayer}><span className="role-icon">♙</span><div><strong>Entrar como Jogador</strong><small>Gerencie personagens, moedas e Histórias.</small></div><b>→</b></button><button className="role-card master" onClick={onMaster}><span className="role-icon">♜</span><div><strong>Entrar como Mestre</strong><small>Crie Histórias, instituições e sessões.</small></div><b>→</b></button></div><div className="privacy-note"><span>◇</span><div><strong>Mesa por código</strong><small>O mestre gera um código de 9 caracteres (válido por 12h). Quem entra fica vinculado ao personagem.</small></div></div></section>
}

function CharacterLibrary({ characters, onAdd, onDelete, onOpen, onBack }: { characters: Character[]; onAdd: (name: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onOpen: (id: string) => void; onBack: () => void }) {
  const [name, setName] = useState('')
  return <Page title="Meus personagens" subtitle="Escolha quem entrará na aventura." onBack={onBack}><div className="card-grid">{characters.map((character) => <div className="entity-card character-row" key={character.id}><button className="entity-main" onClick={() => onOpen(character.id)}><span className="avatar">{character.name[0]?.toUpperCase()}</span><div><strong>{character.name}</strong><small>Carteira local</small></div><b>→</b></button><button className="danger" type="button" onClick={() => void onDelete(character.id)}>Apagar</button></div>)}</div><EmptyOrCreate empty={!characters.length} title="Crie seu primeiro personagem" description="A carteira fica neste aparelho. Na mesa online, o mestre também acompanha o histórico."><form className="inline-create" onSubmit={async (event) => { event.preventDefault(); await onAdd(name); setName('') }}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do personagem" /><button className="primary">Criar personagem</button></form></EmptyOrCreate></Page>
}

function PlayerDashboard({ character, allCharacters, transactions, storyAccess, onAccess, onSelect, onSave, onBack }: { character: Character; allCharacters: Character[]; transactions: Transaction[]; storyAccess: PlayerStoryAccess[]; onAccess: (access: PlayerStoryAccess) => Promise<void>; onSelect: (id: string) => void; onSave: (item: Transaction) => Promise<void>; onBack: () => void }) {
  const [tab, setTab] = useState<'wallet' | 'institutions' | 'session' | 'requests' | 'history'>('wallet')
  const [operationSender, setOperationSender] = useState<((operation: InstitutionOperation) => boolean) | null>(null)
  const [accessRefresh, setAccessRefresh] = useState<(() => boolean) | null>(null)
  const [operationNotice, setOperationNotice] = useState('')
  const transactionsRef = useRef(transactions)
  const appliedOpsRef = useRef(new Set<string>())
  const registerOperationSender = useCallback((sender: ((operation: InstitutionOperation) => boolean) | null) => setOperationSender(() => sender), [])
  const registerAccessRefresh = useCallback((sender: (() => boolean) | null) => setAccessRefresh(() => sender), [])
  useEffect(() => {
    transactionsRef.current = transactions
    for (const item of transactions) {
      if (item.referenceId) appliedOpsRef.current.add(item.referenceId)
    }
  }, [transactions])
  const balance = coinBalanceOf(transactions)
  const equivalent = toPence(balance)
  const navItems: readonly (readonly [string,string,string])[] = storyAccess.length ? [['wallet','Carteira','◉'],['institutions','Instituições','♜'],['session','Sessão','⌁'],['requests','Pedidos','✉'],['history','Histórico','≡']] : [['wallet','Carteira','◉'],['session','Entrar','⌁'],['requests','Pedidos','✉'],['history','Histórico','≡']]
  useEffect(() => { if (tab === 'institutions') accessRefresh?.() }, [tab, accessRefresh])

  function sendOperation(institution: { id: string; name: string }, action: InstitutionOperation['action'], money: CurrencyInput, description: string, requestId?: string, dueDate?: string): string | null {
    if (!operationSender) return 'Entre na mesa do mestre com o código antes de movimentar moedas.'
    if (action !== 'loanDecline' && !toPence(money)) return 'Informe ao menos uma moeda.'
    if ((action === 'deposit' || action === 'depositRequest' || action === 'loanPay') && !payWithChange(balance, money)) return 'A carteira não possui valor suficiente.'
    if (action === 'convert' && !bankConversionDelta(balance, money)) return 'Não há Coroas ou Chirlins na carteira para converter.'
    const defaults: Partial<Record<InstitutionOperation['action'], string>> = {
      deposit: 'Depósito direto',
      depositRequest: 'Solicitação de depósito',
      withdraw: 'Retirada direta',
      withdrawRequest: 'Solicitação de retirada',
      loan: 'Pedido de empréstimo',
      loanAccept: 'Empréstimo aceito',
      loanDecline: 'Empréstimo recusado',
      loanPay: 'Pagamento de empréstimo',
      chargeOffer: 'Proposta de pagamento parcial',
      convert: 'Pedido de conversão da carteira',
    }
    const operation: InstitutionOperation = { type: 'institution-operation', id: uid(), characterId: character.id, institutionId: institution.id, institutionName: institution.name, action, description: description.trim() || defaults[action] || 'Operação', money, requestId, dueDate }
    return operationSender(operation) ? null : 'Não foi possível enviar. Verifique a conexão com a mesa.'
  }

  const receiveOperation = useCallback(async (result: InstitutionOperationResult) => {
    setOperationNotice(result.message)
    if (!result.ok) return
    const operation = result.operation
    if (result.applyWallet !== true) return
    if (appliedOpsRef.current.has(operation.id) || transactionsRef.current.some((item) => item.referenceId === operation.id)) return
    appliedOpsRef.current.add(operation.id)

    const currentTransactions = transactionsRef.current
    if (operation.action === 'convert') {
      const delta = bankConversionDelta(coinBalanceOf(currentTransactions), operation.money)
      if (!delta) { appliedOpsRef.current.delete(operation.id); return }
      await onSave({ id: uid(), characterId: character.id, type: 'income', description: 'Conversão aprovada na carteira', date: today(), crowns: 0, shillings: 0, pence: 0, totalPence: 0, referenceId: operation.id, balanceDelta: delta, createdAt: new Date().toISOString() })
      return
    }
    if (!['deposit', 'withdraw', 'loanAccept', 'loanPay'].includes(operation.action)) {
      appliedOpsRef.current.delete(operation.id)
      return
    }
    const spendsWallet = operation.action === 'deposit' || operation.action === 'loanPay'
    const payment = spendsWallet ? payWithChange(coinBalanceOf(currentTransactions), operation.money) : null
    if (spendsWallet && !payment) { appliedOpsRef.current.delete(operation.id); return }
    const labels: Record<string, string> = {
      deposit: `Depósito em ${operation.institutionName}`,
      withdraw: `Retirada de ${operation.institutionName}`,
      loanAccept: `Empréstimo de ${operation.institutionName}`,
      loanPay: `Pagamento de empréstimo — ${operation.institutionName}`,
    }
    await onSave({
      id: uid(),
      characterId: character.id,
      type: spendsWallet ? 'expense' : 'income',
      description: labels[operation.action] ?? operation.description,
      date: today(),
      ...operation.money,
      totalPence: toPence(operation.money),
      referenceId: operation.id,
      balanceDelta: payment?.balanceDelta,
      createdAt: new Date().toISOString(),
    })
  }, [character.id, onSave])

  const primaryAccess = storyAccess[0] ?? null

  return <>
    <Page title={character.name} subtitle="Personagem" onBack={onBack} trailing={<select value={character.id} onChange={(event) => onSelect(event.target.value)}>{allCharacters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>}>
      <div className={equivalent < 0 ? 'hero-balance negative' : 'hero-balance'}><span>Moedas na carteira</span><strong>{formatCoins(balance)}</strong><small>Gasto no bolso quebra Coroa automaticamente · equivalente: {formatMoney(equivalent)}</small></div>
      {tab === 'wallet' && <PlayerWallet character={character} balance={balance} connected={Boolean(operationSender)} notice={operationNotice} onSave={onSave} onConvert={(money, description) => sendOperation({ id: 'carteira', name: 'Carteira' }, 'convert', money, description)} />}
      {tab === 'institutions' && <PlayerInstitutions accesses={storyAccess} connected={Boolean(operationSender)} notice={operationNotice} onRefresh={() => accessRefresh?.() ?? false} onOperate={sendOperation} />}
      <section className="surface connection-keeper" hidden={tab !== 'session'}><PlayerCloudSession character={character} transactions={transactions} access={primaryAccess} onAccess={onAccess} onOperationResult={receiveOperation} onOperationSender={registerOperationSender} onAccessRefreshSender={registerAccessRefresh} /></section>
      {tab === 'requests' && <>
        <PlayerDebts accesses={storyAccess} balance={balance} connected={Boolean(operationSender)} notice={operationNotice} onPay={(institution, money, description, loanId) => sendOperation(institution, 'loanPay', money, description, loanId)} />
        <PlayerRequests accesses={storyAccess} connected={Boolean(operationSender)} balance={balance} onDecision={sendOperation} />
      </>}
      {tab === 'history' && <History entries={transactions} />}
    </Page>
    <BottomNav items={navItems} active={tab} onChange={(value) => setTab(value as typeof tab)} />
  </>
}

function PlayerInstitutions({ accesses, connected, notice, onRefresh, onOperate }: { accesses: PlayerStoryAccess[]; connected: boolean; notice: string; onRefresh: () => boolean; onOperate: (institution: { id: string; name: string }, action: InstitutionOperation['action'], money: CurrencyInput, description: string, requestId?: string) => string | null }) {
  const institutions = accesses.flatMap((access) => access.institutions.map((institution) => ({ ...institution, storyName: access.storyName })))
  type InstitutionAction = 'deposit' | 'withdraw' | 'depositRequest' | 'withdrawRequest' | 'loan'
  const [operation, setOperation] = useState<{ institution: typeof institutions[number]; action: InstitutionAction } | null>(null)
  const [money, setMoney] = useState<CurrencyInput>(emptyMoney)
  const [description, setDescription] = useState('')
  const [feedback, setFeedback] = useState('')

  function start(institution: typeof institutions[number], action: InstitutionAction) { setOperation({ institution, action }); setMoney(emptyMoney); setDescription(''); setFeedback('') }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!operation) return
    const error = onOperate(operation.institution, operation.action, money, description)
    if (error) { setFeedback(error); return }
    const waiting = operation.action.endsWith('Request') || operation.action === 'loan'
    setFeedback(waiting ? 'Pedido enviado ao mestre. Aguarde a aprovação…' : 'Operação enviada. Aguarde a confirmação da mesa…')
    setTimeout(() => setOperation(null), 900)
  }
  const titles: Record<InstitutionAction, string> = {
    deposit: 'Depositar direto em',
    depositRequest: 'Solicitar depósito em',
    withdraw: 'Retirar direto de',
    withdrawRequest: 'Solicitar retirada de',
    loan: 'Pedir empréstimo a',
  }
  const helpers: Record<InstitutionAction, string> = {
    deposit: 'Acontece na hora: as moedas saem da sua carteira e entram na instituição.',
    depositRequest: 'O mestre precisa aprovar. Só depois as moedas saem da carteira e entram na instituição.',
    withdraw: 'Acontece na hora: as moedas saem da instituição e entram na sua carteira.',
    withdrawRequest: 'O mestre precisa aprovar. Só depois as moedas saem da instituição e entram na sua carteira.',
    loan: 'Informe quanto deseja pedir. O mestre definirá juros, parcelas e decidirá se aprova.',
  }
  const isRequest = operation ? operation.action.endsWith('Request') || operation.action === 'loan' : false

  return <section>
    <div className="section-title"><div><p className="eyebrow">Acesso na mesa</p><h3>Instituições</h3></div><div className="sync-actions"><span className={connected ? 'status-pill' : 'status-pill offline'}>{connected ? '● Na mesa' : '○ Fora da mesa'}</span><button type="button" onClick={onRefresh} disabled={!connected}>↻ Atualizar</button></div></div>
    {notice && <p className="operation-notice" role="status">{notice}</p>}
    {!institutions.length && <EmptyState icon="♜" title="Nenhuma instituição na mesa" text="Quando o mestre criar organizações, elas aparecem aqui após atualizar." />}
    {institutions.map((institution) => <article className="player-institution" key={`${institution.storyName}:${institution.id}`}>
      <div className="institution-access-head"><div className="permission-title"><span className="avatar institution">{institution.kind[0]}</span><div><small>{institution.kind} · {institution.storyName}</small><strong>{institution.name}</strong></div></div><b>{formatCoins(institution.balance ?? fromPence(institution.balancePence))}</b></div>
      <div className="permission-tags actions">
        {institution.permissions.includes('deposit') && <button type="button" onClick={() => start(institution, 'depositRequest')}>Solicitar depósito</button>}
        {institution.permissions.includes('depositDirect') && <button type="button" className="direct" onClick={() => start(institution, 'deposit')}>Depositar direto</button>}
        {institution.permissions.includes('withdraw') && <button type="button" onClick={() => start(institution, 'withdrawRequest')}>Solicitar retirada</button>}
        {institution.permissions.includes('withdrawDirect') && <button type="button" className="direct" onClick={() => start(institution, 'withdraw')}>Retirar direto</button>}
        {institution.permissions.includes('loan') && <button type="button" onClick={() => start(institution, 'loan')}>Pedir empréstimo</button>}
      </div>
      {(institution.permissions.includes('view') || institution.ledger.length > 0) && <details className="institution-history"><summary>Ver histórico <span>{institution.ledger.length}</span></summary><div className="mini-history">{!institution.ledger.length && <p className="helper">Nenhuma movimentação compartilhada.</p>}{institution.ledger.slice(-8).reverse().map((entry) => <div key={entry.id}><span>{ledgerEntryLabel(entry)}</span><b>{entry.type === 'income' ? '+' : '−'}{formatCoins(entry)}</b></div>)}</div></details>}
    </article>)}
    {operation && <Modal title={`${titles[operation.action]} ${operation.institution.name}`} onClose={() => setOperation(null)}><form className="clean-form" onSubmit={submit}><p className="helper">{helpers[operation.action]}</p><label>Descrição<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={operation.action === 'loan' ? 'Motivo do empréstimo' : 'Motivo da movimentação'} /></label><MoneyFields money={money} setMoney={setMoney} />{feedback && <p className={feedback.includes('enviad') ? 'success' : 'error'}>{feedback}</p>}<button className="primary wide">{isRequest ? 'Enviar pedido ao mestre' : `Confirmar ${operation.action === 'deposit' ? 'depósito' : 'retirada'}`}</button></form></Modal>}
  </section>
}

function PlayerWallet({ character, balance, connected, notice, onSave, onConvert }: {
  character: Character
  balance: CurrencyInput
  connected: boolean
  notice: string
  onSave: (item: Transaction) => Promise<void>
  onConvert: (money: CurrencyInput, description: string) => string | null
}) {
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [description, setDescription] = useState('')
  const [money, setMoney] = useState(emptyMoney)
  const [error, setError] = useState('')
  const [convertFeedback, setConvertFeedback] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const totalPence = toPence(money)
    if (!totalPence) { setError('Informe ao menos uma moeda.'); return }
    if (type === 'expense') {
      const payment = payWithChange(balance, money)
      if (!payment) { setError('Moedas insuficientes na carteira.'); return }
      await onSave({ id: uid(), characterId: character.id, type, description: description.trim() || 'Gasto', date: today(), ...money, totalPence, balanceDelta: payment.balanceDelta, createdAt: new Date().toISOString() })
    } else {
      await onSave({ id: uid(), characterId: character.id, type, description: description.trim() || 'Ganho', date: today(), ...money, totalPence, createdAt: new Date().toISOString() })
    }
    setMoney(emptyMoney); setDescription(''); setError('')
  }

  function requestConversion(kind: 'crowns' | 'shillings') {
    setConvertFeedback('')
    if (!connected) { setConvertFeedback('Entre na mesa para pedir conversão.'); return }
    const moneyToConvert = kind === 'crowns'
      ? { crowns: balance.crowns, shillings: 0, pence: 0 }
      : { crowns: 0, shillings: balance.shillings, pence: 0 }
    if (!toPence(moneyToConvert)) {
      setConvertFeedback(kind === 'crowns' ? 'Você não tem Coroas para quebrar.' : 'Você não tem Chirlins para quebrar.')
      return
    }
    const label = kind === 'crowns'
      ? `Quebrar ${balance.crowns} Coroa(s) em ${balance.crowns * 20} Chirlins`
      : `Quebrar ${balance.shillings} Chirlin(s) em ${balance.shillings * 12} Pencils`
    const errorMessage = onConvert(moneyToConvert, label)
    if (errorMessage) { setConvertFeedback(errorMessage); return }
    setConvertFeedback('Pedido enviado. Aguarde o mestre aprovar.')
  }

  return <>
    <section className="surface"><div className="section-title"><div><p className="eyebrow">Movimentação</p><h3>Novo lançamento</h3></div><div className="segmented"><button className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>Gasto</button><button className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>Ganho</button></div></div><form className="clean-form" onSubmit={(event) => void submit(event)}><label>Descrição<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Estalagem" /></label><MoneyFields money={money} setMoney={setMoney} />{error && <p className="error">{error}</p>}<button className="primary wide">Registrar {type === 'income' ? 'ganho' : 'gasto'}</button></form></section>
    <section className="surface" style={{ marginTop: '0.85rem' }}>
      <div className="section-title"><div><p className="eyebrow">Sua carteira</p><h3>Pedir conversão</h3></div></div>
      <p className="helper">{connected ? 'Um toque envia o pedido. O mestre só aprova ou recusa — sem digitar valor.' : 'Entre na mesa para pedir conversão ao mestre.'}</p>
      <div className="request-actions">
        <button type="button" className="primary" disabled={!connected || balance.crowns <= 0} onClick={() => requestConversion('crowns')}>
          Quebrar Coroas → Chirlins{balance.crowns > 0 ? ` (${balance.crowns})` : ''}
        </button>
        <button type="button" className="primary" disabled={!connected || balance.shillings <= 0} onClick={() => requestConversion('shillings')}>
          Quebrar Chirlins → Pencils{balance.shillings > 0 ? ` (${balance.shillings})` : ''}
        </button>
      </div>
      {convertFeedback && <p className={convertFeedback.includes('enviado') ? 'success' : 'error'}>{convertFeedback}</p>}
      {notice && <p className="operation-notice" role="status">{notice}</p>}
    </section>
  </>
}

function StoryLibrary({ stories, onCreate, onOpen, onSave, onBack }: { stories: Story[]; onCreate: (name: string, description: string) => Promise<void>; onOpen: (id: string) => void; onSave: (story: Story) => Promise<void>; onBack: () => void }) {
  const [creating, setCreating] = useState(false); const [name, setName] = useState(''); const [description, setDescription] = useState('')
  const active = stories.filter((item) => !item.archived)
  return <Page title="Minhas Histórias" subtitle="Mestre" onBack={onBack} trailing={<button className="primary" onClick={() => setCreating(true)}>+ Nova História</button>}><div className="story-grid">{active.map((story) => <article className="story-card" key={story.id}><div className="story-seal">✦</div><div><p className="eyebrow">História</p><h3>{story.name}</h3><p>{story.description || 'Uma aventura pronta para começar.'}</p><div className="story-stats"><span>{story.members.length} jogadores</span><span>{story.institutions.length} instituições</span></div></div><div className="story-actions"><button className="primary" onClick={() => onOpen(story.id)}>Abrir</button><button className="ghost" onClick={() => onSave({ ...story, archived: true })}>Arquivar</button></div></article>)}</div>{!active.length && <EmptyState icon="✦" title="Sua primeira História começa aqui" text="Crie o cenário que reunirá jogadores, instituições e moedas." />} {creating && <Modal title="Criar História" onClose={() => setCreating(false)}><form className="clean-form" onSubmit={async (event) => { event.preventDefault(); await onCreate(name, description); setCreating(false) }}><label>Nome<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Sombras sobre Valária" /></label><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Uma breve introdução à aventura" /></label><button className="primary wide">Criar História</button></form></Modal>}</Page>
}

function StoryDashboard({ story, onSave, onBack, onToast }: { story: Story; onSave: (story: Story) => Promise<void>; onBack: () => void; onToast: (text: string) => void }) {
  const [tab, setTab] = useState<'overview' | 'institutions' | 'characters' | 'players' | 'loans' | 'session'>('overview')
  const total = addCoinBalances(story.institutions.map((item) => coinBalanceOf(item.ledger)))
  const accessFor = (characterId: string, source = story): PlayerStoryAccess | null => {
    const member = source.members.find((item) => item.characterId === characterId)
    if (!member) return null
    const permitted = source.institutions.filter((institution) => (member.permissions[institution.id] ?? []).length > 0)
    const visibleInstitutions = permitted.length ? permitted : source.institutions
    return {
      id: `${source.id}:${characterId}`,
      storyId: source.id,
      storyName: source.name,
      characterId,
      cloudMesaId: source.cloudMesaId,
      locked: Boolean(source.cloudMesaId),
      institutions: visibleInstitutions.map((institution) => ({
        id: institution.id,
        name: institution.name,
        kind: institution.kind,
        balancePence: ledgerBalance(institution.ledger),
        balance: coinBalanceOf(institution.ledger),
        ledger: (member.permissions[institution.id] ?? []).includes('view') || !permitted.length ? institution.ledger : [],
        permissions: member.permissions[institution.id] ?? [],
        withdrawLimitPence: member.withdrawLimits[institution.id],
      })),
      sharedCharacters: (member.sharedCharacterIds ?? []).length
        ? source.characters.filter((item) => (member.sharedCharacterIds ?? []).includes(item.id))
        : source.characters,
      requests: source.requests.filter((item) => item.characterId === characterId),
      loans: source.loans.filter((item) => item.characterId === characterId),
      updatedAt: new Date().toISOString(),
    }
  }

  async function handleInstitutionOperation(operation: InstitutionOperation): Promise<InstitutionOperationResult> {
    let current = story
    let member = current.members.find((item) => item.characterId === operation.characterId)
    if (!member) {
      member = { characterId: operation.characterId, name: 'Jogador', permissions: {}, withdrawLimits: {}, sharedCharacterIds: [], connectedAt: new Date().toISOString() }
      current = { ...current, members: [...current.members, member] }
      await onSave(current)
    }

    if (operation.action === 'convert') {
      if (!toPence(operation.money)) return { type: 'institution-operation-result', operation, ok: false, message: 'Nada para converter na carteira.', applyWallet: false }
      if (current.requests.some((item) => item.id === operation.id)) return { type: 'institution-operation-result', operation, ok: true, message: 'Pedido já registrado.', access: accessFor(operation.characterId, current) ?? undefined, applyWallet: false, nextStory: current }
      const request = { id: operation.id, characterId: operation.characterId, institutionId: 'carteira', type: 'convert' as const, money: operation.money, description: operation.description, status: 'pending-master' as const, createdAt: new Date().toISOString() }
      const nextStory = { ...current, requests: [...current.requests, request] }
      await onSave(nextStory)
      return { type: 'institution-operation-result', operation, ok: true, message: 'Pedido de conversão da carteira enviado ao mestre.', access: accessFor(operation.characterId, nextStory) ?? undefined, applyWallet: false, nextStory }
    }

    const institution = current.institutions.find((item) => item.id === operation.institutionId)
    if (!institution) return { type: 'institution-operation-result', operation, ok: false, message: 'Instituição não reconhecida.', applyWallet: false }

    if (operation.action === 'depositRequest' || operation.action === 'withdrawRequest') {
      const requestType = operation.action === 'depositRequest' ? 'deposit' as const : 'withdraw' as const
      if (!(member.permissions[institution.id] ?? []).includes(requestType)) {
        return { type: 'institution-operation-result', operation, ok: false, message: `O mestre não liberou solicitações de ${requestType === 'deposit' ? 'depósito' : 'retirada'} nesta instituição.`, applyWallet: false }
      }
      if (!toPence(operation.money)) return { type: 'institution-operation-result', operation, ok: false, message: 'Informe o valor.', applyWallet: false }
      if (current.requests.some((item) => item.id === operation.id)) return { type: 'institution-operation-result', operation, ok: true, message: 'Pedido já registrado.', access: accessFor(operation.characterId, current) ?? undefined, applyWallet: false, nextStory: current }
      const request = { id: operation.id, characterId: operation.characterId, institutionId: operation.institutionId, type: requestType, money: operation.money, description: operation.description, status: 'pending-master' as const, createdAt: new Date().toISOString() }
      const nextStory = { ...current, requests: [...current.requests, request] }
      await onSave(nextStory)
      return { type: 'institution-operation-result', operation, ok: true, message: `Pedido de ${requestType === 'deposit' ? 'depósito' : 'retirada'} enviado ao mestre.`, access: accessFor(operation.characterId, nextStory) ?? undefined, applyWallet: false, nextStory }
    }

    if (operation.action === 'loan') {
      if (!(member.permissions[institution.id] ?? []).includes('loan')) return { type: 'institution-operation-result', operation, ok: false, message: 'O mestre não liberou pedidos de empréstimo nesta instituição.' }
      if (!toPence(operation.money)) return { type: 'institution-operation-result', operation, ok: false, message: 'Informe o valor desejado.' }
      if (current.requests.some((item) => item.id === operation.id)) return { type: 'institution-operation-result', operation, ok: true, message: 'Pedido já enviado.', access: accessFor(operation.characterId, current) ?? undefined, nextStory: current }
      const request = { id: operation.id, characterId: operation.characterId, institutionId: operation.institutionId, type: 'loan' as const, money: operation.money, description: operation.description, status: 'pending-master' as const, createdAt: new Date().toISOString() }
      const nextStory = { ...current, requests: [...current.requests, request] }
      await onSave(nextStory)
      return { type: 'institution-operation-result', operation, ok: true, message: 'Pedido de empréstimo enviado ao mestre.', access: accessFor(operation.characterId, nextStory) ?? undefined, nextStory }
    }

    if (operation.action === 'loanAccept' || operation.action === 'loanDecline') {
      const request = current.requests.find((item) => item.id === operation.requestId && item.characterId === operation.characterId && item.status === 'pending-player')
      const loan = current.loans.find((item) => item.id === operation.requestId && item.status === 'pending')
      if (!request || !loan) return { type: 'institution-operation-result', operation, ok: false, message: 'Esta proposta não está mais disponível.', applyWallet: false }
      if (operation.action === 'loanDecline') {
        const nextStory = { ...current, requests: current.requests.map((item) => item.id === request.id ? { ...item, status: 'declined' as const } : item), loans: current.loans.map((item) => item.id === loan.id ? { ...item, status: 'declined' as const } : item) }
        await onSave(nextStory)
        return { type: 'institution-operation-result', operation, ok: true, message: 'Proposta de empréstimo recusada.', access: accessFor(operation.characterId, nextStory) ?? undefined, nextStory, applyWallet: false }
      }
      const loanInstitution = current.institutions.find((item) => item.id === request.institutionId) ?? institution
      const payment = payWithChange(coinBalanceOf(loanInstitution.ledger), request.money)
      if (!payment) return { type: 'institution-operation-result', operation, ok: false, message: 'A instituição não possui moedas suficientes para liberar o empréstimo.', applyWallet: false }
      const authoritativeOperation: InstitutionOperation = {
        ...operation,
        id: request.id,
        institutionId: loanInstitution.id,
        institutionName: loanInstitution.name,
        action: 'loanAccept',
        money: request.money,
        description: request.description,
        requestId: request.id,
      }
      const entry: LedgerEntry = { id: uid(), type: 'expense', description: `Empréstimo concedido a ${member.name}`, date: today(), ...request.money, totalPence: toPence(request.money), referenceId: request.id, balanceDelta: payment.balanceDelta, createdAt: new Date().toISOString() }
      const nextInstitution = { ...loanInstitution, ledger: [...loanInstitution.ledger, entry] }
      const nextStory = { ...current, institutions: current.institutions.map((item) => item.id === loanInstitution.id ? nextInstitution : item), requests: current.requests.map((item) => item.id === request.id ? { ...item, status: 'accepted' as const } : item), loans: current.loans.map((item) => item.id === loan.id ? { ...item, status: 'active' as const } : item) }
      await onSave(nextStory)
      return { type: 'institution-operation-result', operation: authoritativeOperation, ok: true, message: 'Empréstimo aceito. Moedas creditadas na carteira.', access: accessFor(operation.characterId, nextStory) ?? undefined, nextStory, applyWallet: true }
    }

    if (operation.action === 'chargeOffer') {
      const charge = current.requests.find((item) => item.id === operation.requestId && item.type === 'charge' && item.characterId === operation.characterId)
      if (!charge) return { type: 'institution-operation-result', operation, ok: false, message: 'Cobrança não encontrada.', applyWallet: false }
      if (charge.status !== 'pending-player' && charge.status !== 'pending-master') {
        return { type: 'institution-operation-result', operation, ok: false, message: 'Esta cobrança já foi resolvida.', applyWallet: false }
      }
      const offerPence = toPence(operation.money)
      if (offerPence <= 0) return { type: 'institution-operation-result', operation, ok: false, message: 'Informe quanto você consegue pagar.', applyWallet: false }
      const loan = current.loans.find((item) => item.id === (charge.loanId ?? charge.id) && item.characterId === operation.characterId && item.status === 'active')
      if (loan && offerPence > loan.remainingPence) {
        return { type: 'institution-operation-result', operation, ok: false, message: `A proposta ultrapassa a dívida (${formatMoney(loan.remainingPence)}).`, applyWallet: false }
      }
      const nextStory = {
        ...current,
        requests: current.requests.map((item) => item.id === charge.id ? {
          ...item,
          money: operation.money,
          dueDate: operation.dueDate || item.dueDate,
          playerNote: operation.description,
          status: 'pending-master' as const,
          description: `Jogador propôs pagar ${formatCoins(operation.money)}${operation.dueDate ? ` até ${operation.dueDate}` : ''}`,
        } : item),
      }
      await onSave(nextStory)
      return {
        type: 'institution-operation-result',
        operation,
        ok: true,
        message: 'Proposta enviada ao mestre. Nada saiu da carteira ainda.',
        access: accessFor(operation.characterId, nextStory) ?? undefined,
        nextStory,
        applyWallet: false,
      }
    }

    if (operation.action === 'loanPay') {
      const loan = current.loans.find((item) => item.id === operation.requestId && item.characterId === operation.characterId && item.status === 'active')
      if (!loan) return { type: 'institution-operation-result', operation, ok: false, message: 'Empréstimo ativo não encontrado.', applyWallet: false }
      const loanInstitution = current.institutions.find((item) => item.id === loan.institutionId)
      if (!loanInstitution) return { type: 'institution-operation-result', operation, ok: false, message: 'Instituição do empréstimo não encontrada.', applyWallet: false }
      const payPence = toPence(operation.money)
      if (payPence <= 0) return { type: 'institution-operation-result', operation, ok: false, message: 'Informe um valor para pagar.', applyWallet: false }
      if (payPence > loan.remainingPence) return { type: 'institution-operation-result', operation, ok: false, message: `O valor ultrapassa o saldo devedor (${formatMoney(loan.remainingPence)}).`, applyWallet: false }
      if (loanInstitution.ledger.some((entry) => entry.referenceId === operation.id)) {
        return { type: 'institution-operation-result', operation, ok: true, message: 'Pagamento já registrado.', access: accessFor(operation.characterId, current) ?? undefined, nextStory: current, applyWallet: false }
      }
      const entry: LedgerEntry = { id: uid(), type: 'income', description: `Pagamento de empréstimo por ${member.name}${operation.description ? ` — ${operation.description}` : ''}`, date: today(), ...operation.money, totalPence: payPence, referenceId: operation.id, createdAt: new Date().toISOString() }
      const remaining = loan.remainingPence - payPence
      const nextLoan: Loan = { ...loan, remainingPence: remaining, status: remaining <= 0 ? 'paid' : 'active' }
      const nextStory = {
        ...current,
        institutions: current.institutions.map((item) => item.id === loanInstitution.id ? { ...item, ledger: [...item.ledger, entry] } : item),
        loans: current.loans.map((item) => item.id === loan.id ? nextLoan : item),
        requests: current.requests.map((item) => item.type === 'charge' && (item.status === 'pending-player' || item.status === 'pending-master') && item.characterId === operation.characterId && (item.loanId === loan.id || (!item.loanId && item.institutionId === loan.institutionId)) ? { ...item, status: 'accepted' as const } : item),
      }
      await onSave(nextStory)
      return {
        type: 'institution-operation-result',
        operation: { ...operation, id: operation.id, institutionId: loanInstitution.id, institutionName: loanInstitution.name, action: 'loanPay' },
        ok: true,
        message: remaining <= 0 ? 'Empréstimo quitado!' : `Pagamento parcial recebido. Restam ${formatMoney(remaining)} — o mestre pode aumentar a dívida se quiser.`,
        access: accessFor(operation.characterId, nextStory) ?? undefined,
        nextStory,
        applyWallet: true,
      }
    }

    const permissions = member.permissions[institution.id] ?? []
    if (operation.action === 'deposit' && !permissions.includes('depositDirect')) return { type: 'institution-operation-result', operation, ok: false, message: 'O mestre não liberou depósito direto nesta instituição.', applyWallet: false }
    if (operation.action === 'withdraw' && !permissions.includes('withdrawDirect')) return { type: 'institution-operation-result', operation, ok: false, message: 'O mestre não liberou retirada direta nesta instituição.', applyWallet: false }
    if (!toPence(operation.money)) return { type: 'institution-operation-result', operation, ok: false, message: 'Informe ao menos uma moeda.', applyWallet: false }
    if (institution.ledger.some((entry) => entry.referenceId === operation.id)) {
      return { type: 'institution-operation-result', operation, ok: true, message: 'Esta operação já havia sido registrada.', access: accessFor(operation.characterId, current) ?? undefined, nextStory: current, applyWallet: false }
    }

    const payment = operation.action === 'withdraw' ? payWithChange(coinBalanceOf(institution.ledger), operation.money) : null
    if (operation.action === 'withdraw' && !payment) return { type: 'institution-operation-result', operation, ok: false, message: 'A instituição não possui moedas suficientes para esta retirada.', applyWallet: false }
    const limit = member.withdrawLimits[institution.id]
    if (operation.action === 'withdraw' && limit !== undefined && toPence(operation.money) > limit) return { type: 'institution-operation-result', operation, ok: false, message: 'A retirada ultrapassa o limite definido pelo mestre.', applyWallet: false }

    const entry: LedgerEntry = { id: uid(), type: operation.action === 'deposit' ? 'income' : 'expense', description: `${operation.action === 'deposit' ? `Depósito direto de ${member.name}` : `Retirada direta por ${member.name}`}${operation.description ? ` — ${operation.description}` : ''}`, date: today(), ...operation.money, totalPence: toPence(operation.money), referenceId: operation.id, balanceDelta: payment?.balanceDelta, createdAt: new Date().toISOString() }
    const nextInstitution = { ...institution, ledger: [...institution.ledger, entry] }
    const nextStory = { ...current, institutions: current.institutions.map((item) => item.id === institution.id ? nextInstitution : item) }
    await onSave(nextStory)
    return { type: 'institution-operation-result', operation, ok: true, message: `${operation.action === 'deposit' ? 'Depósito' : 'Retirada'} direto concluído.`, access: accessFor(operation.characterId, nextStory) ?? undefined, nextStory, applyWallet: true }
  }
  return <><Page title={story.name} subtitle="História" onBack={onBack} trailing={<span className="status-pill">{story.cloudMesaId ? '● Online' : '● Local'}</span>}><div className="story-tabs">{([['overview','Visão geral'],['institutions','Instituições'],['characters','Personagens'],['players','Jogadores'],['loans','Pedidos'],['session','Sessão']] as const).map(([key,label]) => <button className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}>{label}</button>)}</div>{tab === 'overview' && <Overview story={story} total={total} onNavigate={setTab} />}{tab === 'institutions' && <Institutions story={story} onSave={onSave} />}{tab === 'characters' && <StoryCharacters story={story} onSave={onSave} />}{tab === 'players' && <Players story={story} onSave={onSave} />}{tab === 'loans' && <Loans story={story} onSave={onSave} onToast={onToast} />}<section className="surface session-surface connection-keeper" hidden={tab !== 'session'}><MasterCloudSession story={story} onSave={onSave} storyAccessFor={accessFor} onInstitutionOperation={handleInstitutionOperation} onToast={onToast} /></section></Page><BottomNav items={[['overview','Resumo','⌂'],['institutions','Instituições','♜'],['players','Jogadores','♙'],['session','Sessão','⌁']]} active={tab} onChange={(value) => setTab(value as typeof tab)} /></>
}

function Overview({ story, total, onNavigate }: { story: Story; total: CurrencyInput; onNavigate: (tab: 'institutions' | 'characters' | 'players' | 'loans') => void }) { const pending = story.requests.filter((item) => item.status.includes('pending')).length; return <><div className="metric-grid"><div className="metric gold"><small>Patrimônio institucional</small><strong>{formatCoins(total)}</strong><small>Equivalente a {formatMoney(toPence(total))}</small></div><button className="metric" onClick={() => onNavigate('players')}><small>Jogadores</small><strong>{story.members.length}</strong></button><button className="metric" onClick={() => onNavigate('institutions')}><small>Instituições</small><strong>{story.institutions.length}</strong></button><button className="metric" onClick={() => onNavigate('loans')}><small>Pendências</small><strong>{pending}</strong></button></div><section className="surface"><div className="section-title"><h3>Atividade da História</h3></div><EmptyState icon="◇" title="Tudo tranquilo por aqui" text="Movimentações e solicitações recentes aparecerão neste painel." /></section></> }

function Institutions({ story, onSave }: { story: Story; onSave: (story: Story) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(''); const [kind, setKind] = useState('Taverna'); const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = story.institutions.find((item) => item.id === selectedId)
  async function saveInstitution(institution: StoryInstitution) { await onSave({ ...story, institutions: story.institutions.map((item) => item.id === institution.id ? institution : item) }) }
  if (selected) return <InstitutionWallet institution={selected} onBack={() => setSelectedId(null)} onSave={saveInstitution} />
  return <section><div className="section-title"><div><p className="eyebrow">Economia da História</p><h3>Instituições</h3></div><button className="primary" onClick={() => setOpen(true)}>+ Nova instituição</button></div><div className="card-grid">{story.institutions.map((item) => <button className="wallet-card wallet-card-button" key={item.id} onClick={() => setSelectedId(item.id)}><span className="avatar institution">{item.kind[0]}</span><div><small>{item.kind}</small><strong>{item.name}</strong><b>{formatCoins(coinBalanceOf(item.ledger))}</b><span>{item.ledger.length} movimentações</span></div><b className="card-arrow">→</b></button>)}</div>{!story.institutions.length && <EmptyState icon="♜" title="Nenhuma instituição" text="Crie Tavernas, Bancos, Casas, Governos ou qualquer organização da História." />}{open && <Modal title="Nova instituição" onClose={() => setOpen(false)}><form className="clean-form" onSubmit={async (event) => { event.preventDefault(); const item: StoryInstitution = { id: uid(), name: name.trim(), kind: kind.trim(), createdAt: new Date().toISOString(), ledger: [] }; if (!item.name) return; await onSave({ ...story, institutions: [...story.institutions, item] }); setOpen(false) }}><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Estalagem Lua Cinzenta" /></label><label>Tipo<input value={kind} onChange={(event) => setKind(event.target.value)} placeholder="Taverna, Banco, Casa…" /></label><button className="primary wide">Criar instituição</button></form></Modal>}</section>
}

function InstitutionWallet({ institution, onBack, onSave }: { institution: StoryInstitution; onBack: () => void; onSave: (institution: StoryInstitution) => Promise<void> }) {
  const [type, setType] = useState<'income' | 'expense'>('income'); const [description, setDescription] = useState(''); const [date, setDate] = useState(today()); const [money, setMoney] = useState<CurrencyInput>(emptyMoney); const [error, setError] = useState('')
  const balance = coinBalanceOf(institution.ledger)
  const equivalent = toPence(balance)
  async function submit(event: FormEvent) { event.preventDefault(); const totalPence = toPence(money); if (!totalPence) { setError('Informe ao menos uma moeda.'); return }; const entry: LedgerEntry = { id: uid(), type, description: description.trim() || (type === 'income' ? 'Entrada de moedas' : 'Saída de moedas'), date, ...money, totalPence, createdAt: new Date().toISOString() }; await onSave({ ...institution, ledger: [...institution.ledger, entry] }); setMoney(emptyMoney); setDescription(''); setError('') }
  async function removeEntry(id: string) { if (!window.confirm('Excluir esta movimentação da instituição?')) return; await onSave({ ...institution, ledger: institution.ledger.filter((item) => item.id !== id) }) }
  const entries = [...institution.ledger].sort((a,b) => b.createdAt.localeCompare(a.createdAt))
  return <section className="institution-detail"><button className="sub-back" onClick={onBack}>← Todas as instituições</button><div className="institution-heading"><span className="avatar institution large">{institution.kind[0]}</span><div><p className="eyebrow">{institution.kind}</p><h2>{institution.name}</h2></div></div><div className={equivalent < 0 ? 'hero-balance negative' : 'hero-balance'}><span>Saldo da instituição</span><strong>{formatCoins(balance)}</strong><small>{institution.ledger.length} movimentações · equivalente a {formatMoney(equivalent)}</small></div><section className="surface"><div className="section-title"><div><p className="eyebrow">Livro-caixa</p><h3>Nova movimentação</h3></div><div className="segmented"><button type="button" className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>Entrada</button><button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>Saída</button></div></div><form className="clean-form" onSubmit={submit}><label>Descrição<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={type === 'income' ? 'Ex.: Venda de bebidas' : 'Ex.: Compra de mantimentos'} /></label><label>Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><MoneyFields money={money} setMoney={setMoney} />{error && <p className="error">{error}</p>}<button className="primary wide">Registrar {type === 'income' ? 'entrada' : 'saída'}</button></form></section><section className="surface"><div className="section-title"><h3>Histórico da instituição</h3><span className="status-pill">{entries.length} registros</span></div>{!entries.length && <EmptyState icon="≡" title="Nenhuma movimentação" text="Registre a primeira entrada ou saída desta instituição." />}{entries.map((entry) => <div className="history-row" key={entry.id}><span className={`movement-icon ${entry.type}`}>{entry.type === 'income' ? '+' : '−'}</span><div><strong>{ledgerEntryLabel(entry)}</strong><small>{new Date(`${entry.date}T12:00:00`).toLocaleDateString('pt-BR')}</small></div><div className="entry-actions"><b>{entry.type === 'income' ? '+' : '−'}{formatCoins(entry)}</b><button className="danger" onClick={() => removeEntry(entry.id)}>Excluir</button></div></div>)}</section></section>
}

function StoryCharacters({ story, onSave }: { story: Story; onSave: (story: Story) => Promise<void> }) { const [name, setName] = useState(''); return <section><div className="section-title"><div><p className="eyebrow">Administrados pelo mestre</p><h3>Personagens compartilhados</h3></div></div><form className="inline-create surface" onSubmit={async (event) => { event.preventDefault(); if (!name.trim()) return; const item: StoryCharacter = { id: uid(), name: name.trim(), institutionIds: [], createdAt: new Date().toISOString(), ledger: [] }; await onSave({ ...story, characters: [...story.characters, item] }); setName('') }}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do personagem" /><button className="primary">Criar personagem</button></form><div className="card-grid">{story.characters.map((item) => <article className="wallet-card" key={item.id}><span className="avatar">{item.name[0]}</span><div><small>Personagem compartilhado</small><strong>{item.name}</strong><b>{formatCoins(coinBalanceOf(item.ledger))}</b></div></article>)}</div></section> }

function Players({ story, onSave }: { story: Story; onSave: (story: Story) => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null); const member = story.members.find((item) => item.characterId === selectedId)
  async function updateMember(next: typeof member) { if (!next) return; await onSave({ ...story, members: story.members.map((item) => item.characterId === next.characterId ? next : item) }) }
  if (member) return <section><button className="sub-back" onClick={() => setSelectedId(null)}>← Todos os jogadores</button><div className="member-profile"><span className="avatar large">{member.name[0]}</span><div><p className="eyebrow">Personagem do jogador</p><h2>{member.name}</h2><small>A carteira pessoal permanece privada.</small></div></div><section className="surface"><h3>Personagens liberados</h3><p className="helper">Escolha quais personagens compartilhados este jogador pode visualizar e usar.</p>{!story.characters.length && <EmptyState icon="♙" title="Nenhum personagem compartilhado" text="Crie personagens na aba Personagens antes de liberá-los." />}{story.characters.map((character) => <label className="permission-row" key={character.id}><div><strong>{character.name}</strong><small>Personagem administrado pelo mestre</small></div><input type="checkbox" checked={(member.sharedCharacterIds ?? []).includes(character.id)} onChange={() => { const current = member.sharedCharacterIds ?? []; void updateMember({ ...member, sharedCharacterIds: current.includes(character.id) ? current.filter((id) => id !== character.id) : [...current, character.id] }) }} /></label>)}</section><section className="surface"><h3>Permissões por instituição</h3><p className="helper">“Direto” permite movimentar sem uma aprovação nova do mestre.</p>{!story.institutions.length && <EmptyState icon="♜" title="Nenhuma instituição" text="Crie uma instituição antes de definir permissões." />}{story.institutions.map((institution) => <div className="permission-group" key={institution.id}><div className="permission-title"><span className="avatar institution">{institution.kind[0]}</span><div><strong>{institution.name}</strong><small>{institution.kind}</small></div></div><div className="permission-grid">{([['view','Visualizar saldo e histórico'],['deposit','Solicitar depósito'],['depositDirect','Depositar diretamente'],['withdraw','Solicitar retirada'],['withdrawDirect','Retirar diretamente'],['loan','Solicitar empréstimo']] as const).map(([permission,label]) => <label key={permission}><input type="checkbox" checked={(member.permissions[institution.id] ?? []).includes(permission)} onChange={() => { const current = member.permissions[institution.id] ?? []; const next = current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]; void updateMember({ ...member, permissions: { ...member.permissions, [institution.id]: next } }) }} /> {label}</label>)}</div>{((member.permissions[institution.id] ?? []).includes('withdraw') || (member.permissions[institution.id] ?? []).includes('withdrawDirect')) && <label className="limit-field">Limite de retirada (em Pencils)<input type="number" min="0" value={member.withdrawLimits[institution.id] ?? ''} onChange={(event) => void updateMember({ ...member, withdrawLimits: { ...member.withdrawLimits, [institution.id]: Math.max(0, Number(event.target.value) || 0) } })} placeholder="Sem limite" /></label>}</div>)}</section></section>
  return <section><div className="section-title"><div><p className="eyebrow">Vínculos e acesso</p><h3>Jogadores</h3></div></div>{!story.members.length && <EmptyState icon="♙" title="Nenhum jogador vinculado" text="Abra a Sessão, gere um código e peça para o jogador entrar com esses 9 caracteres." />}{story.members.map((item) => <button className="member-card member-button" onClick={() => setSelectedId(item.characterId)} key={item.characterId}><span className="avatar">{item.name[0]}</span><div><strong>{item.name}</strong><small>Definir personagens e permissões</small></div><span className="status-pill">Vinculado</span><b>→</b></button>)}</section>
}

function Loans({ story, onSave, onToast }: { story: Story; onSave: (story: Story) => Promise<void>; onToast: (text: string) => void }) {
  const [terms, setTerms] = useState<Record<string, { interest: number; installments: number; dueDate: string }>>({})
  const [chargeLoanId, setChargeLoanId] = useState<string | null>(null)
  const [chargeMoney, setChargeMoney] = useState(emptyMoney)
  const [interestLoanId, setInterestLoanId] = useState<string | null>(null)
  const [extraInterest, setExtraInterest] = useState(5)
  const [bumpLoanId, setBumpLoanId] = useState<string | null>(null)
  const [bumpMoney, setBumpMoney] = useState(emptyMoney)
  const loanRequests = story.requests.filter((item) => item.type === 'loan')
  const convertRequests = story.requests.filter((item) => item.type === 'convert')
  const moneyRequests = story.requests.filter((item) => item.type === 'deposit' || item.type === 'withdraw')
  const chargeOffers = story.requests.filter((item) => item.type === 'charge' && item.status === 'pending-master')
  const activeLoans = story.loans.filter((item) => item.status === 'active')
  const defaults = (id: string) => terms[id] ?? { interest: 10, installments: 3, dueDate: today() }
  const change = (id: string, values: Partial<ReturnType<typeof defaults>>) => setTerms((current) => ({ ...current, [id]: { ...defaults(id), ...values } }))
  const chargeTarget = activeLoans.find((item) => item.id === chargeLoanId) ?? null
  const interestTarget = activeLoans.find((item) => item.id === interestLoanId) ?? null
  const bumpTarget = activeLoans.find((item) => item.id === bumpLoanId) ?? null
  async function approve(request: typeof loanRequests[number]) { const config = defaults(request.id); const principal = toPence(request.money); const total = Math.ceil(principal * (1 + config.interest / 100)); const installments = Math.max(1, config.installments); const loan = { id: request.id, characterId: request.characterId, institutionId: request.institutionId, principalPence: principal, interestPercent: config.interest, installments, installmentPence: Math.ceil(total / installments), remainingPence: total, dueDate: config.dueDate, status: 'pending' as const }; await onSave({ ...story, loans: [...story.loans.filter((item) => item.id !== loan.id), loan], requests: story.requests.map((item) => item.id === request.id ? { ...item, status: 'pending-player' as const } : item) }); onToast('Proposta enviada ao jogador.') }
  async function decline(requestId: string) { await onSave({ ...story, loans: story.loans.map((item) => item.id === requestId ? { ...item, status: 'declined' as const } : item), requests: story.requests.map((item) => item.id === requestId ? { ...item, status: 'declined' as const } : item) }); onToast('Pedido recusado.') }
  function openCharge(loan: Loan, preset: 'installment' | 'full' | 'custom' = 'installment') {
    const remaining = fromPence(loan.remainingPence)
    const installment = fromPence(Math.min(loan.installmentPence, loan.remainingPence))
    setChargeLoanId(loan.id)
    setChargeMoney(preset === 'full'
      ? { crowns: remaining.crowns, shillings: remaining.shillings, pence: remaining.pence }
      : { crowns: installment.crowns, shillings: installment.shillings, pence: installment.pence })
  }
  async function sendCharge(event: FormEvent) {
    event.preventDefault()
    if (!chargeTarget) return
    const payPence = toPence(chargeMoney)
    if (!payPence) { onToast('Informe um valor para cobrar.'); return }
    if (payPence > chargeTarget.remainingPence) { onToast('Valor maior que o saldo devedor.'); return }
    const member = story.members.find((item) => item.characterId === chargeTarget.characterId)
    const institution = story.institutions.find((item) => item.id === chargeTarget.institutionId)
    const request = {
      id: uid(),
      characterId: chargeTarget.characterId,
      institutionId: chargeTarget.institutionId,
      loanId: chargeTarget.id,
      type: 'charge' as const,
      money: chargeMoney,
      description: `Cobrança do empréstimo — ${institution?.name ?? 'instituição'}`,
      status: 'pending-player' as const,
      createdAt: new Date().toISOString(),
    }
    await onSave({ ...story, requests: [...story.requests, request] })
    setChargeLoanId(null)
    onToast(`Cobrança de ${formatCoins(chargeMoney)} enviada para ${member?.name ?? 'jogador'}.`)
  }
  async function applyExtraInterest(event: FormEvent) {
    event.preventDefault()
    if (!interestTarget) return
    const percent = Math.max(0, extraInterest)
    if (!percent) { onToast('Informe um percentual de juros.'); return }
    const added = Math.ceil(interestTarget.remainingPence * (percent / 100))
    if (!added) { onToast('O acréscimo ficou zerado neste saldo.'); return }
    const nextLoan: Loan = {
      ...interestTarget,
      interestPercent: Math.round((interestTarget.interestPercent + percent) * 10) / 10,
      remainingPence: interestTarget.remainingPence + added,
      installmentPence: Math.max(interestTarget.installmentPence, Math.ceil((interestTarget.remainingPence + added) / Math.max(1, interestTarget.installments))),
    }
    await onSave({ ...story, loans: story.loans.map((item) => item.id === nextLoan.id ? nextLoan : item) })
    setInterestLoanId(null)
    onToast(`Juros +${percent}% aplicados. Dívida subiu ${formatMoney(added)}.`)
  }
  async function applyDebtBump(event: FormEvent) {
    event.preventDefault()
    if (!bumpTarget) return
    const added = toPence(bumpMoney)
    if (!added) { onToast('Informe quanto quer acrescentar à dívida.'); return }
    const nextLoan: Loan = {
      ...bumpTarget,
      remainingPence: bumpTarget.remainingPence + added,
      installmentPence: Math.max(bumpTarget.installmentPence, Math.ceil((bumpTarget.remainingPence + added) / Math.max(1, bumpTarget.installments))),
    }
    await onSave({ ...story, loans: story.loans.map((item) => item.id === nextLoan.id ? nextLoan : item) })
    setBumpLoanId(null)
    setBumpMoney(emptyMoney)
    onToast(`Dívida aumentou em ${formatMoney(added)}. Novo saldo: ${formatMoney(nextLoan.remainingPence)}.`)
  }
  async function acceptChargeOffer(request: typeof chargeOffers[number]) {
    await onSave({
      ...story,
      requests: story.requests.map((item) => item.id === request.id ? {
        ...item,
        status: 'pending-player' as const,
        description: `Cobrança acordada: ${formatCoins(request.money)}${request.dueDate ? ` até ${request.dueDate}` : ''}`,
      } : item),
    })
    onToast('Proposta aceita. O jogador pode pagar esse valor agora.')
  }
  async function rejectChargeOffer(requestId: string) {
    await onSave({ ...story, requests: story.requests.map((item) => item.id === requestId ? { ...item, status: 'declined' as const } : item) })
    onToast('Proposta recusada.')
  }
  async function approveConvert(request: typeof convertRequests[number]) {
    const member = story.members.find((item) => item.characterId === request.characterId)
    const nextStory = {
      ...story,
      requests: story.requests.map((item) => item.id === request.id ? { ...item, status: 'accepted' as const } : item),
    }
    await onSave(nextStory)
    if (story.cloudMesaId) {
      await postMessage(story.cloudMesaId, 'operation-result', {
        type: 'institution-operation-result',
        operation: {
          type: 'institution-operation',
          id: request.id,
          characterId: request.characterId,
          institutionId: 'carteira',
          institutionName: 'Carteira',
          action: 'convert',
          description: request.description,
          money: request.money,
        },
        ok: true,
        message: 'Conversão da carteira aprovada.',
        applyWallet: true,
      } satisfies InstitutionOperationResult, request.characterId)
    }
    onToast(`Conversão aprovada para ${member?.name ?? 'jogador'}.`)
  }
  async function approveMoneyRequest(request: typeof moneyRequests[number]) {
    const institution = story.institutions.find((item) => item.id === request.institutionId)
    const member = story.members.find((item) => item.characterId === request.characterId)
    if (!institution || !member) { onToast('Instituição ou jogador não encontrado.'); return }
    if (request.type === 'withdraw') {
      const payment = payWithChange(coinBalanceOf(institution.ledger), request.money)
      if (!payment) { onToast('A instituição não tem moedas suficientes.'); return }
      const limit = member.withdrawLimits[institution.id]
      if (limit !== undefined && toPence(request.money) > limit) { onToast('A retirada ultrapassa o limite do jogador.'); return }
      const entry: LedgerEntry = { id: uid(), type: 'expense', description: `Retirada aprovada para ${member.name}${request.description ? ` — ${request.description}` : ''}`, date: today(), ...request.money, totalPence: toPence(request.money), referenceId: request.id, balanceDelta: payment.balanceDelta, createdAt: new Date().toISOString() }
      const nextStory = {
        ...story,
        institutions: story.institutions.map((item) => item.id === institution.id ? { ...item, ledger: [...item.ledger, entry] } : item),
        requests: story.requests.map((item) => item.id === request.id ? { ...item, status: 'accepted' as const } : item),
      }
      await onSave(nextStory)
      if (story.cloudMesaId) {
        await postMessage(story.cloudMesaId, 'operation-result', {
          type: 'institution-operation-result',
          operation: { type: 'institution-operation', id: request.id, characterId: request.characterId, institutionId: request.institutionId, institutionName: institution.name, action: 'withdraw', description: request.description, money: request.money },
          ok: true,
          message: 'Retirada aprovada pelo mestre.',
          applyWallet: true,
        } satisfies InstitutionOperationResult, request.characterId)
      }
      onToast('Retirada aprovada.')
      return
    }
    const entry: LedgerEntry = { id: uid(), type: 'income', description: `Depósito aprovado de ${member.name}${request.description ? ` — ${request.description}` : ''}`, date: today(), ...request.money, totalPence: toPence(request.money), referenceId: request.id, createdAt: new Date().toISOString() }
    const nextStory = {
      ...story,
      institutions: story.institutions.map((item) => item.id === institution.id ? { ...item, ledger: [...item.ledger, entry] } : item),
      requests: story.requests.map((item) => item.id === request.id ? { ...item, status: 'accepted' as const } : item),
    }
    await onSave(nextStory)
    if (story.cloudMesaId) {
      await postMessage(story.cloudMesaId, 'operation-result', {
        type: 'institution-operation-result',
        operation: { type: 'institution-operation', id: request.id, characterId: request.characterId, institutionId: request.institutionId, institutionName: institution.name, action: 'deposit', description: request.description, money: request.money },
        ok: true,
        message: 'Depósito aprovado pelo mestre.',
        applyWallet: true,
      } satisfies InstitutionOperationResult, request.characterId)
    }
    onToast('Depósito aprovado.')
  }
  return <section>
    <div className="section-title"><div><p className="eyebrow">Crédito ativo</p><h3>Empréstimos em aberto</h3></div></div>
    {!activeLoans.length && <p className="helper">Nenhum empréstimo ativo. Quando o jogador aceitar uma proposta, a dívida aparece aqui.</p>}
    {activeLoans.map((loan) => {
      const member = story.members.find((item) => item.characterId === loan.characterId)
      const institution = story.institutions.find((item) => item.id === loan.institutionId)
      return <article className="request-card" key={loan.id}>
        <small>{institution?.name ?? 'Instituição'} · {member?.name ?? 'Jogador'}</small>
        <strong>Saldo devedor {formatMoney(loan.remainingPence)}</strong>
        <div className="loan-terms">
          <span>Parcela: <b>{formatMoney(loan.installmentPence)}</b></span>
          <span>Juros: <b>{loan.interestPercent}%</b></span>
          <span>Vencimento: <b>{new Date(`${loan.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}</b></span>
        </div>
        <div className="request-actions">
          <button className="primary" onClick={() => openCharge(loan, 'installment')}>Enviar cobrança</button>
          <button onClick={() => openCharge(loan, 'full')}>Cobrar total</button>
          <button onClick={() => { setInterestLoanId(loan.id); setExtraInterest(5) }}>Aumentar juros</button>
          <button onClick={() => { setBumpLoanId(loan.id); setBumpMoney(emptyMoney) }}>Aumentar valor</button>
        </div>
      </article>
    })}
    {chargeTarget && <Modal title="Enviar cobrança" onClose={() => setChargeLoanId(null)}>
      <form className="clean-form" onSubmit={(event) => void sendCharge(event)}>
        <p className="helper">O jogador recebe o pedido e pode pagar este valor, outro valor parcial, ou avisar quanto consegue pagar e até quando.</p>
        <div className="request-actions">
          <button type="button" onClick={() => openCharge(chargeTarget, 'installment')}>Usar parcela</button>
          <button type="button" onClick={() => openCharge(chargeTarget, 'full')}>Usar total</button>
        </div>
        <MoneyFields money={chargeMoney} setMoney={setChargeMoney} />
        <button className="primary wide">Enviar cobrança ao jogador</button>
      </form>
    </Modal>}
    {interestTarget && <Modal title="Aumentar juros da dívida" onClose={() => setInterestLoanId(null)}>
      <form className="clean-form" onSubmit={(event) => void applyExtraInterest(event)}>
        <p className="helper">Saldo atual: {formatMoney(interestTarget.remainingPence)}. O percentual extra é aplicado sobre esse saldo.</p>
        <label>Aumentar juros em (%)
          <input type="number" min="0" step="0.5" value={extraInterest} onChange={(event) => setExtraInterest(Math.max(0, Number(event.target.value) || 0))} />
        </label>
        <p className="helper">Prévia: +{formatMoney(Math.ceil(interestTarget.remainingPence * (Math.max(0, extraInterest) / 100)))} na dívida.</p>
        <button className="primary wide">Aplicar juros</button>
      </form>
    </Modal>}
    {bumpTarget && <Modal title="Aumentar valor da dívida" onClose={() => setBumpLoanId(null)}>
      <form className="clean-form" onSubmit={(event) => void applyDebtBump(event)}>
        <p className="helper">Saldo atual: {formatMoney(bumpTarget.remainingPence)}. Use quando o jogador não pagar tudo de uma vez e você quiser aplicar multa ou acréscimo fixo.</p>
        <MoneyFields money={bumpMoney} setMoney={setBumpMoney} />
        <p className="helper">Novo saldo: {formatMoney(bumpTarget.remainingPence + toPence(bumpMoney))}.</p>
        <button className="primary wide">Somar à dívida</button>
      </form>
    </Modal>}
    <div className="section-title" style={{ marginTop: '1.25rem' }}><div><p className="eyebrow">Aprovações</p><h3>Pedidos</h3></div></div>
    {!loanRequests.length && !convertRequests.length && !moneyRequests.length && !chargeOffers.length && <EmptyState icon="◈" title="Nenhum pedido" text="Depósitos, retiradas, empréstimos, propostas de pagamento e conversões aparecem aqui." />}
    {chargeOffers.map((request) => {
      const member = story.members.find((item) => item.characterId === request.characterId)
      const institution = story.institutions.find((item) => item.id === request.institutionId)
      const loan = activeLoans.find((item) => item.id === request.loanId)
      return <article className="request-card" key={request.id}>
        <small>{institution?.name ?? 'Instituição'} · Proposta de pagamento</small>
        <strong>{member?.name ?? 'Jogador'} pode pagar {formatCoins(request.money)}</strong>
        <p>{request.description}</p>
        {request.dueDate && <p className="helper">Até {new Date(`${request.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}</p>}
        {request.playerNote && <p className="helper">Nota: {request.playerNote}</p>}
        {loan && <p className="helper">Dívida atual: {formatMoney(loan.remainingPence)}</p>}
        <div className="request-actions">
          <button className="primary" onClick={() => void acceptChargeOffer(request)}>Aceitar proposta</button>
          {loan && <button onClick={() => { setBumpLoanId(loan.id); setBumpMoney(emptyMoney) }}>Aumentar dívida</button>}
          {loan && <button onClick={() => openCharge(loan, 'installment')}>Nova cobrança</button>}
          <button className="danger" onClick={() => void rejectChargeOffer(request.id)}>Recusar</button>
        </div>
      </article>
    })}
    {moneyRequests.map((request) => {
      const member = story.members.find((item) => item.characterId === request.characterId)
      const institution = story.institutions.find((item) => item.id === request.institutionId)
      const label = request.type === 'deposit' ? 'Depósito' : 'Retirada'
      return <article className="request-card" key={request.id}>
        <small>{institution?.name ?? 'Instituição'} · {label}</small>
        <strong>{member?.name ?? 'Jogador'} pediu {label.toLowerCase()} de {formatCoins(request.money)}</strong>
        <p>{request.description}</p>
        {request.status === 'pending-master' && <div className="request-actions"><button className="primary" onClick={() => void approveMoneyRequest(request)}>Aprovar {label.toLowerCase()}</button><button className="danger" onClick={() => void decline(request.id)}>Recusar</button></div>}
        {request.status === 'accepted' && <span className="status-pill">Aprovado</span>}
        {request.status === 'declined' && <span className="status-pill offline">Recusado</span>}
      </article>
    })}
    {convertRequests.map((request) => {
      const member = story.members.find((item) => item.characterId === request.characterId)
      const summary = request.money.crowns > 0
        ? `${request.money.crowns} Coroa(s) → ${request.money.crowns * 20} Chirlins`
        : `${request.money.shillings} Chirlin(s) → ${request.money.shillings * 12} Pencils`
      return <article className="request-card" key={request.id}>
        <small>Carteira · Conversão</small>
        <strong>{member?.name ?? 'Jogador'} pediu {summary}</strong>
        <p>{request.description || 'Conversão só da carteira do jogador.'}</p>
        {request.status === 'pending-master' && <div className="request-actions"><button className="primary" onClick={() => void approveConvert(request)}>Aprovar</button><button className="danger" onClick={() => void decline(request.id)}>Recusar</button></div>}
        {request.status === 'accepted' && <span className="status-pill">Aprovado</span>}
        {request.status === 'declined' && <span className="status-pill offline">Recusado</span>}
      </article>
    })}
    {loanRequests.map((request) => { const member = story.members.find((item) => item.characterId === request.characterId); const institution = story.institutions.find((item) => item.id === request.institutionId); const config = defaults(request.id); const loan = story.loans.find((item) => item.id === request.id); return <article className="request-card" key={request.id}><small>{institution?.name ?? 'Instituição'} · Empréstimo</small><strong>{member?.name ?? 'Jogador'} pediu {formatCoins(request.money)}</strong><p>{request.description}</p>{request.status === 'pending-master' && <div className="loan-editor"><label>Juros (%)<input type="number" min="0" step="0.1" value={config.interest} onChange={(event) => change(request.id, { interest: Math.max(0, Number(event.target.value) || 0) })} /></label><label>Parcelas<input type="number" min="1" step="1" value={config.installments} onChange={(event) => change(request.id, { installments: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /></label><label>Primeiro vencimento<input type="date" value={config.dueDate} onChange={(event) => change(request.id, { dueDate: event.target.value })} /></label><div className="request-actions"><button className="primary" onClick={() => void approve(request)}>Enviar proposta</button><button className="danger" onClick={() => void decline(request.id)}>Recusar</button></div></div>}{request.status === 'pending-player' && <span className="status-pill offline">Aguardando o jogador · {loan?.interestPercent}% · {loan?.installments} parcelas</span>}{request.status === 'accepted' && <span className="status-pill">Ativo · saldo devedor {formatMoney(loan?.remainingPence ?? 0)}</span>}{request.status === 'declined' && <span className="status-pill offline">Recusado</span>}</article> })}
  </section>
}

function PlayerDebts({ accesses, balance, connected, notice, onPay }: {
  accesses: PlayerStoryAccess[]
  balance: CurrencyInput
  connected: boolean
  notice: string
  onPay: (institution: { id: string; name: string }, money: CurrencyInput, description: string, loanId: string) => string | null
}) {
  const debts = accesses.flatMap((access) => (access.loans ?? [])
    .filter((loan) => loan.status === 'active' || loan.status === 'paid')
    .map((loan) => ({
      loan,
      access,
      institution: access.institutions.find((item) => item.id === loan.institutionId) ?? { id: loan.institutionId, name: 'Instituição' },
    })))
  const active = debts.filter((item) => item.loan.status === 'active')
  const [payingId, setPayingId] = useState<string | null>(null)
  const [money, setMoney] = useState(emptyMoney)
  const [feedback, setFeedback] = useState('')
  const current = active.find((item) => item.loan.id === payingId) ?? null

  function openPay(loan: Loan, preset?: 'installment' | 'full') {
    const remaining = fromPence(loan.remainingPence)
    const installment = fromPence(Math.min(loan.installmentPence, loan.remainingPence))
    setPayingId(loan.id)
    setMoney(preset === 'full' ? { crowns: remaining.crowns, shillings: remaining.shillings, pence: remaining.pence } : { crowns: installment.crowns, shillings: installment.shillings, pence: installment.pence })
    setFeedback('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!current) return
    if (!payWithChange(balance, money)) { setFeedback('Moedas insuficientes na carteira.'); return }
    if (toPence(money) > current.loan.remainingPence) { setFeedback('Valor maior que a dívida restante.'); return }
    const error = onPay(current.institution, money, `Pagamento do empréstimo`, current.loan.id)
    if (error) { setFeedback(error); return }
    setFeedback('Pagamento enviado à instituição. Aguarde confirmação…')
    setTimeout(() => setPayingId(null), 900)
  }

  return <section style={{ marginBottom: '1rem' }}>
    <div className="section-title"><div><p className="eyebrow">Contas a pagar</p><h3>Empréstimos</h3></div></div>
    {notice && <p className="operation-notice" role="status">{notice}</p>}
    {!active.length && <p className="helper">Nenhuma dívida ativa no momento.</p>}
    {active.map(({ loan, access, institution }) => <article className="request-card" key={loan.id}>
      <small>{access.storyName} · {institution.name}</small>
      <strong>Devendo {formatMoney(loan.remainingPence)}</strong>
      <div className="loan-terms">
        <span>Parcela: <b>{formatMoney(loan.installmentPence)}</b></span>
        <span>Juros: <b>{loan.interestPercent}%</b></span>
        <span>Parcelas: <b>{loan.installments}</b></span>
        <span>Vencimento: <b>{new Date(`${loan.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}</b></span>
      </div>
      <div className="request-actions">
        <button className="primary" disabled={!connected} onClick={() => openPay(loan, 'installment')}>Pagar parcela</button>
        <button disabled={!connected} onClick={() => openPay(loan, 'full')}>Quitar</button>
      </div>
    </article>)}
    {payingId && current && <Modal title={`Pagar — ${current.institution.name}`} onClose={() => setPayingId(null)}>
      <form className="clean-form" onSubmit={submit}>
        <p className="helper">Restam {formatMoney(current.loan.remainingPence)}. Pague o que tiver agora — o valor sai da carteira. Se não puder pagar tudo, use a cobrança do mestre para avisar quanto e quando consegue.</p>
        <MoneyFields money={money} setMoney={setMoney} />
        {feedback && <p className={feedback.includes('enviado') ? 'success' : 'error'}>{feedback}</p>}
        <button className="primary wide" disabled={!connected}>Confirmar pagamento</button>
      </form>
    </Modal>}
  </section>
}

function PlayerRequests({ accesses, connected, balance, onDecision }: {
  accesses: PlayerStoryAccess[]
  connected: boolean
  balance: CurrencyInput
  onDecision: (institution: { id: string; name: string }, action: InstitutionOperation['action'], money: CurrencyInput, description: string, requestId?: string, dueDate?: string) => string | null
}) {
  const requests = accesses.flatMap((access) => (access.requests ?? []).map((request) => ({
    request,
    access,
    institution: access.institutions.find((item) => item.id === request.institutionId) ?? { id: request.institutionId, name: 'Instituição' },
    loan: (access.loans ?? []).find((item) => item.id === request.loanId)
      ?? (access.loans ?? []).find((item) => item.id === request.id)
      ?? (access.loans ?? []).find((item) => item.institutionId === request.institutionId && item.status === 'active'),
  }))).sort((a,b) => b.request.createdAt.localeCompare(a.request.createdAt))
  const [payingChargeId, setPayingChargeId] = useState<string | null>(null)
  const [payMoney, setPayMoney] = useState(emptyMoney)
  const [payDueDate, setPayDueDate] = useState(today())
  const [payNote, setPayNote] = useState('')
  const [payFeedback, setPayFeedback] = useState('')
  const paying = requests.find((item) => item.request.id === payingChargeId) ?? null

  function openChargePay(requestId: string, suggested: CurrencyInput) {
    setPayingChargeId(requestId)
    setPayMoney(suggested)
    setPayDueDate(today())
    setPayNote('')
    setPayFeedback('')
  }

  function submitChargePay(event: FormEvent) {
    event.preventDefault()
    if (!paying?.loan) { setPayFeedback('Empréstimo não encontrado.'); return }
    if (!toPence(payMoney)) { setPayFeedback('Informe um valor.'); return }
    if (toPence(payMoney) > paying.loan.remainingPence) { setPayFeedback('Valor maior que a dívida restante.'); return }
    if (!payWithChange(balance, payMoney)) { setPayFeedback('Moedas insuficientes na carteira.'); return }
    const error = onDecision(paying.institution, 'loanPay', payMoney, paying.request.description, paying.loan.id)
    if (error) { setPayFeedback(error); return }
    setPayFeedback('Pagamento enviado. Aguarde confirmação…')
    setTimeout(() => setPayingChargeId(null), 900)
  }

  function submitChargeOffer(event: FormEvent) {
    event.preventDefault()
    if (!paying) { setPayFeedback('Cobrança não encontrada.'); return }
    if (!toPence(payMoney)) { setPayFeedback('Informe quanto você consegue pagar.'); return }
    if (paying.loan && toPence(payMoney) > paying.loan.remainingPence) { setPayFeedback('Valor maior que a dívida restante.'); return }
    const note = payNote.trim() || `Posso pagar ${formatCoins(payMoney)} até ${payDueDate}`
    const error = onDecision(paying.institution, 'chargeOffer', payMoney, note, paying.request.id, payDueDate)
    if (error) { setPayFeedback(error); return }
    setPayFeedback('Proposta enviada ao mestre. Nada saiu da carteira.')
    setTimeout(() => setPayingChargeId(null), 900)
  }

  if (!requests.length) return <EmptyState icon="✉" title="Nenhuma solicitação" text="Pedidos de depósito, retirada, empréstimo, cobrança e conversão aparecem aqui." />
  return <section>
    <div className="section-title"><div><p className="eyebrow">Aguardando decisões</p><h3>Pedidos</h3></div></div>
    {requests.map(({ request, access, institution, loan }) => {
      const kind = request.type === 'loan' ? 'Empréstimo' : request.type === 'convert' ? 'Conversão' : request.type === 'deposit' ? 'Depósito' : request.type === 'withdraw' ? 'Retirada' : request.type === 'charge' ? 'Cobrança' : 'Pedido'
      return <article className="request-card" key={request.id}>
        <small>{access.storyName} · {institution.name} · {kind}</small>
        <strong>{kind} de {formatCoins(request.money)}</strong>
        <p>{request.description}</p>
        {request.status === 'pending-master' && <span className="status-pill offline">Aguardando o mestre</span>}
        {request.status === 'pending-player' && request.type === 'loan' && loan && <>
          <div className="loan-terms">
            <span>Juros: <b>{loan.interestPercent}%</b></span>
            <span>Parcelas: <b>{loan.installments}× de {formatMoney(loan.installmentPence)}</b></span>
            <span>Total a devolver: <b>{formatMoney(loan.remainingPence)}</b></span>
          </div>
          <div className="request-actions">
            <button className="primary" disabled={!connected} onClick={() => onDecision(institution, 'loanAccept', request.money, request.description, request.id)}>Aceitar e receber</button>
            <button className="danger" disabled={!connected} onClick={() => onDecision(institution, 'loanDecline', emptyMoney, request.description, request.id)}>Recusar</button>
          </div>
        </>}
        {request.status === 'pending-player' && request.type === 'charge' && <>
          <p className="helper">Pague o que tiver agora, ou avise o mestre quanto e até quando consegue pagar.</p>
          <div className="request-actions">
            <button className="primary" disabled={!connected || !loan} onClick={() => openChargePay(request.id, request.money)}>Pagar / propor valor</button>
          </div>
        </>}
        {request.status === 'accepted' && <span className="status-pill">Aprovado</span>}
        {request.status === 'declined' && <span className="status-pill offline">Recusado</span>}
      </article>
    })}
    {paying && <Modal title="Responder cobrança" onClose={() => setPayingChargeId(null)}>
      <div className="clean-form">
        <p className="helper">
          Cobrado: {formatCoins(paying.request.money)}.
          {paying.loan ? ` Dívida restante: ${formatMoney(paying.loan.remainingPence)}.` : ''}
        </p>
        <MoneyFields money={payMoney} setMoney={setPayMoney} />
        <label>Até quando posso pagar
          <input type="date" value={payDueDate} onChange={(event) => setPayDueDate(event.target.value)} />
        </label>
        <label>Nota para o mestre (opcional)
          <input value={payNote} onChange={(event) => setPayNote(event.target.value)} placeholder="Ex.: Só tenho isso agora" />
        </label>
        {payFeedback && <p className={payFeedback.includes('enviad') || payFeedback.includes('Proposta') ? 'success' : 'error'}>{payFeedback}</p>}
        <div className="request-actions">
          <button className="primary" disabled={!connected} type="button" onClick={(event) => submitChargePay(event as unknown as FormEvent)}>Pagar agora</button>
          <button disabled={!connected} type="button" onClick={(event) => submitChargeOffer(event as unknown as FormEvent)}>Avisar o mestre (sem pagar)</button>
        </div>
      </div>
    </Modal>}
  </section>
}

function History({ entries }: { entries: Transaction[] }) { const sorted = [...entries].sort((a,b) => b.createdAt.localeCompare(a.createdAt)); return <section className="surface"><h3>Histórico</h3>{!sorted.length && <EmptyState icon="≡" title="Nenhuma movimentação" text="Ganhos e gastos aparecerão aqui." />}{sorted.map((item) => <div className="history-row" key={item.id}><span className={`movement-icon ${item.type}`}>{item.type === 'income' ? '+' : '−'}</span><div><strong>{item.description}</strong><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')}</small></div><b>{item.type === 'income' ? '+' : '−'}{formatCoins(item)}</b></div>)}</section> }

function MoneyFields({ money, setMoney }: { money: CurrencyInput; setMoney: (money: CurrencyInput) => void }) { return <div className="currency-fields">{([['crowns','Coroas'],['shillings','Chirlins'],['pence','Pencils']] as const).map(([key,label]) => <label key={key}>{label}<input type="number" min="0" inputMode="numeric" value={money[key] || ''} onChange={(event) => setMoney({ ...money, [key]: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} placeholder="0" /></label>)}</div> }
function ledgerEntryLabel(entry: LedgerEntry) { if (!/[←→]/.test(entry.description)) return entry.description; const note = entry.description.split(/[←→]/)[0].trim(); if (entry.type === 'income') return /depósito/i.test(note) ? note : `Depósito — ${note}`; return /retirada/i.test(note) ? note.replace(/retirada direta/i, 'Retirada') : `Retirada — ${note}` }
function Page({ title, subtitle, onBack, trailing, children }: { title: string; subtitle: string; onBack: () => void; trailing?: React.ReactNode; children: React.ReactNode }) { return <section className="page"><header className="page-header"><button className="back" onClick={onBack}>←</button><div><small>{subtitle}</small><h1>{title}</h1></div>{trailing && <div className="page-trailing">{trailing}</div>}</header>{children}</section> }
function BottomNav({ items, active, onChange }: { items: readonly (readonly [string,string,string])[]; active: string; onChange: (key: string) => void }) { return <nav className="bottom-nav">{items.map(([key,label,icon]) => <button className={active === key ? 'active' : ''} onClick={() => onChange(key)} key={key}><span>{icon}</span>{label}</button>)}</nav> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true"><header><h2>{title}</h2><button onClick={onClose}>×</button></header>{children}</section></div> }
function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="empty-panel"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div> }
function EmptyOrCreate({ empty, title, description, children }: { empty: boolean; title: string; description: string; children: React.ReactNode }) { return <section className={empty ? 'create-panel empty' : 'create-panel'}>{empty && <><h2>{title}</h2><p>{description}</p></>}{children}</section> }
function ledgerBalance(entries: LedgerEntry[]) { return entries.reduce((sum, item) => sum + (item.type === 'income' ? item.totalPence : -item.totalPence), 0) }
