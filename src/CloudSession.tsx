import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  createInviteCode,
  ensureCloudMesa,
  fetchPendingMessages,
  fetchStory,
  getLatestInviteCode,
  joinMesaWithCode,
  listMembers,
  markMessagesConsumed,
  postMessage,
  pushMemberWallet,
  pushStory,
  subscribeMesa,
  type CloudMember,
  type InstitutionOperation,
  type InstitutionOperationResult,
} from './cloud'
import { formatCoins } from './currency'
import { supabaseConfigured } from './supabase'
import type { Character, PlayerStoryAccess, Story, Transaction } from './types'

const MASTER_KEY_STORAGE = 'carteira-master-key'

function getMasterKey(): string {
  const existing = localStorage.getItem(MASTER_KEY_STORAGE)
  if (existing) return existing
  const created = crypto.randomUUID()
  localStorage.setItem(MASTER_KEY_STORAGE, created)
  return created
}

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now()
}

export function MasterCloudSession({
  story,
  onSave,
  storyAccessFor,
  onInstitutionOperation,
  onToast,
}: {
  story: Story
  onSave: (story: Story) => Promise<void>
  storyAccessFor: (characterId: string, source?: Story) => PlayerStoryAccess | null
  onInstitutionOperation: (operation: InstitutionOperation) => Promise<InstitutionOperationResult>
  onToast: (text: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null)
  const [members, setMembers] = useState<CloudMember[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const storyRef = useRef(story)
  const processing = useRef(false)
  const opHandlerRef = useRef(onInstitutionOperation)
  const accessForRef = useRef(storyAccessFor)
  const onSaveRef = useRef(onSave)
  const onToastRef = useRef(onToast)

  useEffect(() => { storyRef.current = story }, [story])
  useEffect(() => { opHandlerRef.current = onInstitutionOperation }, [onInstitutionOperation])
  useEffect(() => { accessForRef.current = storyAccessFor }, [storyAccessFor])
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { onToastRef.current = onToast }, [onToast])

  async function refreshMembers(mesaId: string) {
    setMembers(await listMembers(mesaId))
  }

  async function ensureOnline() {
    const masterKey = getMasterKey()
    const mesaId = await ensureCloudMesa(storyRef.current, masterKey)
    let next = storyRef.current
    if (!next.cloudMesaId || next.masterKey !== masterKey) {
      next = { ...next, cloudMesaId: mesaId, masterKey }
      await onSave(next)
      storyRef.current = next
    }
    await pushStory(mesaId, masterKey, next)
    return { mesaId, masterKey, story: next }
  }

  async function generateCode() {
    if (!supabaseConfigured) { setStatus('Supabase não configurado.'); return }
    setBusy(true)
    try {
      const { mesaId } = await ensureOnline()
      const nextInvite = await createInviteCode(mesaId)
      setInvite(nextInvite)
      setStatus('Código gerado. Compartilhe com o jogador — válido por 12 horas.')
      await refreshMembers(mesaId)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao gerar código.')
    } finally {
      setBusy(false)
    }
  }

  async function bootstrap() {
    if (!supabaseConfigured) { setStatus('Configure o Supabase no .env para usar a mesa online.'); return }
    setBusy(true)
    try {
      const { mesaId } = await ensureOnline()
      const latest = await getLatestInviteCode(mesaId)
      if (latest && !isExpired(latest.expiresAt)) setInvite(latest)
      else setInvite(null)
      await refreshMembers(mesaId)
      setStatus(latest && !isExpired(latest.expiresAt) ? 'Mesa online pronta.' : 'Mesa online pronta. Gere um código para convidar.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível conectar a mesa.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void bootstrap() }, [story.id])

  useEffect(() => {
    const mesaId = story.cloudMesaId
    if (!mesaId || !supabaseConfigured) return

    async function tick() {
      if (processing.current) return
      processing.current = true
      try {
        await refreshMembers(mesaId!)
        const pending = await fetchPendingMessages(mesaId!, ['operation'])
        for (const message of pending) {
          const operation = message.payload as InstitutionOperation
          const result = await opHandlerRef.current(operation)
          if (result.nextStory) storyRef.current = result.nextStory
          if (result.ok && result.access === undefined) {
            result.access = accessForRef.current(operation.characterId, storyRef.current) ?? undefined
          }
          const { nextStory: _ignored, ...payload } = result
          await postMessage(mesaId!, 'operation-result', payload, operation.characterId)
          await markMessagesConsumed([message.id as string])
        }

        const joined = await listMembers(mesaId!)
        const missing = joined.filter((member) => !storyRef.current.members.some((item) => item.characterId === member.character_id))
        if (missing.length) {
          const nextStory = {
            ...storyRef.current,
            members: [
              ...storyRef.current.members,
              ...missing.map((member) => ({
                characterId: member.character_id,
                name: member.character_name,
                permissions: {},
                withdrawLimits: {},
                sharedCharacterIds: [] as string[],
                connectedAt: member.joined_at,
              })),
            ],
          }
          await onSaveRef.current(nextStory)
          storyRef.current = nextStory
          onToastRef.current(`${missing.length} jogador(es) entraram na mesa.`)
        }

        const current = storyRef.current
        if (current.cloudMesaId && current.masterKey) {
          await pushStory(current.cloudMesaId, current.masterKey, current)
        }
      } catch (error) {
        console.error(error)
      } finally {
        processing.current = false
      }
    }

    void tick()
    const interval = window.setInterval(() => void tick(), 2500)
    const channel = subscribeMesa(mesaId, () => void tick())
    return () => {
      window.clearInterval(interval)
      void supabaseRemove(channel)
    }
  }, [story.cloudMesaId])

  const selected = members.find((item) => item.character_id === selectedMemberId) ?? null

  return <section className="tavern-panel">
    <div className="form-title">
      <div>
        <p className="eyebrow">Mesa online</p>
        <h2>Convidar por código</h2>
      </div>
      <button type="button" className="primary" disabled={busy} onClick={() => void generateCode()}>
        {invite ? 'Gerar novo código' : 'Gerar código'}
      </button>
    </div>
    <p className="helper">O código tem 9 caracteres e vale por 12 horas. Você pode gerar outro a qualquer momento para novos jogadores. Quem já entrou permanece na mesa.</p>
    {invite && <div className="signal-card">
      <small>{isExpired(invite.expiresAt) ? 'Código expirado' : 'Código ativo'}</small>
      <strong className="invite-code">{invite.code}</strong>
      <p>Válido até {formatExpiry(invite.expiresAt)}</p>
    </div>}
    {status && <p className="operation-notice" role="status">{status}</p>}
    <div className="section-title"><div><p className="eyebrow">Na mesa</p><h3>Personagens conectados</h3></div></div>
    {!members.length && <p className="helper">Nenhum jogador entrou ainda.</p>}
    <div className="card-grid">
      {members.map((member) => <button className="entity-card" key={member.id} type="button" onClick={() => setSelectedMemberId(member.character_id)}>
        <span className="avatar">{member.character_name[0]?.toUpperCase()}</span>
        <div><strong>{member.character_name}</strong><small>{member.transactions.length} lançamentos</small></div>
        <b>→</b>
      </button>)}
    </div>
    {selected && <MemberWalletModal member={selected} onClose={() => setSelectedMemberId(null)} />}
  </section>
}

function MemberWalletModal({ member, onClose }: { member: CloudMember; onClose: () => void }) {
  const entries = [...member.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true">
      <header><h2>{member.character_name}</h2><button type="button" onClick={onClose}>×</button></header>
      <p className="helper">Carteira e histórico sincronizados deste personagem na mesa.</p>
      {!entries.length && <p className="helper">Sem lançamentos ainda.</p>}
      {entries.map((item) => <div className="history-row" key={item.id}>
        <span className={`movement-icon ${item.type}`}>{item.type === 'income' ? '+' : '−'}</span>
        <div><strong>{item.description}</strong><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')}</small></div>
        <b>{item.type === 'income' ? '+' : '−'}{formatCoins(item)}</b>
      </div>)}
    </section>
  </div>
}

export function PlayerCloudSession({
  character,
  transactions,
  access,
  onAccess,
  onOperationResult,
  onOperationSender,
  onAccessRefreshSender,
}: {
  character: Character
  transactions: Transaction[]
  access: PlayerStoryAccess | null
  onAccess: (access: PlayerStoryAccess) => Promise<void>
  onOperationResult: (result: InstitutionOperationResult) => void | Promise<void>
  onOperationSender: (sender: ((operation: InstitutionOperation) => boolean) | null) => void
  onAccessRefreshSender: (sender: (() => boolean) | null) => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(access ? `Você está na mesa “${access.storyName}”.` : '')
  const accessRef = useRef(access)
  const transactionsRef = useRef(transactions)
  const onAccessRef = useRef(onAccess)
  const onResultRef = useRef(onOperationResult)
  const onSenderRef = useRef(onOperationSender)
  const onRefreshRef = useRef(onAccessRefreshSender)
  const syncing = useRef(false)

  useEffect(() => { accessRef.current = access }, [access])
  useEffect(() => { transactionsRef.current = transactions }, [transactions])
  useEffect(() => { onAccessRef.current = onAccess }, [onAccess])
  useEffect(() => { onResultRef.current = onOperationResult }, [onOperationResult])
  useEffect(() => { onSenderRef.current = onOperationSender }, [onOperationSender])
  useEffect(() => { onRefreshRef.current = onAccessRefreshSender }, [onAccessRefreshSender])

  useEffect(() => {
    const mesaId = access?.cloudMesaId
    if (!mesaId) {
      onSenderRef.current(null)
      onRefreshRef.current(null)
      return () => {
        onSenderRef.current(null)
        onRefreshRef.current(null)
      }
    }

    onSenderRef.current((operation) => {
      const id = accessRef.current?.cloudMesaId
      if (!id) return false
      void postMessage(id, 'operation', operation)
      return true
    })
    onRefreshRef.current(() => {
      const id = accessRef.current?.cloudMesaId
      if (!id) return false
      void (async () => {
        const story = await fetchStory(id)
        if (!story) return
        const next = buildAccess(story, character.id, id)
        if (next) await onAccessRef.current(next)
        setStatus('Sessão atualizada.')
      })()
      return true
    })

    return () => {
      onSenderRef.current(null)
      onRefreshRef.current(null)
    }
  }, [access?.cloudMesaId, character.id])

  useEffect(() => {
    const mesaId = access?.cloudMesaId
    if (!mesaId || !supabaseConfigured) return

    async function sync() {
      if (syncing.current) return
      syncing.current = true
      try {
        await pushMemberWallet(mesaId!, character.id, character.name, transactionsRef.current)
        const story = await fetchStory(mesaId!)
        if (story) {
          const next = buildAccess(story, character.id, mesaId!)
          if (next) await onAccessRef.current(next)
        }
        const results = await fetchPendingMessages(mesaId!, ['operation-result'], character.id)
        for (const message of results) {
          await Promise.resolve(onResultRef.current(message.payload as InstitutionOperationResult))
        }
        if (results.length) await markMessagesConsumed(results.map((item) => item.id as string))
      } catch (error) {
        console.error(error)
      } finally {
        syncing.current = false
      }
    }

    void sync()
    const interval = window.setInterval(() => void sync(), 2500)
    const channel = subscribeMesa(mesaId, () => void sync())
    return () => {
      window.clearInterval(interval)
      void supabaseRemove(channel)
    }
  }, [access?.cloudMesaId, character.id, character.name])

  async function join(event: FormEvent) {
    event.preventDefault()
    if (!supabaseConfigured) { setStatus('Supabase não configurado.'); return }
    if (access) { setStatus('Este personagem já está em uma mesa. Apague o personagem para começar de novo.'); return }
    setBusy(true)
    try {
      const joined = await joinMesaWithCode(code, character)
      const nextAccess = buildAccess(joined.story, character.id, joined.mesaId)
        ?? {
          id: `${joined.mesaId}:${character.id}`,
          storyId: joined.story.id,
          storyName: joined.story.name,
          characterId: character.id,
          cloudMesaId: joined.mesaId,
          institutions: [],
          sharedCharacters: joined.story.characters,
          requests: [],
          loans: [],
          locked: true,
          updatedAt: new Date().toISOString(),
        }
      nextAccess.locked = true
      nextAccess.cloudMesaId = joined.mesaId
      nextAccess.sharedCharacters = joined.story.characters
      await onAccess(nextAccess)
      await pushMemberWallet(joined.mesaId, character.id, character.name, transactions)
      setCode('')
      setStatus(`Entrou na mesa “${joined.story.name}”. Este personagem fica vinculado a ela.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível entrar na mesa.')
    } finally {
      setBusy(false)
    }
  }

  if (access?.cloudMesaId) {
    return <section className="tavern-panel">
      <div className="form-title"><div><p className="eyebrow">Mesa online</p><h2>{access.storyName}</h2></div><span className="status-pill">● Vinculado</span></div>
      <p className="helper">Você permanece com este personagem nesta mesa. Não é possível sair — só apagar o personagem e criar outro.</p>
      {!!access.sharedCharacters.length && <>
        <div className="section-title"><div><p className="eyebrow">Na história</p><h3>Personagens do mestre</h3></div></div>
        <div className="card-grid">{access.sharedCharacters.map((item) => <article className="wallet-card" key={item.id}><span className="avatar">{item.name[0]}</span><div><strong>{item.name}</strong><small>Criado pelo mestre</small></div></article>)}</div>
      </>}
      {status && <p className="operation-notice" role="status">{status}</p>}
    </section>
  }

  return <section className="tavern-panel">
    <div className="form-title"><div><p className="eyebrow">Mesa online</p><h2>Entrar com código</h2></div></div>
    <p className="helper">Digite o código de 9 caracteres que o mestre compartilhou. Depois de entrar, este personagem fica vinculado à mesa.</p>
    <form className="clean-form" onSubmit={(event) => void join(event)}>
      <label>Código da mesa
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Ex.: A3K9M2X7Q" maxLength={9} autoCapitalize="characters" />
      </label>
      <button className="primary wide" disabled={busy || code.trim().length < 9}>{busy ? 'Entrando…' : 'Entrar na mesa'}</button>
    </form>
    {status && <p className="operation-notice" role="status">{status}</p>}
  </section>
}

function buildAccess(story: Story, characterId: string, mesaId: string): PlayerStoryAccess | null {
  const member = story.members.find((item) => item.characterId === characterId)
  if (!member) {
    return {
      id: `${mesaId}:${characterId}`,
      storyId: story.id,
      storyName: story.name,
      characterId,
      cloudMesaId: mesaId,
      institutions: story.institutions.map((institution) => ({
        id: institution.id,
        name: institution.name,
        kind: institution.kind,
        balancePence: institution.ledger.reduce((sum, item) => sum + (item.type === 'income' ? item.totalPence : -item.totalPence), 0),
        balance: undefined,
        ledger: [],
        permissions: [],
      })),
      sharedCharacters: story.characters,
      requests: story.requests.filter((item) => item.characterId === characterId),
      loans: story.loans.filter((item) => item.characterId === characterId),
      locked: true,
      updatedAt: new Date().toISOString(),
    }
  }
  return {
    id: `${story.id}:${characterId}`,
    storyId: story.id,
    storyName: story.name,
    characterId,
    cloudMesaId: mesaId,
    institutions: story.institutions.filter((institution) => (member.permissions[institution.id] ?? []).length > 0).map((institution) => ({
      id: institution.id,
      name: institution.name,
      kind: institution.kind,
      balancePence: institution.ledger.reduce((sum, item) => sum + (item.type === 'income' ? item.totalPence : -item.totalPence), 0),
      balance: undefined,
      ledger: (member.permissions[institution.id] ?? []).includes('view') ? institution.ledger : [],
      permissions: member.permissions[institution.id] ?? [],
      withdrawLimitPence: member.withdrawLimits[institution.id],
    })),
    sharedCharacters: story.characters.filter((item) => (member.sharedCharacterIds ?? []).includes(item.id)).length
      ? story.characters.filter((item) => (member.sharedCharacterIds ?? []).includes(item.id))
      : story.characters,
    requests: story.requests.filter((item) => item.characterId === characterId),
    loans: story.loans.filter((item) => item.characterId === characterId),
    locked: true,
    updatedAt: new Date().toISOString(),
  }
}

async function supabaseRemove(channel: ReturnType<typeof subscribeMesa>) {
  await channel.unsubscribe()
}
