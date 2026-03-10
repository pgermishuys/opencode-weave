export type {
  StepType,
  CompletionMethod,
  StepStatus,
  WorkflowStatus,
  OnRejectAction,
  ArtifactRef,
  StepArtifacts,
  CompletionConfig,
  WorkflowStepDefinition,
  WorkflowDefinition,
  StepState,
  WorkflowInstance,
  ActiveInstancePointer,
} from "./types"

export {
  WORKFLOWS_STATE_DIR,
  INSTANCE_STATE_FILE,
  ACTIVE_INSTANCE_FILE,
  WORKFLOWS_DIR_PROJECT,
  WORKFLOWS_DIR_USER,
} from "./constants"

export {
  generateInstanceId,
  generateSlug,
  createWorkflowInstance,
  readWorkflowInstance,
  writeWorkflowInstance,
  readActiveInstance,
  setActiveInstance,
  clearActiveInstance,
  getActiveWorkflowInstance,
  listInstances,
  appendInstanceSessionId,
} from "./storage"

export type { DiscoveredWorkflow } from "./discovery"
export { loadWorkflowDefinition, discoverWorkflows } from "./discovery"

export { resolveTemplate, buildContextHeader, composeStepPrompt } from "./context"

export type { CompletionCheckResult, CompletionContext } from "./completion"
export { checkStepCompletion } from "./completion"

export type { EngineAction } from "./engine"
export {
  startWorkflow,
  checkAndAdvance,
  pauseWorkflow,
  resumeWorkflow,
  skipStep,
  abortWorkflow,
} from "./engine"

export { WORKFLOW_CONTINUATION_MARKER } from "./hook"
export type { WorkflowHookResult } from "./hook"
export { parseWorkflowArgs, handleRunWorkflow, checkWorkflowContinuation } from "./hook"

export type { WorkflowCommandResult } from "./commands"
export { handleWorkflowCommand } from "./commands"
