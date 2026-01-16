export { createHooks } from "./create-hooks"
export type { CreatedHooks } from "./create-hooks"

export { checkContextWindow, createContextWindowMonitor } from "./context-window-monitor"
export type {
  ContextWindowState,
  ContextWindowThresholds,
  ContextWindowCheckResult,
  ContextWindowAction,
} from "./context-window-monitor"

export {
  createWriteGuard,
  createWriteGuardState,
  trackFileRead,
  checkWriteAllowed,
} from "./write-existing-file-guard"
export type { WriteGuardState, WriteGuardCheckResult } from "./write-existing-file-guard"

export {
  shouldInjectRules,
  getRulesForFile,
  buildRulesInjection,
  getDirectoryFromFilePath,
  findRulesFile,
  loadRulesForDirectory,
} from "./rules-injector"

export {
  shouldApplyVariant,
  markApplied,
  markSessionCreated,
  clearSession,
  clearAll,
} from "./first-message-variant"

export {
  detectKeywords,
  buildKeywordInjection,
  processMessageForKeywords,
  DEFAULT_KEYWORD_ACTIONS,
} from "./keyword-detector"
export type { KeywordAction } from "./keyword-detector"
