import type { Plugin } from "@opencode-ai/plugin"
import { loadWeaveConfig } from "./config/loader"
import { createManagers } from "./create-managers"
import { createTools } from "./create-tools"
import { createHooks } from "./hooks/create-hooks"
import { createPluginInterface } from "./plugin/plugin-interface"

const WeavePlugin: Plugin = async (ctx) => {
  const pluginConfig = loadWeaveConfig(ctx.directory, ctx)
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? [])
  const isHookEnabled = (name: string) => !disabledHooks.has(name)

  const toolsResult = await createTools({ ctx, pluginConfig })
  const managers = createManagers({ ctx, pluginConfig, resolveSkills: toolsResult.resolveSkillsFn })
  const hooks = createHooks({ pluginConfig, isHookEnabled, directory: ctx.directory })

  return createPluginInterface({
    pluginConfig,
    hooks,
    tools: toolsResult.tools,
    configHandler: managers.configHandler,
    agents: managers.agents,
    client: ctx.client,
    directory: ctx.directory,
  })
}

export default WeavePlugin
export type { WeaveConfig } from "./config/schema"
export type { WeaveAgentName } from "./agents/types"
