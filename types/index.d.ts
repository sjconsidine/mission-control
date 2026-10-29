export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type Step = { content: string; status: StepStatus }

export type HelperTasks = { done: number; total: number; current: string }

export type Helper = {
  id: string
  description: string
  type: string
  model: string
  // The effort the helper's requests asked for: low, medium, high, xhigh, max.
  effort: string
  isDone: boolean
  startedAt: number
  endedAt: number | null
  tokensIn: number
  tokensOut: number
  costUsd: number
  // Tokens the helper's latest request carried: how full its context is.
  ctxTokens: number
  steps: number
  tool: string
  tasks: HelperTasks
  // Task ids the helper created, in order, with their subjects.
  taskNames: Record<string, string>
}

export type ChatStatus = 'running' | 'waiting' | 'finished' | 'idle'

export type Live = {
  status: ChatStatus
  title: string
  note: string
  tool: string
  toolSince: number
  turnStartedAt: number
  // When the status last changed (absent in values saved before 0.7.2).
  statusSince?: number
  // The chat's own work since your last message: model, effort, tokens, cost.
  model: string
  effort: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  ctxTokens: number
  steps: number
}

export type Card = {
  id: string
  title: string
  folder: string
  status: ChatStatus | 'closed'
  step: string
  done: number
  total: number
  note: string
  tool: string
  toolSince: number
  helpersRunning: number
  updatedAt: number
  statusSince?: number
}

// A chat's name as the app's sidebar shows it, keyed by the chat's id.
export type SidebarTitle = { title: string; isArchived: boolean; localId?: string }

// A chat you cleared from All chats, and how it looked then: it comes back once it changes.
export type Cleared = { at: number; status: string; note: string }

// A command left running in the background after a reply (an encode, a render).
export type Job = { id: string; label: string; startedAt: number }

// One mod on the roadmap list (~/claude-mods/roadmap.json), with what is installed.
export type ModEntry = {
  name: string
  title: string
  what: string
  status: 'built' | 'next' | 'planned' | 'on hold'
  version: string
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      plan: Shaped<Step[]>
      helpers: Shaped<Helper[]>
      live: Shaped<Live>
      board: Shaped<Card[]>
      now: number
      titles: Shaped<Record<string, SidebarTitle>>
      isBandHidden: boolean
      isFinishedOpen: boolean
      mods: Shaped<ModEntry[]>
      jobs: Shaped<Job[]>
      cleared: Shaped<Record<string, Cleared>>
    }
  }
}
