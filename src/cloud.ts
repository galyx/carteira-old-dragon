import type { CurrencyInput, PlayerStoryAccess, Story, Transaction } from './types'
import { supabase, supabaseConfigured } from './supabase'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 9
const CODE_TTL_MS = 12 * 60 * 60 * 1000

export type InstitutionOperation = {
  type: 'institution-operation'
  id: string
  characterId: string
  institutionId: string
  institutionName: string
  action: 'deposit' | 'withdraw' | 'loan' | 'loanAccept' | 'loanDecline' | 'convert'
  description: string
  money: CurrencyInput
  requestId?: string
}

export type InstitutionOperationResult = {
  type: 'institution-operation-result'
  operation: InstitutionOperation
  ok: boolean
  message: string
  access?: PlayerStoryAccess
  /** Para conversões: só aplica na carteira quando true (aprovação do mestre). */
  applyWallet?: boolean
}

export type CloudMember = {
  id: string
  mesa_id: string
  character_id: string
  character_name: string
  transactions: Transaction[]
  joined_at: string
}

function assertConfigured() {
  if (!supabaseConfigured) throw new Error('Supabase não configurado. Verifique o arquivo .env.')
}

export function generateInviteCode(length = CODE_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

export function codeExpiresAt(from = new Date()): string {
  return new Date(from.getTime() + CODE_TTL_MS).toISOString()
}

export async function ensureCloudMesa(story: Story, masterKey: string): Promise<string> {
  assertConfigured()
  if (story.cloudMesaId) {
    const { error } = await supabase.from('mesas').update({
      name: story.name,
      description: story.description,
      story,
      updated_at: new Date().toISOString(),
    }).eq('id', story.cloudMesaId).eq('master_key', masterKey)
    if (error) throw error
    return story.cloudMesaId
  }

  const { data, error } = await supabase.from('mesas').insert({
    name: story.name,
    description: story.description,
    master_key: masterKey,
    story,
  }).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function pushStory(mesaId: string, masterKey: string, story: Story): Promise<void> {
  assertConfigured()
  const { error } = await supabase.from('mesas').update({
    name: story.name,
    description: story.description,
    story,
    updated_at: new Date().toISOString(),
  }).eq('id', mesaId).eq('master_key', masterKey)
  if (error) throw error
}

export async function fetchStory(mesaId: string): Promise<Story | null> {
  assertConfigured()
  const { data, error } = await supabase.from('mesas').select('story').eq('id', mesaId).maybeSingle()
  if (error) throw error
  return (data?.story as Story | undefined) ?? null
}

export async function createInviteCode(mesaId: string): Promise<{ code: string; expiresAt: string }> {
  assertConfigured()
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateInviteCode()
    const expiresAt = codeExpiresAt()
    const { error } = await supabase.from('mesa_codigos').insert({ code, mesa_id: mesaId, expires_at: expiresAt })
    if (!error) return { code, expiresAt }
    if (error.code !== '23505') throw error
  }
  throw new Error('Não foi possível gerar um código único. Tente de novo.')
}

export async function getLatestInviteCode(mesaId: string): Promise<{ code: string; expiresAt: string } | null> {
  assertConfigured()
  const { data, error } = await supabase
    .from('mesa_codigos')
    .select('code, expires_at')
    .eq('mesa_id', mesaId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { code: data.code as string, expiresAt: data.expires_at as string }
}

export async function joinMesaWithCode(code: string, character: { id: string; name: string }): Promise<{ mesaId: string; story: Story }> {
  assertConfigured()
  const normalized = code.trim().toUpperCase()
  const { data: invite, error: inviteError } = await supabase
    .from('mesa_codigos')
    .select('code, mesa_id, expires_at')
    .eq('code', normalized)
    .maybeSingle()
  if (inviteError) throw inviteError
  if (!invite) throw new Error('Código não encontrado.')
  if (new Date(invite.expires_at as string).getTime() < Date.now()) {
    throw new Error('Este código expirou. Peça um novo código ao mestre.')
  }

  const mesaId = invite.mesa_id as string
  const { data: mesa, error: mesaError } = await supabase.from('mesas').select('story').eq('id', mesaId).single()
  if (mesaError) throw mesaError
  const story = mesa.story as Story

  const { data: existing } = await supabase
    .from('mesa_membros')
    .select('id')
    .eq('mesa_id', mesaId)
    .eq('character_id', character.id)
    .maybeSingle()

  if (!existing) {
    const { error: memberError } = await supabase.from('mesa_membros').insert({
      mesa_id: mesaId,
      character_id: character.id,
      character_name: character.name,
      transactions: [],
    })
    if (memberError) throw memberError
  }

  return { mesaId, story: { ...story, cloudMesaId: mesaId } }
}

export async function pushMemberWallet(mesaId: string, characterId: string, characterName: string, transactions: Transaction[]): Promise<void> {
  assertConfigured()
  const { error } = await supabase.from('mesa_membros').update({
    character_name: characterName,
    transactions,
  }).eq('mesa_id', mesaId).eq('character_id', characterId)
  if (error) throw error
}

export async function listMembers(mesaId: string): Promise<CloudMember[]> {
  assertConfigured()
  const { data, error } = await supabase
    .from('mesa_membros')
    .select('*')
    .eq('mesa_id', mesaId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id as string,
    mesa_id: row.mesa_id as string,
    character_id: row.character_id as string,
    character_name: row.character_name as string,
    transactions: (row.transactions as Transaction[]) ?? [],
    joined_at: row.joined_at as string,
  }))
}

export async function removeMember(mesaId: string, characterId: string): Promise<void> {
  assertConfigured()
  const { error } = await supabase.from('mesa_membros').delete().eq('mesa_id', mesaId).eq('character_id', characterId)
  if (error) throw error
}

export async function postMessage(mesaId: string, kind: string, payload: unknown, targetCharacterId?: string): Promise<void> {
  assertConfigured()
  const { error } = await supabase.from('mesa_mensagens').insert({
    mesa_id: mesaId,
    kind,
    payload,
    target_character_id: targetCharacterId ?? null,
  })
  if (error) throw error
}

export async function fetchPendingMessages(mesaId: string, kinds: string[], targetCharacterId?: string | null) {
  assertConfigured()
  let query = supabase
    .from('mesa_mensagens')
    .select('*')
    .eq('mesa_id', mesaId)
    .eq('consumed', false)
    .in('kind', kinds)
    .order('created_at', { ascending: true })
  if (targetCharacterId) query = query.eq('target_character_id', targetCharacterId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function markMessagesConsumed(ids: string[]): Promise<void> {
  if (!ids.length) return
  assertConfigured()
  const { error } = await supabase.from('mesa_mensagens').update({ consumed: true }).in('id', ids)
  if (error) throw error
}

export function subscribeMesa(mesaId: string, onChange: () => void) {
  assertConfigured()
  return supabase
    .channel(`mesa-${mesaId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mesas', filter: `id=eq.${mesaId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mesa_membros', filter: `mesa_id=eq.${mesaId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mesa_mensagens', filter: `mesa_id=eq.${mesaId}` }, onChange)
    .subscribe()
}
