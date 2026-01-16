import type { PluginInput } from "@opencode-ai/plugin"
import type { WeaveConfig } from "./config/schema"
import type { WeaveManagers } from "./create-managers"
import type { ToolsRecord } from "./plugin/types"
import type { LoadedSkill } from "./features/skill-loader/types"
import type { ResolveSkillsFn } from "./agents/agent-builder"
import { loadSkills, createSkillResolver } from "./features/skill-loader"

export interface ToolsResult {
  tools: ToolsRecord
  availableSkills: LoadedSkill[]
  resolveSkillsFn: ResolveSkillsFn
}

export async function createTools(options: {
  ctx: PluginInput
  pluginConfig: WeaveConfig
  managers?: WeaveManagers
}): Promise<ToolsResult> {
  const { ctx, pluginConfig } = options

  const skillResult = loadSkills({
    directory: ctx.directory,
    disabledSkills: pluginConfig.disabled_skills ?? [],
  })

  const resolveSkillsFn = createSkillResolver(skillResult)

  // Tools come from OpenCode's tool system — Weave registers an empty record
  // and relies on the config pipeline (ConfigHandler) to apply tool permissions
  const tools: ToolsRecord = {}

  return {
    tools,
    availableSkills: skillResult.skills,
    resolveSkillsFn,
  }
}
