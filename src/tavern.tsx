import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { toPence } from './currency'
import { db } from './database'
import type { Character, CurrencyInput, Institution, InstitutionPermission, Loan, MasterSession, PlayerStoryAccess, SessionMember, Transaction } from './types'

type Signal = { version: 1; kind: 'offer' | 'answer'; description: RTCSessionDescriptionInit }
type TransferRequest = { type: 'transfer-request'; id: string; playerName: string; description: string; money: CurrencyInput }
type TransferApproved = { type: 'transfer-approved'; id: string; tavernName: string; description: string; money: CurrencyInput }
type Pending = TransferRequest & { channel: RTCDataChannel }
type JoinMessage = { type: 'join'; characterId: string; playerName: string }
type ChargeRequest = { type: 'charge-request'; id: string; institution: string; description: string; dueDate: string; money: CurrencyInput }
type ChargeResponse = { type: 'charge-response'; id: string; accepted: boolean; playerName: string }
type Player = { characterId: string; name: string; channel: RTCDataChannel }
type AccessMessage = { type: 'access-snapshot'; access: PlayerStoryAccess }
type AccessRefreshRequest = { type: 'access-refresh-request'; characterId: string }
export type InstitutionOperation = { type: 'institution-operation'; id: string; characterId: string; institutionId: string; institutionName: string; action: 'deposit' | 'withdraw' | 'loan' | 'loanAccept' | 'loanDecline'; description: string; money: CurrencyInput; requestId?: string }
export type InstitutionOperationResult = { type: 'institution-operation-result'; operation: InstitutionOperation; ok: boolean; message: string; access?: PlayerStoryAccess }

const emptyMoney: CurrencyInput = { crowns: 0, shillings: 0, pence: 0 }
const uid = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16)).join('-')
const encode = (signal: Signal) => btoa(unescape(encodeURIComponent(JSON.stringify(signal))))
const decode = (code: string): Signal => JSON.parse(decodeURIComponent(escape(atob(code.trim())))) as Signal

async function waitForIce(connection: RTCPeerConnection) {
  if (connection.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => connection.addEventListener('icegatheringstatechange', () => {
    if (connection.iceGatheringState === 'complete') resolve()
  }))
}

export function TavernPanel({ character, transactions, onSave, allowHost, showWorkspace = true, onPlayerConnected, storyAccessFor, onAccessReceived, onInstitutionOperation, onOperationResult, onOperationSender, onAccessRefreshSender }: { character: Character; transactions: Transaction[]; onSave: (transaction: Transaction) => Promise<void>; allowHost: boolean; showWorkspace?: boolean; onPlayerConnected?: (player: { characterId: string; name: string }) => void; storyAccessFor?: (characterId: string) => PlayerStoryAccess | null; onAccessReceived?: (access: PlayerStoryAccess) => void; onInstitutionOperation?: (operation: InstitutionOperation) => Promise<InstitutionOperationResult>; onOperationResult?: (result: InstitutionOperationResult) => void; onOperationSender?: (sender: ((operation: InstitutionOperation) => boolean) | null) => void; onAccessRefreshSender?: (sender: (() => boolean) | null) => void }) {
  const [mode, setMode] = useState<'closed' | 'host' | 'join'>('closed')
  const [signal, setSignal] = useState('')
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [channel, setChannel] = useState<RTCDataChannel | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [charges, setCharges] = useState<ChargeRequest[]>([])
  const [chargeEvents, setChargeEvents] = useState<string[]>([])
  const [session, setSession] = useState<MasterSession | null>(null)
  const connections = useRef<RTCPeerConnection[]>([])
  const transactionsRef = useRef(transactions)
  const sessionRef = useRef<MasterSession | null>(null)
  const storyAccessRef = useRef(storyAccessFor)
  const operationHandlerRef = useRef(onInstitutionOperation)
  const operationResultRef = useRef(onOperationResult)
  const accessReceivedRef = useRef(onAccessReceived)
  useEffect(() => { transactionsRef.current = transactions }, [transactions])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { storyAccessRef.current = storyAccessFor }, [storyAccessFor])
  useEffect(() => { operationHandlerRef.current = onInstitutionOperation }, [onInstitutionOperation])
  useEffect(() => { operationResultRef.current = onOperationResult }, [onOperationResult])
  useEffect(() => { accessReceivedRef.current = onAccessReceived }, [onAccessReceived])
  useEffect(() => { if (!storyAccessFor) return; players.forEach((player) => { const access = storyAccessFor(player.characterId); if (access && player.channel.readyState === 'open') player.channel.send(JSON.stringify({ type: 'access-snapshot', access } satisfies AccessMessage)) }) }, [players, storyAccessFor])
  useEffect(() => { if (!onOperationSender) return; if (!channel) { onOperationSender(null); return }; onOperationSender((operation) => { if (channel.readyState !== 'open') return false; channel.send(JSON.stringify(operation)); return true }); return () => onOperationSender(null) }, [channel, onOperationSender])
  useEffect(() => { if (!onAccessRefreshSender) return; if (!channel) { onAccessRefreshSender(null); return }; onAccessRefreshSender(() => { if (channel.readyState !== 'open') return false; channel.send(JSON.stringify({ type: 'access-refresh-request', characterId: character.id } satisfies AccessRefreshRequest)); return true }); return () => onAccessRefreshSender(null) }, [channel, character.id, onAccessRefreshSender])
  useEffect(() => () => connections.current.forEach((connection) => connection.close()), [])
  useEffect(() => { db.getMasterSessions().then((sessions) => setSession(sessions[0] ?? null)) }, [])

  async function saveSession(next: MasterSession) { next.updatedAt = new Date().toISOString(); await db.saveMasterSession(next); sessionRef.current = next; setSession({ ...next }) }
  function makeSession(): MasterSession { const now = new Date().toISOString(); const name = window.prompt('Nome da História:', 'Nova História')?.trim() || 'Nova História'; return { id: uid(), name, isOpen: true, institutions: [], members: [], sharedCharacters: [], loans: [], requests: [], createdAt: now, updatedAt: now } }

  function attachHostChannel(dataChannel: RTCDataChannel) {
    let joinedCharacterId = ''
    dataChannel.onopen = () => setStatus('Sessão do Mestre aberta: um jogador está conectado.')
    dataChannel.onclose = () => setStatus('Um jogador saiu da sessão.')
    dataChannel.onmessage = async (event) => {
      const message = JSON.parse(event.data) as TransferRequest | JoinMessage | ChargeResponse | InstitutionOperation | AccessRefreshRequest
      if (message.type === 'join') { joinedCharacterId = message.characterId; setPlayers((current) => current.some((player) => player.channel === dataChannel) ? current : [...current, { characterId: message.characterId, name: message.playerName, channel: dataChannel }]); onPlayerConnected?.({ characterId: message.characterId, name: message.playerName }); const access = storyAccessRef.current?.(message.characterId); if (access) dataChannel.send(JSON.stringify({ type: 'access-snapshot', access } satisfies AccessMessage)); const active = sessionRef.current; if (active) { const members = active.members.some((item) => item.characterId === message.characterId) ? active.members : [...active.members, { characterId: message.characterId, name: message.playerName, permissions: {}, withdrawLimits: {}, sharedCharacterIds: [], connectedAt: new Date().toISOString() }]; void saveSession({ ...active, members }) } }
      if (message.type === 'institution-operation') { const handler = operationHandlerRef.current; const result = !joinedCharacterId || joinedCharacterId !== message.characterId || !handler ? { type: 'institution-operation-result' as const, operation: message, ok: false, message: 'Jogador ou instituição não reconhecido.' } : await handler(message); if (dataChannel.readyState === 'open') dataChannel.send(JSON.stringify(result)); return }
      if (message.type === 'access-refresh-request') { const access = joinedCharacterId === message.characterId ? storyAccessRef.current?.(message.characterId) : null; if (access && dataChannel.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'access-snapshot', access } satisfies AccessMessage)); return }
      if (message.type === 'transfer-request') setPending((current) => current.some((request) => request.id === message.id) ? current : [...current, { ...message, channel: dataChannel }])
      if (message.type === 'charge-response') setChargeEvents((current) => [`${message.playerName}: cobrança ${message.accepted ? 'aceita' : 'recusada'}.`, ...current])
    }
  }

  async function openTavern() {
    if (!sessionRef.current) await saveSession(makeSession())
    const connection = new RTCPeerConnection()
    connections.current.push(connection)
    const dataChannel = connection.createDataChannel('tavern')
    attachHostChannel(dataChannel)
    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)
    await waitForIce(connection)
    setSignal(encode({ version: 1, kind: 'offer', description: connection.localDescription! }))
    setMode('host'); setStatus('Mostre este QR ao jogador. Depois leia o QR-resposta dele.')
  }

  async function acceptAnswer(code: string) {
    try {
      const answer = decode(code)
      if (answer.version !== 1 || answer.kind !== 'answer') throw new Error()
      const connection = connections.current.at(-1)
      if (!connection) throw new Error()
      await connection.setRemoteDescription(answer.description)
      setSignal(''); setStatus('Conectando… aguarde a confirmação.')
    } catch { setStatus('Esse não é um QR-resposta válido da sessão.') }
  }

  async function joinTavern(code: string) {
    try {
      const offer = decode(code)
      if (offer.version !== 1 || offer.kind !== 'offer') throw new Error()
      const connection = new RTCPeerConnection()
      connections.current.push(connection)
      connection.ondatachannel = (event) => {
        setChannel(event.channel)
        event.channel.onopen = () => { event.channel.send(JSON.stringify({ type: 'join', characterId: character.id, playerName: character.name } satisfies JoinMessage)); setSignal(''); setStatus('Conectado à sessão do Mestre. Você já pode enviar um pedido.') }
        event.channel.onclose = () => { setChannel(null); setStatus('A conexão com a sessão foi encerrada.') }
        event.channel.onmessage = async (messageEvent) => {
          const message = JSON.parse(messageEvent.data) as TransferApproved | ChargeRequest | AccessMessage | InstitutionOperationResult
          if (message.type === 'access-snapshot') { accessReceivedRef.current?.(message.access); setStatus(`Permissões de ${message.access.storyName} atualizadas.`); return }
          if (message.type === 'institution-operation-result') { if (message.access) accessReceivedRef.current?.(message.access); operationResultRef.current?.(message); setStatus(message.message); return }
          if (message.type === 'charge-request') { setCharges((current) => current.some((item) => item.id === message.id) ? current : [...current, message]); setStatus(`Nova cobrança de ${message.institution}.`); return }
          if (message.type !== 'transfer-approved' || transactionsRef.current.some((item) => item.referenceId === message.id)) return
          const totalPence = toPence(message.money)
          await onSave({ id: uid(), characterId: character.id, type: 'expense', description: `${message.description || 'Transferência'} → ${message.tavernName}`, date: new Date().toISOString().slice(0, 10), ...message.money, totalPence, referenceId: message.id, createdAt: new Date().toISOString() })
          setStatus('Transferência aprovada e registrada na sua carteira.')
        }
      }
      await connection.setRemoteDescription(offer.description)
      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)
      await waitForIce(connection)
      setSignal(encode({ version: 1, kind: 'answer', description: connection.localDescription! }))
      setMode('join'); setStatus('Mostre este QR-resposta ao host para concluir a entrada.')
    } catch { setStatus('Esse não é um QR de entrada válido.') }
  }

  async function approve(request: Pending) {
    if (transactionsRef.current.some((item) => item.referenceId === request.id)) return
    const totalPence = toPence(request.money)
    await onSave({ id: uid(), characterId: character.id, type: 'income', description: `${request.description || 'Transferência'} ← ${request.playerName}`, date: new Date().toISOString().slice(0, 10), ...request.money, totalPence, referenceId: request.id, createdAt: new Date().toISOString() })
    request.channel.send(JSON.stringify({ type: 'transfer-approved', id: request.id, tavernName: character.name, description: request.description, money: request.money } satisfies TransferApproved))
    setPending((current) => current.filter((item) => item.id !== request.id))
  }

  async function respondToCharge(request: ChargeRequest, accepted: boolean) {
    if (!channel) return
    if (accepted && !transactionsRef.current.some((item) => item.referenceId === request.id)) {
      const totalPence = toPence(request.money)
      await onSave({ id: uid(), characterId: character.id, type: 'expense', description: `${request.description} → ${request.institution}`, date: new Date().toISOString().slice(0, 10), ...request.money, totalPence, referenceId: request.id, createdAt: new Date().toISOString() })
    }
    channel.send(JSON.stringify({ type: 'charge-response', id: request.id, accepted, playerName: character.name } satisfies ChargeResponse))
    setCharges((current) => current.filter((item) => item.id !== request.id))
    setStatus(accepted ? 'Cobrança aceita e registrada na sua carteira.' : 'Cobrança recusada; nenhum valor foi descontado.')
  }

  return <section className="tavern-panel"><div className="form-title"><div><p className="eyebrow">{allowHost ? 'Conexão local' : 'Minha História'}</p><h2>{allowHost ? 'Conectar jogadores' : 'Entrar por QR'}</h2></div>{mode !== 'closed' && <button type="button" onClick={() => { connections.current.forEach((item) => item.close()); connections.current = []; setMode('closed'); setSignal(''); setChannel(null); setPending([]); setPlayers([]); setCharges([]); setStatus('Sala encerrada.') }}>Encerrar sessão</button>}</div>{mode === 'closed' && <div className="tavern-actions">{allowHost && <button type="button" onClick={openTavern}>Abrir conexão</button>}<SignalInput title="Ler QR do Mestre" action="Ler QR de entrada" onCode={joinTavern} /></div>}{mode === 'host' && <>{showWorkspace && <MasterWorkspace session={session} onSave={saveSession} />}<button className="new-invite" type="button" onClick={openTavern}>Gerar QR para jogador</button>{signal && <SignalCard code={signal} title="QR de entrada da História" />}<SignalInput title="QR-resposta do jogador" action="Ler QR-resposta" onCode={acceptAnswer} />{players.length > 0 && <div className="connected-list"><strong>Jogadores online</strong>{players.map((player) => <div key={player.name}><span className="online-dot">●</span>{player.name}</div>)}</div>}{pending.length > 0 && <div className="pending"><h3>Pedidos para aprovar</h3>{pending.map((request) => <div key={request.id}><span><strong>{request.playerName}</strong> quer transferir {request.money.crowns} C · {request.money.shillings} S · {request.money.pence} P</span><button type="button" onClick={() => approve(request)}>Aprovar</button></div>)}</div>}</>}{mode === 'join' && <>{signal && <SignalCard code={signal} title="Mostre este QR-resposta ao mestre" />}{channel?.readyState === 'open' && <TransferForm playerName={character.name} channel={channel} />}{charges.map((request) => <div className="pending" key={request.id}><h3>Cobrança pendente: {request.institution}</h3><p>{request.description} · vence em {new Date(`${request.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}</p><strong>{request.money.crowns} C · {request.money.shillings} S · {request.money.pence} P</strong><div><button type="button" onClick={() => respondToCharge(request, true)}>Aceitar e pagar</button><button className="danger" type="button" onClick={() => respondToCharge(request, false)}>Recusar</button></div></div>)}</>}{status && <p className="network-status">{status}</p>}<p className="network-note">Depois de conectar, gerencie personagens e permissões na aba Jogadores.</p></section>
}

function SignalCard({ code, title }: { code: string; title: string }) {
  const [image, setImage] = useState('')
  useEffect(() => { QRCode.toDataURL(code, { width: 260, margin: 1, errorCorrectionLevel: 'M' }).then(setImage) }, [code])
  return <div className="signal-card"><strong>{title}</strong>{image && <img src={image} alt={title} />}<details><summary>Usar código em texto</summary><textarea value={code} readOnly /><button type="button" onClick={() => navigator.clipboard.writeText(code)}>Copiar código</button></details></div>
}

function SignalInput({ title, action, onCode }: { title: string; action: string; onCode: (code: string) => void }) {
  const [code, setCode] = useState('')
  const [scan, setScan] = useState(false)
  const scanId = useRef(`scanner-${uid()}`)
  useEffect(() => {
    if (!scan) return
    const scanner = new Html5QrcodeScanner(scanId.current, { fps: 10, qrbox: { width: 230, height: 230 } }, false)
    scanner.render((result) => { scanner.clear().catch(() => undefined); setScan(false); setCode(result); onCode(result) }, () => undefined)
    return () => { scanner.clear().catch(() => undefined) }
  }, [scan, onCode])
  return <div className="signal-input"><strong>{title}</strong><button type="button" onClick={() => setScan(true)}>{action}</button>{scan && <div id={scanId.current} /> }<details><summary>Colar código em texto</summary><textarea value={code} onChange={(event) => setCode(event.target.value)} placeholder="Cole o código aqui" /><button type="button" onClick={() => onCode(code)}>Confirmar código</button></details></div>
}

function TransferForm({ playerName, channel }: { playerName: string; channel: RTCDataChannel }) {
  const [money, setMoney] = useState<CurrencyInput>(emptyMoney)
  const [description, setDescription] = useState('Depósito na Taverna')
  const [sent, setSent] = useState(false)
  function update(field: keyof CurrencyInput, value: string) { setMoney((current) => ({ ...current, [field]: Math.max(0, Math.floor(Number(value) || 0)) })) }
  function send() { if (!toPence(money) || channel.readyState !== 'open') return; channel.send(JSON.stringify({ type: 'transfer-request', id: uid(), playerName, description: description.trim(), money } satisfies TransferRequest)); setSent(true); setMoney(emptyMoney) }
  return <div className="transfer-box"><strong>Solicitar depósito</strong><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrição" /><div className="currency-fields">{([['crowns', 'Coroas'], ['shillings', 'Shillings'], ['pence', 'Pences']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" min="0" value={money[field] || ''} onChange={(event) => update(field, event.target.value)} placeholder="0" /></label>)}</div><button type="button" onClick={send}>Enviar pedido ao host</button>{sent && <small>Pedido enviado. Aguarde a aprovação do host.</small>}</div>
}

function ChargeForm({ player }: { player: Player }) {
  const [institution, setInstitution] = useState('Banco')
  const [description, setDescription] = useState('Parcela de empréstimo')
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
  const [money, setMoney] = useState<CurrencyInput>(emptyMoney)
  function update(field: keyof CurrencyInput, value: string) { setMoney((current) => ({ ...current, [field]: Math.max(0, Math.floor(Number(value) || 0)) })) }
  function send() { if (!toPence(money) || player.channel.readyState !== 'open') return; player.channel.send(JSON.stringify({ type: 'charge-request', id: uid(), institution: institution.trim() || 'Instituição', description: description.trim() || 'Cobrança', dueDate, money } satisfies ChargeRequest)); setMoney(emptyMoney) }
  return <div className="transfer-box"><strong>Nova cobrança para {player.name}</strong><input value={institution} onChange={(event) => setInstitution(event.target.value)} placeholder="Instituição" /><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrição" /><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /><div className="currency-fields">{([['crowns', 'Coroas'], ['shillings', 'Shillings'], ['pence', 'Pences']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" min="0" value={money[field] || ''} onChange={(event) => update(field, event.target.value)} placeholder="0" /></label>)}</div><button type="button" onClick={send}>Enviar solicitação de cobrança</button></div>
}

function MasterWorkspace({ session, onSave }: { session: MasterSession | null; onSave: (session: MasterSession) => Promise<void> }) {
  const [institutionName, setInstitutionName] = useState('')
  const [institutionKind, setInstitutionKind] = useState('Taverna')
  const [characterName, setCharacterName] = useState('')
  if (!session) return <p className="muted">Preparando a sessão do mestre…</p>
  const activeSession = session
  async function addInstitution() {
    if (!institutionName.trim()) return
    const institution: Institution = { id: uid(), name: institutionName.trim(), kind: institutionKind.trim() || 'Instituição', createdAt: new Date().toISOString() }
    await onSave({ ...activeSession, institutions: [...activeSession.institutions, institution] }); setInstitutionName('')
  }
  async function addSharedCharacter() {
    if (!characterName.trim()) return
    await onSave({ ...activeSession, sharedCharacters: [...activeSession.sharedCharacters, { id: uid(), name: characterName.trim(), institutionIds: [], createdAt: new Date().toISOString() }] }); setCharacterName('')
  }
  async function togglePermission(member: SessionMember, institutionId: string, permission: InstitutionPermission) {
    const current = member.permissions[institutionId] ?? []
    const next = current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]
    const members = activeSession.members.map((item) => item.characterId === member.characterId ? { ...item, permissions: { ...item.permissions, [institutionId]: next } } : item)
    await onSave({ ...activeSession, members })
  }
  return <div className="master-workspace"><div className="transfer-box"><strong>Criar instituição</strong><input value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} placeholder="Nome: Estalagem Lua Cinzenta" /><input value={institutionKind} onChange={(event) => setInstitutionKind(event.target.value)} placeholder="Tipo: Taverna, Banco…" /><button type="button" onClick={addInstitution}>Adicionar instituição</button></div><div className="transfer-box"><strong>Criar personagem compartilhado</strong><input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="Nome do personagem" /><button type="button" onClick={addSharedCharacter}>Adicionar personagem</button></div><div className="pending"><h3>Instituições</h3>{session.institutions.length ? session.institutions.map((item) => <div key={item.id}><strong>{item.name}</strong> <span>{item.kind}</span></div>) : <p className="muted">Nenhuma instituição criada.</p>}</div><div className="pending"><h3>Personagens compartilhados</h3>{session.sharedCharacters.length ? session.sharedCharacters.map((item) => <div key={item.id}>{item.name}</div>) : <p className="muted">Nenhum personagem compartilhado.</p>}</div><div className="pending"><h3>Jogadores vinculados</h3>{session.members.length ? session.members.map((member) => <div className="member-permissions" key={member.characterId}><strong>{member.name}</strong>{session.institutions.map((institution) => <fieldset key={institution.id}><legend>{institution.name}</legend>{(['view', 'deposit', 'withdraw', 'loan'] as InstitutionPermission[]).map((permission) => <label key={permission}><input type="checkbox" checked={(member.permissions[institution.id] ?? []).includes(permission)} onChange={() => togglePermission(member, institution.id, permission)} /> {permission === 'view' ? 'Ver' : permission === 'deposit' ? 'Depositar' : permission === 'withdraw' ? 'Retirar' : 'Empréstimo'}</label>)}</fieldset>)}</div>) : <p className="muted">Conecte um jogador para vinculá-lo.</p>}</div></div>
}
