import { expect, test } from 'claude-code/testing'
import { roleName, roleOf, setHatSettings } from './register'

const OTHER_CHAT = {
  id: 'other',
  title: 'Script the launch Short',
  folder: '~/content',
  status: 'waiting',
  step: '',
  done: 3,
  total: 3,
  note: '❓ Approve the hook?',
  tool: '',
  toolSince: 0,
  helpersRunning: 0,
  updatedAt: 0,
}

const band = (surface: 'terminal' | 'desktop') => ({
  plugin: 'mission-control',
  surface,
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}) as const

const pane = (surface: 'terminal' | 'desktop') => ({
  plugin: 'mission-control',
  surface,
  component: 'Pane',
  requestId: 'mc-chats',
  props: {
    title: 'All chats',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
}) as const

test('the band follows the task list and the board lists other chats', async ($, on) => {
  const written: Record<string, string> = {}
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'this' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.write', (_, e) => {
    written[e.path] = e.text

    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [{ name: 'other.json', kind: 'file', size: 10, mtimeMs: Date.now(), isLink: false }],
  }))
  on('fs.read', () => ({ value: JSON.stringify({ ...OTHER_CHAT, updatedAt: Date.now() }) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/home/me/content', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'build it', turnId: 't1' })
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Read docs', status: 'completed' },
      { content: 'Write the mod', status: 'in_progress' },
      { content: 'Test it', status: 'pending' },
    ],
  } as never)

  const card = JSON.parse(written['/home/me/.claude/mission-control/sessions/this.json'] ?? '{}')
  expect(card.status).toBe('running')
  expect(card.step).toBe('Write the mod')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    // The terminal draws the pill as text; the desktop draws it in a picture.
    if (surface === 'terminal') expect((await ui.find({ type: 'Text', text: /1\/3/ }))?.text).toContain('1/3')
    expect(await ui.find({ type: 'Text', text: /33%/ })).toBeDefined()
    await ui.unmount()

    const board = await $.ui.mount(pane(surface))
    expect(await board.find({ type: 'Text', text: /Waiting on you/ })).toBeDefined()
    expect(await board.find({ type: 'Text', text: /Script the launch Short/ })).toBeDefined()
    await board.unmount()
  }
})

test('the Agents pane shows a helper with its tasks, totals and sections', async ($, on) => {
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'this' }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: 'done' }))

  await $.session.start({ cwd: '/home/me', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'build the kit', turnId: 't1' })
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Research', status: 'in_progress' },
      { content: 'Review the whole kit', status: 'pending' },
    ],
  } as never)
  await $.agent.spawn({ prompt: 'Research launches', description: 'Research competitor launches', subagentType: 'general-purpose' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    agentId: 'a1',
    todos: [
      { content: 'Find launches', status: 'completed', activeForm: 'Finding' },
      { content: 'Hero copy', status: 'in_progress', activeForm: 'Writing' },
      { content: 'Sum up', status: 'pending', activeForm: 'Summing' },
    ],
  } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'mission-control',
      surface,
      component: 'Pane',
      requestId: 'mc-helpers',
      props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /Running · 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Research competitor launches/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/3 · Hero copy/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Planned · 1/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 30000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as never)
  const ui = await $.ui.mount({
    plugin: 'mission-control',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'mc-helpers',
    props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /3\/3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /32k/ })).toBeDefined()
  await ui.unmount()
})

test('the Mods pane lists built and planned mods', async ($, on) => {
  const files: Record<string, string> = {
    '/home/me/claude-mods/roadmap.json': JSON.stringify({
      mods: [
        { name: 'reflect', title: 'Reflect', what: 'Saves rules' },
        { name: 'you-should-know', title: 'You Should Know', what: 'Pop-ups', status: 'next' },
        { name: 'auto-model', title: 'Auto model', what: 'Cheaper first', status: 'on hold' },
      ],
    }),
    '/home/me/claude-mods/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'reflect' }] }),
    '/home/me/claude-mods/reflect/.claude-plugin/plugin.json': JSON.stringify({ version: '0.1.1' }),
  }
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'this' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => { const text = files[e.path]; return text === undefined ? { deny: 'missing' } : { value: text } })
  on('process.run', () => ({ value: { stdout: '{}', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/home/me', surface: 'desktop', isInteractive: false })

  const ui = await $.ui.mount({
    plugin: 'mission-control',
    component: 'Pane',
    requestId: 'mc-mods',
    surface: 'desktop',
    props: { title: 'Mods', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /built ·/ }))?.text).toContain('1 built · 1 to build · 1 on hold')
  expect(await ui.find({ type: 'Text', text: /v0\.1\.1/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Next up/ }))?.text).toBe('Next up (1)')
  await ui.unmount()
})

test('a background job keeps the chat Running until its notice arrives', async ($, on) => {
  const written: Record<string, string> = {}
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'this' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.write', (_, e) => {
    written[e.path] = String(e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ deny: 'missing' }))
  on('process.run', () => ({ value: { stdout: '{}', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: { stdout: '', backgroundTaskId: 'b123' } }) as never)
  await $.session.start({ cwd: '/home/me', surface: 'desktop', isInteractive: false })

  const card = () => JSON.parse(written['/home/me/.claude/mission-control/sessions/this.json'] ?? '{}')
  await $.turn.start({ text: 'encode it', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ffmpeg ...', description: 'Encode the 1440p master', run_in_background: true } as never)
  await $.turn.complete({ answer: 'Encoding, about 5 minutes.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'completed' } as never)
  expect(card().status).toBe('running')
  expect(card().note).toContain('Encode the 1440p master')

  const ui = await $.ui.mount({
    plugin: 'mission-control',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /Background job/ })).toBeDefined()

  await $.prompt.submit({ text: '<task-notification><task-id>b123</task-id> completed', origin: { kind: 'task-notification' }, wait: false })
  await $.turn.start({ text: '', turnId: 't2' } as never)
  await $.turn.complete({ answer: 'Done, here it is.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'completed' } as never)
  expect(card().status).toBe('finished')
  await ui.unmount()
})

test('a finished chat can be cleared from All chats', async ($, on) => {
  const files: Record<string, string> = {}
  let other = { ...OTHER_CHAT, status: 'finished', note: 'Thumbnail done', updatedAt: Date.now() }
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'this' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.write', (_, e) => {
    files[e.path] = String(e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [{ name: 'other.json', kind: 'file', size: 10, mtimeMs: Date.now(), isLink: false }] }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/other.json')) return { value: JSON.stringify(other) }
    const text = files[e.path]
    return text === undefined ? { deny: 'missing' } : { value: text }
  })
  on('process.run', () => ({ value: { stdout: '{}', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/home/me', surface: 'desktop', isInteractive: false })

  const board = await $.ui.mount(pane('desktop'))
  expect(await board.find({ type: 'Text', text: /Script the launch Short/ })).toBeDefined()
  await board.press({ key: 'clear-other' })
  expect(await board.find({ type: 'Text', text: /Script the launch Short/ })).toBeUndefined()
  await board.unmount()

})

test('helpers get a hat for their job', () => {
  expect(roleOf('Build the landing page')).toBe('build')
  expect(roleOf('Design the launch graphics')).toBe('design')
  expect(roleOf('Research competitor launches')).toBe('research')
  expect(roleOf('Review the whole kit')).toBe('review')
  expect(roleOf('Find files', 'Explore')).toBe('research')
  expect(roleOf('Think about it')).toBe('')
})

test('AI clone and Shorts jobs win over the general ones', () => {
  expect(roleOf('Generate the clone voice for line 4')).toBe('clone')
  expect(roleOf('Render the avatar video clips')).toBe('clone')
  expect(roleOf('Script the launch Short')).toBe('shorts')
  expect(roleOf('Draft the description')).toBe('write')
})

test('clicking a chat title in All chats opens that chat', async ($, on) => {
  const opened: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'this' }))
  on('clock.now', () => ({ value: Date.now() }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'other.json', kind: 'file', size: 10, mtimeMs: Date.now(), isLink: false }] }))
  on('fs.read', (_, e) =>
    e.path.endsWith('/other.json') ? { value: JSON.stringify({ ...OTHER_CHAT, updatedAt: Date.now() }) } : { deny: 'missing' },
  )
  on('process.run', (_, e) => {
    const argv = (e as unknown as { argv?: string[]; command?: string[] }).argv ?? (e as unknown as { command: string[] }).command ?? []
    if (argv[0] === '/usr/bin/open') opened.push(String(argv[1]))
    const stdout = JSON.stringify({ other: { title: 'Script the launch Short', isArchived: false, localId: 'local_abc-123' } })
    return { value: { stdout, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/home/me', surface: 'desktop', isInteractive: false })

  const board = await $.ui.mount(pane('desktop'))
  await board.press({ key: 'open-other' })
  expect(opened).toEqual(['claude://code/continue?session=local_abc-123&source=spotlight'])
  await board.unmount()
})

test('your own hat settings add words and rename a job', () => {
  setHatSettings({ clone: { role: 'Twin', words: ['mytwin'] } })
  expect(roleOf('Make the MyTwin intro')).toBe('clone')
  expect(roleName('clone')).toBe('Twin')
  setHatSettings({})
  expect(roleOf('Make the MyTwin intro')).toBe('')
})
