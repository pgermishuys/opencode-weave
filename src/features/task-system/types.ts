import { z } from "zod"

/** Task status values */
export const TaskStatus = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  DELETED: "deleted",
} as const

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus]

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "deleted"])

/**
 * Core task object — simplified from OmO's schema.
 * Drops: activeForm, owner, repoURL, parentID (per design decision D4).
 */
export const TaskObjectSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  threadID: z.string(),
  blocks: z.array(z.string()).default([]),
  blockedBy: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type TaskObject = z.infer<typeof TaskObjectSchema>

/** Input schema for task_create tool */
export const TaskCreateInputSchema = z.object({
  subject: z.string().describe("Short title for the task (required)"),
  description: z.string().optional().describe("Detailed description of the task"),
  blocks: z.array(z.string()).optional().describe("Task IDs that this task blocks"),
  blockedBy: z.array(z.string()).optional().describe("Task IDs that block this task"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary key-value metadata"),
})

export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>

/** Input schema for task_update tool */
export const TaskUpdateInputSchema = z.object({
  id: z.string().describe("Task ID to update (required, format: T-{uuid})"),
  subject: z.string().optional().describe("New subject/title"),
  description: z.string().optional().describe("New description"),
  status: TaskStatusSchema.optional().describe("New status"),
  addBlocks: z.array(z.string()).optional().describe("Task IDs to add to blocks (additive, no replacement)"),
  addBlockedBy: z.array(z.string()).optional().describe("Task IDs to add to blockedBy (additive, no replacement)"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Metadata to merge (null values delete keys)"),
})

export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>

/** Input schema for task_list tool (no args needed for PoC) */
export const TaskListInputSchema = z.object({})

export type TaskListInput = z.infer<typeof TaskListInputSchema>
