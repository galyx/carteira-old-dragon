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
  referenceId?: string
  /** Alteração real das moedas físicas quando houve troca/troco no pagamento. */
  balanceDelta?: CurrencyInput
  createdAt: string
}

export type Backup = {
  version: 1
  exportedAt: string
  characters: Character[]
  transactions: Transaction[]
}

export type InstitutionPermission = 'view' | 'deposit' | 'withdraw' | 'depositDirect' | 'withdrawDirect' | 'loan'

export type Institution = {
  id: string
  name: string
  kind: string
  createdAt: string
}

export type SessionMember = {
  characterId: string
  name: string
  permissions: Record<string, InstitutionPermission[]>
  withdrawLimits: Record<string, number>
  sharedCharacterIds?: string[]
  connectedAt?: string
}

export type SharedCharacter = { id: string; name: string; institutionIds: string[]; createdAt: string }

export type Loan = {
  id: string
  characterId: string
  institutionId: string
  principalPence: number
  interestPercent: number
  installments: number
  installmentPence: number
  remainingPence: number
  dueDate: string
  status: 'pending' | 'active' | 'declined' | 'paid'
}

export type MasterRequest = {
  id: string
  characterId: string
  institutionId: string
  type: 'deposit' | 'withdraw' | 'loan' | 'charge'
  money: CurrencyInput
  description: string
  dueDate?: string
  status: 'pending-master' | 'pending-player' | 'accepted' | 'declined'
  createdAt: string
}

export type MasterSession = {
  id: string
  name: string
  isOpen: boolean
  institutions: Institution[]
  members: SessionMember[]
  sharedCharacters: SharedCharacter[]
  loans: Loan[]
  requests: MasterRequest[]
  createdAt: string
  updatedAt: string
}

export type LedgerEntry = CurrencyInput & {
  id: string
  type: 'income' | 'expense'
  description: string
  date: string
  totalPence: number
  referenceId?: string
  balanceDelta?: CurrencyInput
  createdAt: string
}

export type StoryInstitution = Institution & { ledger: LedgerEntry[] }
export type StoryCharacter = SharedCharacter & { ledger: LedgerEntry[] }

export type Story = {
  id: string
  name: string
  description: string
  archived: boolean
  institutions: StoryInstitution[]
  characters: StoryCharacter[]
  members: SessionMember[]
  loans: Loan[]
  requests: MasterRequest[]
  createdAt: string
  updatedAt: string
}

export type PlayerInstitutionAccess = {
  id: string
  name: string
  kind: string
  balancePence: number
  /** Quantidade real de cada moeda, sem conversão automática. */
  balance?: CurrencyInput
  ledger: LedgerEntry[]
  permissions: InstitutionPermission[]
  withdrawLimitPence?: number
}

export type PlayerStoryAccess = {
  id: string
  storyId: string
  storyName: string
  characterId: string
  institutions: PlayerInstitutionAccess[]
  sharedCharacters: SharedCharacter[]
  requests?: MasterRequest[]
  loans?: Loan[]
  updatedAt: string
}
