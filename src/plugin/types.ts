import type { Plugin, ToolDefinition } from "@opencode-ai/plugin"

export type PluginContext = Parameters<Plugin>[0]
export type PluginInstance = Awaited<ReturnType<Plugin>>

export type PluginInterface = Required<
  Pick<
    PluginInstance,
    | "tool"
    | "config"
    | "chat.message"
    | "chat.params"
    | "chat.headers"
    | "event"
    | "tool.execute.before"
    | "tool.execute.after"
  >
>

export type ToolsRecord = Record<string, ToolDefinition>
