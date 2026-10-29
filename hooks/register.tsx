import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, ChatStatus, Cleared, Helper, HelperTasks, Job, Live, ModEntry, SidebarTitle, Step, StepStatus } from '../types'

// Change a tag when that value's fields change: a reload then starts it fresh
// instead of reading what the earlier version stored.
const plan = atom({ plugin: 'mission-control', key: 'plan' } as const, [], {
  shape: 'plan-1',
})
const helpers = atom({ plugin: 'mission-control', key: 'helpers' } as const, [], {
  shape: 'helpers-2',
})
const isBandHidden = atom({ plugin: 'mission-control', key: 'isBandHidden' } as const, false)
const isFinishedOpen = atom({ plugin: 'mission-control', key: 'isFinishedOpen' } as const, true)
const IDLE: Live = {
  status: 'idle',
  title: '',
  note: '',
  tool: '',
  toolSince: 0,
  turnStartedAt: 0,
  model: '',
  effort: '',
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  ctxTokens: 0,
  steps: 0,
}
const live = atom({ plugin: 'mission-control', key: 'live' } as const, IDLE, {
  shape: 'live-2',
})
const board = atom({ plugin: 'mission-control', key: 'board' } as const, [], {
  shape: 'board-1',
})
const now = atom({ plugin: 'mission-control', key: 'now' } as const, 0)
const titles = atom({ plugin: 'mission-control', key: 'titles' } as const, {} as Record<string, SidebarTitle>, {
  shape: 'titles-1',
})

// The desktop app keeps one file per chat with its sidebar title. Read the
// ones touched in the last week and print { chat id: { title, isArchived } }.
const TITLES_SCRIPT = `
import glob, json, os, sys, time
out = {}
cutoff = time.time() - 8 * 86400
for path in glob.glob(os.path.join(sys.argv[1], '*', '*', 'local_*.json')):
    try:
        if os.path.getmtime(path) < cutoff:
            continue
        with open(path) as f:
            d = json.load(f)
        cid = d.get('cliSessionId')
        if cid and d.get('title'):
            out[cid] = {'title': d['title'], 'isArchived': bool(d.get('isArchived')), 'localId': d.get('sessionId') or ''}
    except Exception:
        pass
print(json.dumps(out))
`

const mods = atom({ plugin: 'mission-control', key: 'mods' } as const, [] as ModEntry[], {
  shape: 'mods-1',
})

const cleared = atom({ plugin: 'mission-control', key: 'cleared' } as const, {} as Record<string, Cleared>, {
  shape: 'cleared-1',
})

const jobs = atom({ plugin: 'mission-control', key: 'jobs' } as const, [] as Job[], {
  shape: 'jobs-1',
})
// A background job this old has surely ended without us hearing.
const JOB_FORGET_AFTER = 4 * 60 * 60_000

const HELPERS_PANE = 'mc-helpers'
const MODS_PANE = 'mc-mods'
const CHATS_PANE = 'mc-chats'
const MINUTE = 60_000
// A running chat that has not written for this long has probably closed or crashed.
const SILENT_AFTER = 3 * MINUTE
// Finished chats drop off the board after a day; files go unread after a week.
const HIDE_AFTER = 24 * 60 * MINUTE
const IGNORE_AFTER = 7 * 24 * 60 * MINUTE

// The look: change these to restyle the band and the Helpers pane.
const ACCENT = '#8B7CF6'
const ACCENT_SOFT = '#C4B5FD'
const TRACK = '#ECEAF8'
const CRAB = '#D97757'

// How hard a helper thinks, by the effort its requests ask for: a name, a
// colour, and the hat its crab wears.
type Style = { label: string; color: string; hat: string; brim: string }
const STYLES: Record<string, Style> = {
  low: { label: 'light', color: '#16A34A', hat: '#22C55E', brim: '#15803D' },
  medium: { label: 'medium', color: '#2563EB', hat: '#D4D4D8', brim: '#3B82F6' },
  high: { label: 'careful', color: '#D97706', hat: '#FACC15', brim: '#CA8A04' },
  xhigh: { label: 'heavy', color: '#DC2626', hat: '#7C4A2D', brim: '#5B3420' },
  max: { label: 'heavy', color: '#DC2626', hat: '#7C4A2D', brim: '#5B3420' },
}
// A crab whose effort is not known yet wears the purple beanie.
const PLAIN: Style = { label: 'helper', color: ACCENT, hat: '#A78BFA', brim: '#7C3AED' }
const PLANNED: Style = { label: 'planned', color: '#A1A1AA', hat: '#A1A1AA', brim: '#71717A' }
const styleOf = (effort: string) => STYLES[effort] ?? PLAIN

// A crab's hat by the job it does, read from its task: a 12 x 4 pixel grid
// drawn above the body, each letter one colour of the hat's own palette.
// `face` (optional, 12 x 6) is drawn over the body: a monocle, say.
type Hat = { role: string; emoji: string; rows: string[]; colors: Record<string, string>; face?: string[] }
const HATS: Record<string, Hat> = {
  clone: {
    role: 'AI clone',
    emoji: '🎀',
    rows: ['............', '........p.p.', '.........P..', '..ppppppppp.'],
    colors: { p: '#F472B6', P: '#DB2777' },
  },
  shorts: {
    role: 'Shorts',
    emoji: '🧢',
    rows: ['............', '.....rr.....', '....rrrr....', '....bbbbbb..'],
    colors: { r: '#EF4444', b: '#B91C1C' },
  },
  review: {
    role: 'Reviewer',
    emoji: '🧐',
    rows: ['...wwwwww...', '..wwwwwwww..', '..llllllll..', '.wwwwwwwwww.'],
    colors: { w: '#F4F4F5', l: '#3B82F6' },
  },
  design: {
    role: 'Designer',
    emoji: '🎨',
    rows: ['.....s......', '...pppppp...', '.pppppppppp.', '..pppppppp..'],
    colors: { p: '#C084FC', s: '#7E22CE' },
  },
  video: {
    role: 'Video editor',
    emoji: '🎬',
    rows: ['...kkkkkk...', '..k......k..', '.k........k.', 'mm........mm'],
    colors: { k: '#A1A1AA', m: '#EF4444' },
  },
  research: {
    role: 'Researcher',
    emoji: '🕵️',
    rows: ['....aaaa....', '...aaaaaa...', '..aaddddaa..', '.a.aaaaaa.a.'],
    colors: { a: '#C8A26B', d: '#8B5E34', m: '#FDE047' },
    // A gold monocle round the right eye, its chain hanging down.
    face: ['........m...', '.......m.m..', '........m...', '.........m..', '..........m.', '............'],
  },
  data: {
    role: 'Analyst',
    emoji: '📊',
    rows: ['....gggg....', '...gggggg...', '..ggggggggGG', '............'],
    colors: { g: '#22C55E', G: '#15803D' },
  },
  publish: {
    role: 'Publisher',
    emoji: '📣',
    rows: ['...kkkkkk...', '...kkkkkk...', '...rrrrrr...', '.kkkkkkkkkk.'],
    colors: { k: '#64748B', r: '#DC2626' },
  },
  write: {
    role: 'Writer',
    emoji: '✍️',
    rows: ['.....k......', '..gggggggg..', '.gggggggggg.', '.bbbbbbb....'],
    colors: { g: '#94A3B8', b: '#475569', k: '#334155' },
  },
  build: {
    role: 'Builder',
    emoji: '🛠️',
    rows: ['....yyyy....', '...yyywyy...', '..yyyyyyyy..', '.bbbbbbbbbb.'],
    colors: { y: '#FACC15', w: '#FFFFFF', b: '#CA8A04' },
  },
}
// The first job whose words appear in the task wins.
const ROLE_WORDS: Array<[string, RegExp]> = [
  ['clone', /(clone|avatar|digital twin|lip-?sync|soul ?id|voice ?over|\bvoice\b|tts)/i],
  ['shorts', /\bshorts?\b/i],
  ['review', /\b(review|verif|check|audit|qa\b|proofread|critique|test)/i],
  ['design', /(thumbnail|design|graphic|canva|visual|mock-?up|image|icon|logo|layout)/i],
  ['video', /(video|edit|render|reel|clip|b-?roll|a-?roll|tella|higgsfield|footage|encode|motion)/i],
  ['research', /(research|search|find|explore|look ?up|keyword|vidiq|ahrefs|competitor|investigat|scan)/i],
  ['data', /(report|signups?|views|analytic|data|growth|number|metric|mongo|stats|chart|dashboard)/i],
  ['publish', /(notion|slack|publish|upload|schedule|calendar|email|send|post to)/i],
  ['write', /(script|write|draft|title|description|copy|hook|outline|tags|blog|caption)/i],
  ['build', /(build|code|mod\b|fix|implement|install|deploy|refactor|plugin|debug|setup|set up)/i],
]
// Your own hat settings, kept outside the mod in ~/.claude/mission-control/hats.json:
// { "<job>": { "role": "<label>", "words": ["<word>", ...] } }. Words listed there
// are checked before the built-in ones; a label renames the job.
type HatSetting = { role?: string; words?: string[] }
let hatSettings: Record<string, HatSetting> = {}
export const setHatSettings = (value: Record<string, HatSetting>) => {
  hatSettings = value
}
export const roleName = (role: string) => hatSettings[role]?.role || HATS[role]?.role || ''

export const roleOf = (text: string, type = ''): string => {
  const lower = text.toLowerCase()
  for (const [role, setting] of Object.entries(hatSettings)) {
    if (HATS[role] && setting.words?.some(word => word !== '' && lower.includes(word.toLowerCase()))) return role
  }
  if (/explore/i.test(type)) return 'research'
  return ROLE_WORDS.find(([, words]) => words.test(text))?.[0] ?? ''
}

// The crab's body; a crab with no known job wears its effort's beanie.
const BODY_ROWS = ['..oooooooo..', '..oeooooeo..', 'o.oooooooo.o', 'oooooooooooo', '..oooooooo..', '..o.o..o.o..']
const BEANIE_ROWS = ['.....h......', '...hhhhhh...', '..hhhhhhhh..', '.bbbbbbbbbb.']
const crabSvg = (style: Style, isDim = false, role = '') => {
  const hat = HATS[role]
  const hatRows = hat ? hat.rows : BEANIE_ROWS
  const hatColors: Record<string, string> = hat ? hat.colors : { h: style.hat, b: style.brim }
  const paint = (rows: string[], colors: Record<string, string>, top: number) =>
    rows.flatMap((row, y) =>
      [...row].flatMap((ch, x) => {
        const color = colors[ch]
        return color ? [`<rect x="${x}" y="${y + top}" width="1" height="1" fill="${color}"/>`] : []
      }),
    )
  const cells = [
    ...paint(BODY_ROWS, { o: CRAB, e: '#1F1F1F' }, 4),
    ...paint(hatRows, hatColors, 0),
    ...(hat?.face ? paint(hat.face, hatColors, 4) : []),
  ]

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 10" shape-rendering="crispEdges"${
    isDim ? ' opacity="0.45"' : ''
  }>${cells.join('')}</svg>`
}

const prettyModel = (model: string) => {
  const m = /(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-_.](\d+))?/i.exec(model)
  if (!m) return model
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()

  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)

  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

// The sparkle in the band's bar: braille dots, the same for the same cell.
const SPARKS = ['⠁', '⠂', '⠄', '⡀', '⠈', '⠐', '⠠', '⢀', '⠃', '⠘', '⡄', '⢠', ' ', ' ']
const sparkle = (from: number, length: number, seed: number) =>
  Array.from({ length }, (_, i) => SPARKS[((from + i) * 7 + seed * 3 + ((from + i) % 5) * 11) % SPARKS.length]).join('')

// The band's bar as a picture: a rounded track, purple pixel sparkles up to
// the progress point, and a rounded pill with the label riding on it.
const progressSvg = (fraction: number, label: string, width: number, seed: number) => {
  const height = 22
  const fill = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  const pillWidth = Math.round(label.length * 6.6 + 20)
  const pillX = Math.max(0, Math.min(width - pillWidth, fill - pillWidth / 2))
  const dots: string[] = []
  for (let x = 4; x < width - 4; x += 4) {
    for (let y = 4; y < height - 4; y += 4) {
      const n = (x * 31 + y * 17 + seed * 13) % 23
      if (n > 9) continue
      const isLit = x < fill
      const opacity = isLit ? 0.5 + (n % 5) * 0.12 : 0.12 + (n % 3) * 0.06
      dots.push(`<rect x="${x}" y="${y}" width="2" height="2" fill="${ACCENT}" opacity="${opacity.toFixed(2)}"/>`)
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<defs><clipPath id="t"><rect width="${width}" height="${height}" rx="11"/></clipPath></defs>
<rect width="${width}" height="${height}" rx="11" fill="${TRACK}"/>
<g clip-path="url(#t)"><rect width="${fill}" height="${height}" fill="${ACCENT}" opacity="0.22"/>${dots.join('')}</g>
<rect x="${pillX}" y="1" width="${pillWidth}" height="${height - 2}" rx="10" fill="${ACCENT}"/>
<text x="${pillX + pillWidth / 2}" y="15" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="11.5" font-weight="600" fill="#FFFFFF">${label}</text>
</svg>`
}

const NO_TASKS: HelperTasks = { done: 0, total: 0, current: '' }

// Rough API-equivalent prices, dollars per million tokens: [input, output].
// Cache reads cost a tenth of input, cache writes a quarter more.
const PRICES: Array<[RegExp, number, number]> = [
  [/haiku/i, 1, 5],
  [/sonnet/i, 3, 15],
  [/opus|fable/i, 5, 25],
]

const costOf = (
  model: string,
  u: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  },
) => {
  const [, inPrice, outPrice] = PRICES.find(([re]) => re.test(model)) ?? [/./, 5, 25]
  const input =
    u.input_tokens + u.cache_read_input_tokens * 0.1 + u.cache_creation_input_tokens * 1.25

  return (input * inPrice + u.output_tokens * outPrice) / 1_000_000
}

const short = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

// Switches the app to a chat, through the same link the Dock menu uses.
async function openChat($: EngineInterface, localId: string) {
  if (!/^local_[0-9a-f-]+$/.test(localId)) return
  await $.process.run(['/usr/bin/open', `claude://code/continue?session=${localId}&source=spotlight`]).catch(() => undefined)
}

// How long a chat has been in its state, in words that fit the state.
const when = (card: Card, group: string, at: number) => {
  if (group === 'silent') return `last heard ${ago(at - card.updatedAt)} ago`
  if (card.statusSince === undefined) return `updated ${ago(at - card.updatedAt)} ago`
  const span = ago(at - card.statusSince)
  if (group === 'waiting') return `waiting ${span}`
  if (group === 'running') return `working for ${span}`
  if (group === 'finished') return span === 'under a minute' ? 'finished just now' : `finished ${span} ago`
  return `idle for ${span}`
}

const ago = (ms: number) => {
  const minutes = Math.floor(ms / MINUTE)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)

  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`
}

const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

// A bar is two runs of shaded spaces, so it is solid on every surface.
const bar = (done: number, total: number, width: number) => {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return { filled: ' '.repeat(filled), rest: ' '.repeat(width - filled) }
}
const BAR_EMPTY = '#D4D4D8'

const asSteps = (raw: unknown): Step[] =>
  Array.isArray(raw)
    ? raw.flatMap(item => {
        const content = (item as { content?: unknown })?.content
        const status = (item as { status?: unknown })?.status
        if (typeof content !== 'string') return []
        const isKnown = status === 'pending' || status === 'in_progress' || status === 'completed'

        return [{ content, status: (isKnown ? status : 'pending') as StepStatus }]
      })
    : []

// The app's own task list: { items } replaces it, { advance } moves it on one
// step, { done, start } ticks steps by their 1-based number.
const applyPlanCall = (steps: Step[], args: Record<string, unknown>): Step[] => {
  if (Array.isArray(args.items)) return asSteps(args.items)
  let next = steps.map(s => ({ ...s }))
  const mark = (index: number, status: StepStatus) => {
    const step = next[index]
    if (step) step.status = status
  }
  if (args.advance === true) {
    const current = next.findIndex(s => s.status === 'in_progress')
    mark(current, 'completed')
    mark(next.findIndex((s, i) => i > current && s.status === 'pending'), 'in_progress')
  }
  if (Array.isArray(args.done)) {
    for (const n of args.done) if (typeof n === 'number') mark(n - 1, 'completed')
  }
  if (typeof args.start === 'number' && next[args.start - 1]) {
    next = next.map(s => (s.status === 'in_progress' ? { ...s, status: 'pending' } : s))
    mark(args.start - 1, 'in_progress')
  }

  return next
}

const STATUS_ORDER: Array<{ status: Card['status'] | 'silent'; label: string; color: string }> = [
  { status: 'waiting', label: 'Waiting on you', color: 'warning' },
  { status: 'running', label: 'Running', color: 'suggestion' },
  { status: 'silent', label: 'No signal (closed or stuck?)', color: 'error' },
  { status: 'finished', label: 'Finished', color: 'success' },
  { status: 'idle', label: 'Open, nothing running', color: 'inactive' },
]

// Set at session.start; a reload runs it again.
let boardDir = ''
let sessionId = ''
let folder = ''
let home = ''

// What the mod can tell about itself, written beside the status files so a
// problem can be read from outside the app.
const VERSION = '0.8.1'
const diag = { bandDraws: 0, bandError: '', titles: 0, titlesError: '' }

// Each chat writes one small file; the All chats pane reads them all.
async function writeCard($: EngineInterface, closed = false) {
  if (boardDir === '' || sessionId === '') return
  const steps = await read($, plan)
  const state = await read($, live)
  const list = await read($, helpers)
  const current = steps.find(s => s.status === 'in_progress')
  const card: Card = {
    id: sessionId,
    title: (await read($, titles))[sessionId]?.title || state.title || 'Untitled chat',
    folder,
    status: closed ? 'closed' : state.status,
    step: current?.content ?? '',
    done: steps.filter(s => s.status === 'completed').length,
    total: steps.length,
    note: state.note,
    tool: state.tool,
    toolSince: state.toolSince,
    helpersRunning: list.filter(h => !h.isDone).length,
    updatedAt: await $.clock.now(),
    statusSince: state.statusSince,
  }
  await $.fs.write(`${boardDir}/${sessionId}.json`, JSON.stringify(card))
}

async function setLive($: EngineInterface, change: Partial<Live>) {
  const at = await $.clock.now()
  await update($, live, value => ({
    ...value,
    ...change,
    statusSince: change.status !== undefined && change.status !== value.status ? at : (value.statusSince ?? at),
  }))
  await writeCard($)
}

async function readTitles($: EngineInterface) {
  if (home === '') return
  const ran = await $.process
    .run(['/usr/bin/env', 'python3', '-c', TITLES_SCRIPT, `${home}/Library/Application Support/Claude/claude-code-sessions`], {
      timeoutMs: 20_000,
    })
    .catch((error: unknown) => {
      diag.titlesError = `run failed: ${String(error).slice(0, 300)}`

      return undefined
    })
  if (!ran || ran.exitCode !== 0) {
    diag.titlesError = ran ? `exit ${ran.exitCode}: ${ran.stderr.slice(0, 300)}` : 'python3 did not start'
    return
  }
  try {
    const found = JSON.parse(ran.stdout) as Record<string, SidebarTitle>
    await update($, titles, () => found)
    diag.titles = Object.keys(found).length
    diag.titlesError = ''
  } catch (error) {
    // Keep the names from the last good read.
    diag.titlesError = `bad output: ${String(error).slice(0, 200)}`
  }
}

async function readBoard($: EngineInterface) {
  if (boardDir === '') return
  const at = await $.clock.now()
  const entries = await $.fs.list(boardDir).catch(() => [])
  const cards: Card[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const path = `${boardDir}/${entry.name}`
    // A week-old file is a chat long gone: leave it unread.
    if (at - entry.mtimeMs > IGNORE_AFTER) continue
    const text = await $.fs.read(path).catch(() => '')
    try {
      const card = JSON.parse(text) as Card
      if (typeof card?.id === 'string') cards.push(card)
    } catch {
      // An empty or half-written file: skip it this round.
    }
  }
  await update($, board, () => cards)
  await update($, now, () => at)
  await readCleared($)
  await $.fs
    .write(`${boardDir}/../diag/${sessionId}.json`, JSON.stringify({ version: VERSION, at, ...diag }))
    .catch(() => undefined)
}

// The roadmap list plus what the marketplace actually holds: listed there = built.
async function readMods($: EngineInterface) {
  if (home === '') return
  const root = `${home}/claude-mods`
  const parse = async (path: string): Promise<Record<string, unknown>> => {
    try {
      return JSON.parse(await $.fs.read(path)) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  const roadmap = ((await parse(`${root}/roadmap.json`)).mods ?? []) as Partial<ModEntry>[]
  const market = ((await parse(`${root}/.claude-plugin/marketplace.json`)).plugins ?? []) as { name: string; description?: string }[]
  const installed = new Set(market.map(p => p.name))
  const list: ModEntry[] = []
  for (const item of roadmap) {
    if (!item.name) continue
    const isBuilt = installed.has(item.name)
    const version = isBuilt ? String((await parse(`${root}/${item.name}/.claude-plugin/plugin.json`)).version ?? '') : ''
    const status = isBuilt ? 'built' : item.status === 'built' ? 'planned' : (item.status ?? 'planned')
    list.push({ name: item.name, title: item.title || item.name, what: item.what || '', status, version, note: item.note || '' })
  }
  // A mod in the marketplace that the roadmap forgot still shows.
  for (const p of market) {
    if (list.some(m => m.name === p.name)) continue
    const version = String((await parse(`${root}/${p.name}/.claude-plugin/plugin.json`)).version ?? '')
    list.push({ name: p.name, title: p.name, what: p.description ?? '', status: 'built', version, note: '' })
  }
  await update($, mods, () => list)
}

// After a reply, background jobs or helpers still at work keep the chat Running.
async function stillBusy($: EngineInterface): Promise<{ note: string; tool: string; since: number } | null> {
  const at = await $.clock.now()
  const list = (await read($, jobs)).filter(j => at - j.startedAt < JOB_FORGET_AFTER)
  await update($, jobs, () => list)
  const job = list[0]
  if (job) {
    const more = list.length > 1 ? ` (+${list.length - 1} more)` : ''
    return { note: `⏳ In the background: ${short(job.label, 100)}${more}`, tool: short(job.label, 60), since: job.startedAt }
  }
  const helper = (await read($, helpers)).find(h => !h.isDone)
  if (helper) return { note: `⏳ Helper still working: ${short(helper.description, 100)}`, tool: 'Helper', since: helper.startedAt }
  return null
}

// Cleared chats are kept in one shared file so every chat's pane agrees.
function clearedPath() {
  return `${boardDir}/../cleared.json`
}

async function readCleared($: EngineInterface) {
  if (boardDir === '') return
  try {
    const value = JSON.parse(await $.fs.read(clearedPath())) as Record<string, Cleared>
    await update($, cleared, () => value)
  } catch {
    // No file yet: nothing cleared.
  }
}

async function clearCards($: EngineInterface, cards: Card[]) {
  if (boardDir === '' || cards.length === 0) return
  await readCleared($)
  const at = await $.clock.now()
  const next: Record<string, Cleared> = {}
  for (const [id, entry] of Object.entries(await read($, cleared))) {
    if (at - entry.at < IGNORE_AFTER) next[id] = entry
  }
  for (const card of cards) next[card.id] = { at, status: card.status, note: card.note }
  await update($, cleared, () => next)
  await $.fs.write(clearedPath(), JSON.stringify(next)).catch(() => undefined)
}

async function changeHelper($: EngineInterface, id: string, change: (h: Helper) => Helper) {
  await update($, helpers, list => list.map(h => (h.id === id ? change(h) : h)))
}

// A helper's own task list, from whichever task tool it uses.
async function trackHelperTasks($: EngineInterface, id: string, tool: string, args: Record<string, unknown>, result: unknown) {
  if (tool === 'TodoWrite' || tool === 'mcp__ccd_turn__update_plan') {
    const steps = tool === 'TodoWrite' ? asSteps(args.todos) : applyPlanCall([], args)
    if (steps.length === 0) return
    const tasks: HelperTasks = {
      done: steps.filter(s => s.status === 'completed').length,
      total: steps.length,
      current: steps.find(s => s.status === 'in_progress')?.content ?? '',
    }
    await changeHelper($, id, h => ({ ...h, tasks }))
  }
  if (tool === 'TaskCreate') {
    const subject = typeof args.subject === 'string' ? args.subject : 'task'
    const taskId = /#?(\d+)/.exec(JSON.stringify(result ?? ''))?.[1] ?? String(Date.now())
    await changeHelper($, id, h => ({
      ...h,
      taskNames: { ...h.taskNames, [taskId]: subject },
      tasks: { ...h.tasks, total: h.tasks.total + 1 },
    }))
  }
  if (tool === 'TaskUpdate') {
    const taskId = typeof args.taskId === 'string' ? args.taskId : ''
    const status = args.status
    await changeHelper($, id, h => {
      const name = (typeof args.subject === 'string' && args.subject) || h.taskNames[taskId] || h.tasks.current
      return {
        ...h,
        tasks: {
          total: h.tasks.total,
          done: status === 'completed' ? Math.min(h.tasks.total, h.tasks.done + 1) : h.tasks.done,
          current: status === 'in_progress' ? name : status === 'completed' && name === h.tasks.current ? '' : h.tasks.current,
        },
      }
    })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    boardDir = home === '' ? '' : `${home}/.claude/mission-control/sessions`
    sessionId = await $.session.id()
    folder = e.cwd.replace(home, '~')
    try {
      setHatSettings(JSON.parse(await $.fs.read(`${home}/.claude/mission-control/hats.json`)) as Record<string, HatSetting>)
    } catch {
      setHatSettings({})
    }

    // A chat that was already open when the mod arrived: name it after its
    // first message, minus the reminders the app tucks into it.
    if ((await read($, live)).title === '') {
      const messages = await $.session.messages().catch(() => [])
      const first = messages
        .filter(m => m.role === 'user')
        .map(m => m.text.replace(/<([a-z_-]+)[^>]*>[\s\S]*?<\/\1>/g, '').trim())
        .find(text => text !== '')
      if (first) await update($, live, value => ({ ...value, title: short(first, 70) }))
    }

    await $.command.register({
      name: 'chats',
      description: 'Show every chat: running, waiting on you, finished',
    })
    await $.command.register({
      name: 'mods',
      description: 'Show the mods built so far and still to build',
    })
    await $.command.register({
      name: 'helpers',
      description: 'Show the helper agents of this chat, their model and cost',
    })

    await writeCard($)
    await readBoard($)
    // Keep this chat's file fresh and the board current.
    await readTitles($)
    $.clock.every(5000, () => void readBoard($))
    // Sidebar names change rarely: re-read them every 30 seconds.
    $.clock.every(30_000, () => void readTitles($))
    await readMods($)
    $.clock.every(10_000, () => void readMods($))
    $.clock.every(MINUTE, () => void writeCard($))

    if (e.isInteractive) void $.ui.open({ id: CHATS_PANE, title: 'All chats' })

    return next(e)
  })

  on('command.run', { command: 'chats' }, async $ => {
    await $.ui.open({ id: CHATS_PANE, title: 'All chats' })

    return { text: 'All chats pane opened.' }
  })

  on('command.run', { command: 'mods' }, async $ => {
    await readMods($)
    await $.ui.open({ id: MODS_PANE, title: 'Mods' })

    return { text: 'Mods pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: MODS_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, mods)
    const room = Math.max(20, e.props.bodyColumns - 6)
    const groups = [
      { status: 'built', label: 'Built', mark: '✓', color: 'success' },
      { status: 'next', label: 'Next up', mark: '◐', color: ACCENT },
      { status: 'planned', label: 'Still to build', mark: '○', color: 'inactive' },
      { status: 'on hold', label: 'On hold', mark: '⏸', color: 'inactive' },
    ] as const
    const count = (status: ModEntry['status']) => list.filter(m => m.status === status).length
    const toBuild = count('next') + count('planned')

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          {count('built')} built · {toBuild} to build{count('on hold') > 0 ? ` · ${count('on hold')} on hold` : ''} · updates every 10s
        </Text>
        {list.length === 0 && <Text dimColor>No list yet: ~/claude-mods/roadmap.json is missing.</Text>}
        {groups.map(group => {
          const inGroup = list.filter(m => m.status === group.status)
          if (inGroup.length === 0) return null

          return (
            <Box flexDirection="column">
              <Text color={group.color} weight="bold">
                {group.label} ({inGroup.length})
              </Text>
              {inGroup.map(mod => (
                <Box flexDirection="column" paddingLeft={2}>
                  <Text>
                    <Text color={group.color}>{group.mark}</Text> <Text weight="semibold">{mod.title}</Text>
                    {mod.version !== '' ? <Text dimColor> v{mod.version}</Text> : null}
                  </Text>
                  <Text dimColor>{short(mod.what, room * 2)}</Text>
                  {mod.note !== '' && <Text color="warning">{short(mod.note, room)}</Text>}
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('command.run', { command: 'helpers' }, async $ => {
    await $.ui.open({ id: HELPERS_PANE, title: 'Agents' })

    return { text: 'Agents pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const state = await read($, live)
    const title = state.title === '' && !e.isMeta ? short(e.text, 70) : state.title
    if (title !== state.title) await update($, live, value => ({ ...value, title }))
    if (e.origin?.kind === 'task-notification') {
      // The note names the job's id; if it doesn't, the oldest job is the one that ended.
      await update($, jobs, list => {
        const left = list.filter(j => !e.text.includes(j.id))
        return left.length < list.length ? left : list.slice(1)
      })
      await writeCard($)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const at = await $.clock.now()
    // A new message starts a new task list: drop the last reply's finished one.
    if (e.text !== '') {
      await update($, plan, () => [])
      // Helpers belong to the work of one message; finished ones from earlier go.
      await update($, helpers, list => list.filter(h => !h.isDone))
      await update($, isBandHidden, () => false)
      await update($, live, value => ({ ...value, tokensIn: 0, tokensOut: 0, costUsd: 0, steps: 0, ctxTokens: 0 }))
    }
    await setLive($, { status: 'running', note: '', turnStartedAt: at })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    const agentId = e.agentId
    if (agentId !== undefined) {
      const label = name.startsWith('mcp__') ? name.split('__').slice(-1)[0] ?? name : name
      await changeHelper($, agentId, h => ({ ...h, tool: label }))
      const result = await next(e)
      await trackHelperTasks($, agentId, name, args, result)

      return result
    }

    if (name === 'mcp__ccd_turn__update_plan') {
      await update($, plan, steps => applyPlanCall(steps, args))
      await writeCard($)

      return next(e)
    }
    if (name === 'TodoWrite') {
      await update($, plan, () => asSteps(args.todos))
      await writeCard($)

      return next(e)
    }
    if (name === 'mcp__ccd_turn__wrap_up') {
      // Wrapping up ticks off the whole list; an ask means the ball is with you.
      await update($, plan, steps => steps.map(s => ({ ...s, status: 'completed' as const })))
      const ask = typeof args.ask === 'string' ? args.ask : ''
      const recap = typeof args.recap === 'string' ? args.recap : ''
      await update($, live, value => ({
        ...value,
        note: ask !== '' ? `❓ ${short(ask, 120)}` : short(recap, 160),
      }))
      await writeCard($)

      return next(e)
    }
    if (name === 'AskUserQuestion') {
      await setLive($, { status: 'waiting', note: '❓ Answer the question in this chat' })
      const result = await next(e)
      await setLive($, { status: 'running', note: '' })

      return result
    }

    if (name === 'TaskStop' || name === 'KillShell' || name === 'KillBash') {
      const text = JSON.stringify(args)
      await update($, jobs, list => list.filter(j => !text.includes(j.id)))
    }

    const label = name.startsWith('mcp__') ? name.split('__').slice(-1)[0] : name
    await setLive($, { tool: label, toolSince: await $.clock.now() })
    const result = await next(e)
    await setLive($, { tool: '', toolSince: 0 })

    const taskId = (result as { result?: { backgroundTaskId?: unknown } }).result?.backgroundTaskId
    if (name === 'Bash' && args.run_in_background === true && typeof taskId === 'string') {
      const what = typeof args.description === 'string' && args.description !== '' ? args.description : 'Background command'
      const at = await $.clock.now()
      await update($, jobs, list => [...list.filter(j => j.id !== taskId), { id: taskId, label: what, startedAt: at }])
    }

    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('agentId' in result && typeof result.agentId === 'string') {
      const helper: Helper = {
        id: result.agentId,
        description: e.description,
        type: e.subagentType,
        model: 'model' in result && typeof result.model === 'string' ? result.model : e.model ?? '',
        effort: '',
        isDone: false,
        startedAt: await $.clock.now(),
        endedAt: null,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        ctxTokens: 0,
        steps: 0,
        tool: '',
        tasks: NO_TASKS,
        taskNames: {},
      }
      await update($, helpers, list => [...list.filter(h => h.id !== helper.id), helper].slice(-50))
      await writeCard($)
    }

    return result
  })

  // Each request a helper makes: its model, effort, tokens and cost, live.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (agentId === undefined && usage) {
      await update($, live, value => ({
        ...value,
        model: usage.model || e.model || value.model,
        effort: e.effort === undefined ? value.effort : String(e.effort),
        steps: value.steps + 1,
        ctxTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        tokensIn: value.tokensIn + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        tokensOut: value.tokensOut + usage.output_tokens,
        costUsd: value.costUsd + costOf(usage.model || e.model, usage),
      }))
    }
    if (agentId !== undefined && usage) {
      await changeHelper($, agentId, h => ({
        ...h,
        model: usage.model || e.model || h.model,
        effort: e.effort === undefined ? h.effort : String(e.effort),
        steps: h.steps + 1,
        ctxTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        tokensIn: h.tokensIn + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        tokensOut: h.tokensOut + usage.output_tokens,
        costUsd: h.costUsd + costOf(usage.model || e.model, usage),
      }))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const at = await $.clock.now()

    if (e.agentId !== undefined) {
      const usage = e.usage
      await update($, helpers, list =>
        list.map(h =>
          h.id !== e.agentId
            ? h
            : {
                ...h,
                isDone: true,
                endedAt: at,
                tool: '',
                tasks: h.tasks.total > 0 ? { ...h.tasks, done: h.tasks.total, current: '' } : h.tasks,
                // The live count from each request wins; the turn's total only
                // fills in when no request was seen.
                ...(h.steps > 0 || !usage
                  ? {}
                  : {
                      model: usage.model || h.model,
                      tokensIn: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
                      tokensOut: usage.output_tokens,
                      costUsd: costOf(usage.model, usage),
                    }),
              },
        ),
      )
      await writeCard($)

      return result
    }

    const state = await read($, live)
    const isAsking = state.note.startsWith('❓')
    const busy = e.reason === 'aborted' || isAsking ? null : await stillBusy($)
    const status: ChatStatus = e.reason === 'aborted' ? 'idle' : isAsking ? 'waiting' : busy ? 'running' : 'finished'
    const note = busy
      ? busy.note
      : state.note !== ''
        ? state.note
        : e.reason === 'error'
          ? 'Stopped on an error'
          : short(e.answer, 160)
    await setLive($, { status, note, tool: busy?.tool ?? '', toolSince: busy?.since ?? 0 })
    if (status === 'waiting') $.ui.toast(`Waiting on you: ${short(state.title, 50)}`)

    return result
  })

  on('session.end', async ($, e, next) => {
    await writeCard($, true).catch(() => undefined)

    return next(e)
  })

  // The band above the prompt: this chat's name, its task list as a pill on a
  // sparkling bar, and its helpers as crabs.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    diag.bandDraws += 1
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const steps = await read($, plan)
    const list = await read($, helpers)
    const state = await read($, live)
    const names = await read($, titles)
    const at = await read($, now)
    const running = list.filter(h => !h.isDone)

    const { Box, Button, Text } = $.ui.resolve(e)
    const done = steps.filter(s => s.status === 'completed').length
    const total = steps.length
    const title = short(names[sessionId]?.title || state.title || 'This chat', 28)
    const bgCount = e.props.isWorking ? 0 : (await read($, jobs)).length
    const pill =
      bgCount > 0
        ? bgCount === 1
          ? ' Background job '
          : ` ${bgCount} background jobs `
        : total > 0
        ? ` Tasks ${done}/${total} `
        : e.props.isWorking
          ? ' Working '
          : state.status === 'waiting'
            ? ' Waiting on you '
            : ' Idle '
    const fraction = bgCount > 0 ? 0.6 : total > 0 ? done / total : e.props.isWorking ? 0.35 : 0
    const seed = Math.floor(at / 1000)
    const percent = total > 0 && bgCount === 0 ? `${Math.round((done / total) * 100)}%` : ''
    // The chat's own crab wears the hat of the chat's effort; a helper's, its own.
    const crabStyle = styleOf(running[0]?.effort || state.effort)

    // Other mods' bands (Reflect) draw beneath this one.
    const below = await next(e)

    if (e.surface === 'terminal') {
      const width = Math.max(12, Math.min(40, e.props.bodyColumns - title.length - pill.length - 32))
      const filled = Math.round(fraction * width)

      return (
        <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={ACCENT}>●</Text>
          <Text weight="semibold">{title}</Text>
          <Text>
            <Text color={ACCENT}>{sparkle(0, filled, seed)}</Text>
            <Text backgroundColor={ACCENT} color="#FFFFFF">
              {pill}
            </Text>
            <Text color={ACCENT_SOFT}>{sparkle(filled, Math.max(0, width - filled), seed)}</Text>
          </Text>
          {percent !== '' && <Text dimColor>{percent}</Text>}
          <Text>🦀{list.length > 0 ? ` ×${list.length}` : ''}</Text>
        </Box>
        {below}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const barPx = Math.max(140, Math.min(420, (e.props.bodyColumns - title.length - 34) * 7))

    return (
      <Box flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={state.status === 'waiting' ? 'warning' : ACCENT}>●</Text>
        <Text weight="semibold">{title}</Text>
        <Svg source={progressSvg(fraction, pill.trim(), barPx, seed)} alt={pill.trim()} width={barPx} height={22} />
        {percent !== '' && (
          <Text dimColor tabular>
            {percent}
          </Text>
        )}
        <Svg source={crabSvg(crabStyle, false, running[0] ? roleOf(running[0].description, running[0].type) : '')} alt={`${crabStyle.label} crab`} width={24} height={20} />
        <Button key="helpers" plain onPress={() => void $.ui.open({ id: HELPERS_PANE, title: 'Agents' })}>
          {list.length > 0 ? `×${list.length}` : 'Agents'}
        </Button>
        <Button key="chats" plain onPress={() => void $.ui.open({ id: CHATS_PANE, title: 'All chats' })}>
          All chats
        </Button>
        <Button key="mods" plain onPress={() => void $.ui.open({ id: MODS_PANE, title: 'Mods' })}>
          Mods
        </Button>
        <Button key="hide" plain role="dismiss" label="✕" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
      {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: HELPERS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, helpers)
    const steps = await read($, plan)
    const state = await read($, live)
    const names = await read($, titles)
    const at = await read($, now)
    const isOpen = await read($, isFinishedOpen)
    const running = list.filter(h => !h.isDone)
    const finished = list.filter(h => h.isDone)
    const planned = steps.filter(s => s.status === 'pending')
    // The chat itself is the first row, so the totals count its work too.
    const isChatBusy = state.status === 'running'
    const done = steps.filter(s => s.status === 'completed').length
    const chatRow: Helper = {
      id: 'chat',
      description: 'This chat',
      type: 'main',
      model: state.model,
      effort: state.effort,
      isDone: !isChatBusy,
      startedAt: state.turnStartedAt || at,
      endedAt: isChatBusy ? null : at,
      tokensIn: state.tokensIn,
      tokensOut: state.tokensOut,
      costUsd: state.costUsd,
      ctxTokens: state.ctxTokens,
      steps: state.steps,
      tool: state.tool,
      tasks: { done, total: steps.length, current: steps.find(s => s.status === 'in_progress')?.content ?? '' },
      taskNames: {},
    }
    const everyone = [chatRow, ...list]
    const cost = everyone.reduce((sum, h) => sum + h.costUsd, 0)
    const tokensUsed = everyone.reduce((sum, h) => sum + h.tokensIn + h.tokensOut, 0)
    const firstStart = Math.min(...everyone.map(h => h.startedAt))
    const lastEnd = isChatBusy || running.length > 0 ? at : Math.max(...everyone.map(h => h.endedAt ?? at))
    const room = Math.max(16, e.props.bodyColumns - 12)

    const sprite = (style: Style, isDim = false, role = '') =>
      e.surface === 'terminal' ? (
        <Text dimColor={isDim}>{HATS[role]?.emoji ?? '🦀'}</Text>
      ) : (
        (() => {
          const { Svg } = $.ui.resolve(e)
          return <Svg source={crabSvg(style, isDim, role)} alt={`${roleName(role) || style.label} crab`} width={32} height={27} />
        })()
      )

    const tile = (label: string, value: string) => (
      <Box flexDirection="column" borderStyle="round" paddingX={1} flexGrow={1}>
        <Text dimColor size="caption">
          {label}
        </Text>
        <Text weight="semibold" tabular>
          {value}
        </Text>
      </Box>
    )

    const row = (helper: Helper) => {
      const style = styleOf(helper.effort)
      const role = helper.id === 'chat' ? '' : roleOf(helper.description, helper.type)
      const progress = helper.tasks.total > 0 ? helper.tasks.done / helper.tasks.total : helper.isDone ? 1 : 0
      const barWidth = Math.max(8, room - 4)
      const filled = Math.round(progress * barWidth)
      const doing = helper.tasks.total > 0
        ? `${helper.tasks.done}/${helper.tasks.total}${helper.tasks.current ? ` · ${helper.tasks.current}` : ''}`
        : helper.isDone
          ? 'done'
          : helper.tool
            ? `step ${helper.steps + 1} · ${helper.tool}`
            : `step ${helper.steps + 1}`

      return (
        <Box flexDirection="row" gap={1}>
          {sprite(style, false, role)}
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text weight="semibold">{short(helper.description || helper.type, room - 4)}</Text>
              <Text color={helper.isDone ? 'success' : '#16A34A'}>{helper.isDone ? '✓' : '●'}</Text>
            </Box>
            <Text>
              {role !== '' && <Text weight="semibold">{roleName(role)} · </Text>}
              <Text color={style.color}>{style.label}</Text>{' '}
              <Text dimColor>
                {prettyModel(helper.model) || helper.type}
                {helper.effort ? ` · ${helper.effort}` : ''}
              </Text>
            </Text>
            <Box flexDirection="row" justifyContent="space-between">
              <Text>{short(doing, Math.max(10, room - 28))}</Text>
              <Text dimColor tabular>
                ctx {tokens(helper.ctxTokens)} · {tokens(helper.tokensIn + helper.tokensOut)} ≈${helper.costUsd.toFixed(2)}{' '}
                {clock((helper.endedAt ?? at) - helper.startedAt)}
              </Text>
            </Box>
            <Text>
              <Text backgroundColor={style.color}>{' '.repeat(filled)}</Text>
              <Text backgroundColor={TRACK}>{' '.repeat(barWidth - filled)}</Text>
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text size="heading" weight="semibold">
          {short(names[sessionId]?.title || state.title || 'This chat', room)}
        </Text>
        <Box flexDirection="row" gap={1}>
          {tile('Cost', `≈$${cost.toFixed(2)}`)}
          {tile('Tokens', tokens(tokensUsed))}
          {tile('Time', clock(lastEnd - firstStart))}
        </Box>
        <Box flexDirection="column" gap={1}>
          <Text dimColor>This chat · {isChatBusy ? 'working' : 'idle'}</Text>
          {row(chatRow)}
        </Box>
        {list.length === 0 && <Text dimColor>No helper agents yet. They show up here as soon as one starts.</Text>}
        {running.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Running · {running.length}</Text>
            {running.map(row)}
          </Box>
        )}
        {finished.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Button key="finished" plain onPress={() => update($, isFinishedOpen, v => !v)}>
              {isOpen ? '▾' : '▸'} Finished · {finished.length}
            </Button>
            {isOpen && finished.map(row)}
          </Box>
        )}
        {planned.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Planned · {planned.length}</Text>
            {planned.map((step, i) => (
              <Box flexDirection="row" gap={1}>
                {sprite(PLANNED, true, roleOf(step.content))}
                <Box flexDirection="column">
                  <Text weight="semibold">
                    {steps.indexOf(step) + 1}. {short(step.content, room - 4)}
                  </Text>
                  <Text dimColor>{i === 0 ? 'next in this chat' : `after step ${steps.indexOf(step)}`}</Text>
                </Box>
                <Text dimColor>◷</Text>
              </Box>
            ))}
          </Box>
        )}
        {<Text dimColor size="caption">Costs are rough API-price estimates; your plan covers them.</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CHATS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const names = await read($, titles)
    const gone = await read($, cleared)
    // A cleared chat stays hidden until its status or last note changes.
    const isCleared = (card: Card) => {
      const entry = gone[card.id]
      if (entry === undefined) return false
      // A silent chat that writes again is back.
      if (card.status === 'running') return card.updatedAt <= entry.at
      return entry.status === card.status && entry.note === card.note
    }
    const cards = (await read($, board))
      .filter(card => names[card.id]?.isArchived !== true)
      .filter(card => card.status === 'waiting' || !isCleared(card))
      .map(card => ({ ...card, title: names[card.id]?.title || card.title }))
    const at = await read($, now)
    const groupOf = (card: Card): Card['status'] | 'silent' =>
      card.status === 'running' && at - card.updatedAt > SILENT_AFTER ? 'silent' : card.status
    const shown = cards.filter(
      card => card.status !== 'closed' && !(card.status !== 'running' && at - card.updatedAt > HIDE_AFTER),
    )
    const room = Math.max(20, e.props.bodyColumns - 4)

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          {shown.length} chat{shown.length === 1 ? '' : 's'} · updates every 5s
        </Text>
        {shown.length === 0 && (
          <Text dimColor>No chats have reported yet. Chats opened after this mod is installed show up here.</Text>
        )}
        {STATUS_ORDER.map(group => {
          const inGroup = shown
            .filter(card => groupOf(card) === group.status)
            .sort((a, b) => b.updatedAt - a.updatedAt)
          if (inGroup.length === 0) return null

          return (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={2}>
                <Text color={group.color} weight="bold">
                  {group.label} ({inGroup.length})
                </Text>
                {(group.status === 'finished' || group.status === 'idle' || group.status === 'silent') && (
                  <Button key={`clear-all-${group.status}`} plain label="Clear all" onPress={() => clearCards($, inGroup)} />
                )}
              </Box>
              {inGroup.map(card => (
                <Box flexDirection="column" paddingLeft={2}>
                  <Box flexDirection="row" gap={1}>
                    {names[card.id]?.localId && card.id !== sessionId ? (
                      <Button key={`open-${card.id}`} plain onPress={() => openChat($, names[card.id]?.localId ?? '')}>
                        {short(card.title, room - 8)}
                      </Button>
                    ) : (
                      <Text weight={card.id === sessionId ? 'bold' : 'regular'}>
                        {short(card.title, room - 8)}
                        {card.id === sessionId ? ' (this chat)' : ''}
                      </Text>
                    )}
                    {(group.status === 'finished' || group.status === 'idle' || group.status === 'silent') && (
                      <Button key={`clear-${card.id}`} plain label="✕" onPress={() => clearCards($, [card])} />
                    )}
                  </Box>
                  <Text dimColor>
                    {card.folder} · {when(card, groupOf(card), at)}
                    {card.helpersRunning > 0 ? ` · ${card.helpersRunning} helpers` : ''}
                  </Text>
                  {card.total > 0 && card.status === 'running' && (
                    <Text>
                      <Text backgroundColor="claude">{bar(card.done, card.total, 12).filled}</Text>
                      <Text backgroundColor={BAR_EMPTY}>{bar(card.done, card.total, 12).rest}</Text> {card.done}/{card.total}{' '}
                      <Text dimColor>{short(card.step, room - 20)}</Text>
                    </Text>
                  )}
                  {card.status === 'running' && card.tool !== '' && card.toolSince > 0 && (
                    <Text dimColor>
                      {card.tool} running for {ago(at - card.toolSince)}
                    </Text>
                  )}
                  {card.note !== '' && card.status !== 'running' && <Text dimColor>{short(card.note, room * 2)}</Text>}
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
