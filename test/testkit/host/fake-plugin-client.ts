export interface FakePromptPart {
  type: string
  text?: string
}

export interface FakePromptAsyncCall {
  path: { id: string }
  body: {
    parts: FakePromptPart[]
    agent?: string
  }
}

export interface FakeTodoItem {
  content: string
  status: string
  priority: string
}

export interface FakeExecutedToolCall {
  sessionID: string
  tool: string
  callID: string
  agent?: string
  args?: Record<string, unknown>
}

export interface FakeDelegatedToolCall extends FakeExecutedToolCall {
  args: Record<string, unknown> & { subagent_type: string }
}

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(args)
}

function isDelegatedToolCall(call: FakeExecutedToolCall): call is FakeDelegatedToolCall {
  return typeof call.args?.subagent_type === "string"
}

export class FakePluginClient {
  readonly promptAsyncCalls: FakePromptAsyncCall[] = []
  readonly todoRequests: Array<{ path: { id: string } }> = []
  readonly executedToolCalls: FakeExecutedToolCall[] = []

  private readonly todosBySession = new Map<string, FakeTodoItem[]>()

  readonly session = {
    promptAsync: async (opts: FakePromptAsyncCall) => {
      this.promptAsyncCalls.push({
        path: { id: opts.path.id },
        body: {
          ...("agent" in opts.body ? { agent: opts.body.agent } : {}),
          parts: opts.body.parts.map(part => ({ ...part })),
        },
      })
    },
    todo: async (opts: { path: { id: string } }) => {
      this.todoRequests.push({ path: { id: opts.path.id } })
      return { data: this.todosBySession.get(opts.path.id) ?? [] }
    },
  }

  setSessionTodos(sessionID: string, todos: FakeTodoItem[]): void {
    this.todosBySession.set(sessionID, todos.map(todo => ({ ...todo })))
  }

  recordExecutedToolCall(call: FakeExecutedToolCall): void {
    this.executedToolCalls.push({
      sessionID: call.sessionID,
      tool: call.tool,
      callID: call.callID,
      ...(typeof call.agent === "string" ? { agent: call.agent } : {}),
      ...(call.args ? { args: cloneArgs(call.args) } : {}),
    })
  }

  get lastPromptAsyncCall(): FakePromptAsyncCall | undefined {
    return this.promptAsyncCalls.length > 0
      ? this.promptAsyncCalls[this.promptAsyncCalls.length - 1]
      : undefined
  }

  get lastExecutedToolCall(): FakeExecutedToolCall | undefined {
    return this.executedToolCalls.length > 0
      ? this.executedToolCalls[this.executedToolCalls.length - 1]
      : undefined
  }

  get delegatedToolCalls(): FakeDelegatedToolCall[] {
    return this.executedToolCalls.filter(isDelegatedToolCall)
  }

  get lastDelegatedToolCall(): FakeDelegatedToolCall | undefined {
    return this.delegatedToolCalls.length > 0
      ? this.delegatedToolCalls[this.delegatedToolCalls.length - 1]
      : undefined
  }

  clearEffects(): void {
    this.promptAsyncCalls.length = 0
    this.todoRequests.length = 0
    this.executedToolCalls.length = 0
  }
}
