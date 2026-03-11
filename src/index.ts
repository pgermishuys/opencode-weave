import type { Plugin } from "@opencode-ai/plugin"
import { join } from "path"
import { loadWeaveConfig } from "./config/loader"
import { createManagers } from "./create-managers"
import { createTools } from "./create-tools"
import { createHooks } from "./hooks/create-hooks"
import { createPluginInterface } from "./plugin/plugin-interface"
import { createAnalytics } from "./features/analytics"
import { getOrCreateFingerprint } from "./features/analytics/fingerprint"

const WeavePlugin: Plugin = async (ctx) => {
  const pluginConfig = loadWeaveConfig(ctx.directory, ctx)
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? [])
  const isHookEnabled = (name: string) => !disabledHooks.has(name)
  const analyticsEnabled = pluginConfig.analytics?.enabled === true
  const fingerprintEnabled = analyticsEnabled && pluginConfig.analytics?.use_fingerprint === true

  // Generate fingerprint early so it can be injected into agent prompts.
  // Only materialised when both analytics and use_fingerprint are opted in,
  // so no fingerprint context is sent to the model provider by default.
  const fingerprint = fingerprintEnabled ? getOrCreateFingerprint(ctx.directory) : null

  const configDir = join(ctx.directory, ".opencode")
  const toolsResult = await createTools({ ctx, pluginConfig })
  const managers = createManagers({ ctx, pluginConfig, resolveSkills: toolsResult.resolveSkillsFn, fingerprint, configDir })
  const hooks = createHooks({ pluginConfig, isHookEnabled, directory: ctx.directory, analyticsEnabled })

  // Analytics: session tracking + project fingerprinting (fire-and-forget)
  const analytics = analyticsEnabled ? createAnalytics(ctx.directory, fingerprint) : null

  return createPluginInterface({
    pluginConfig,
    hooks,
    tools: toolsResult.tools,
    configHandler: managers.configHandler,
    agents: managers.agents,
    client: ctx.client,
    directory: ctx.directory,
    tracker: analytics?.tracker,
  })
}

export default WeavePlugin
export type { WeaveConfig } from "./config/schema"
export type { WeaveAgentName } from "./agents/types"
