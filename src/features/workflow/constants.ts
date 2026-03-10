/** Root directory for Weave state and plans */
export { WEAVE_DIR } from "../work-state/constants"

/** Directory under .weave/ for workflow instance state */
export const WORKFLOWS_STATE_DIR = ".weave/workflows"

/** File name for individual instance state */
export const INSTANCE_STATE_FILE = "state.json"

/** Pointer file tracking the currently active workflow instance */
export const ACTIVE_INSTANCE_FILE = "active-instance.json"

/** Project-level directory for workflow definitions */
export const WORKFLOWS_DIR_PROJECT = ".opencode/workflows"

/** User-level directory for workflow definitions (under ~/.config/opencode/) */
export const WORKFLOWS_DIR_USER = "workflows"
