import type { PluginInput } from "@opencode-ai/plugin"
import type { WeaveConfig } from "./config/schema"
import type { WeaveManagers } from "./create-managers"
import type { ToolsRecord } from "./plugin/types"
import type { LoadedSkill } from "./features/skill-loader/types"
import type { ResolveSkillsFn } from "./agents/agent-builder"
import { loadSkills, createSkillResolver } from "./features/skill-loader"
import { createTaskCreateTool, createTaskUpdateTool, createTaskListTool } from "./features/task-system"
import { log } from "./shared/log"

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

  const skillResult = await loadSkills({
    serverUrl: ctx.serverUrl,
    directory: ctx.directory,
    disabledSkills: pluginConfig.disabled_skills ?? [],
  })

  const resolveSkillsFn = createSkillResolver(skillResult)

  // Tools come from OpenCode's tool system — Weave registers an empty record
  // and relies on the config pipeline (ConfigHandler) to apply tool permissions
  const tools: ToolsRecord = {}

  // Conditionally register task system tools when experimental.task_system is enabled
  if (pluginConfig.experimental?.task_system !== false) {
    const toolOptions = { directory: ctx.directory }
    tools.task_create = createTaskCreateTool(toolOptions)
    tools.task_update = createTaskUpdateTool(toolOptions)
    tools.task_list = createTaskListTool(toolOptions)
    log("[task-system] Registered task tools (task_create, task_update, task_list)")
  }

  return {
    tools,
    availableSkills: skillResult.skills,
    resolveSkillsFn,
  }
}
