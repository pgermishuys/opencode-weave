import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join, resolve, sep } from "path"
import { tmpdir } from "os"
import { validatePlan } from "./validation"
import { PLANS_DIR } from "./constants"

let testDir: string
let plansDir: string

/** A minimal but fully valid plan file */
const VALID_PLAN = `# My Plan

## TL;DR
> **Summary**: Implement something useful.
> **Estimated Effort**: Medium

## Context
### Original Request
A user request.

### Key Findings
1. Finding one.

## Objectives
### Core Objective
Do the thing.

## TODOs

- [ ] 1. **First task**
  **What**: Create the feature
  **Files**: src/features/my-feature.ts (new)
  **Acceptance**: Feature works

- [ ] 2. **Second task**
  **What**: Write tests
  **Files**: src/features/my-feature.test.ts (new)
  **Acceptance**: Tests pass

## Verification
- [ ] All tests pass
- [ ] Build succeeds
`

function writePlan(name: string, content: string): string {
  const planPath = join(plansDir, `${name}.md`)
  writeFileSync(planPath, content, "utf-8")
  return planPath
}

beforeEach(() => {
  testDir = join(tmpdir(), `weave-val-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  plansDir = join(testDir, PLANS_DIR)
  mkdirSync(plansDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

// ─── Non-existent plan file ───────────────────────────────────────────────────

describe("non-existent plan file", () => {
  it("returns an error result for a missing file within the plans directory", () => {
    const result = validatePlan(join(plansDir, "nonexistent.md"), testDir)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].category).toBe("structure")
    expect(result.errors[0].message).toContain("not found")
  })
})

// ─── Path confinement ─────────────────────────────────────────────────────────

describe("path confinement", () => {
  it("rejects a planPath outside the .weave/plans/ directory", () => {
    const result = validatePlan("/etc/shadow", testDir)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain("outside the allowed directory")
  })

  it("rejects a planPath using ../ traversal to escape plans dir", () => {
    const result = validatePlan(join(plansDir, "..", "..", "etc", "passwd"), testDir)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain("outside the allowed directory")
  })

  it("accepts a planPath within the .weave/plans/ directory", () => {
    const planPath = writePlan("safe-plan", VALID_PLAN)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
  })

  it("accepts a planPath whose absolute path uses the platform separator", () => {
    const planPath = writePlan("platform-sep", VALID_PLAN)
    // Ensure the resolved path uses native separators (backslash on Windows)
    const resolved = resolve(planPath)
    expect(resolved).toContain(sep)
    const result = validatePlan(resolved, testDir)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ─── Valid plan ───────────────────────────────────────────────────────────────

describe("valid plan", () => {
  it("passes with no errors and no warnings", () => {
    const planPath = writePlan("valid", VALID_PLAN)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("accepts a fully completed plan (only - [x] checkboxes)", () => {
    const content = VALID_PLAN
      .replace(/- \[ \] 1\./g, "- [x] 1.")
      .replace(/- \[ \] 2\./g, "- [x] 2.")
      .replace(/- \[ \] All tests pass/, "- [x] All tests pass")
      .replace(/- \[ \] Build succeeds/, "- [x] Build succeeds")
    const planPath = writePlan("completed", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ─── Structure validation ────────────────────────────────────────────────────

describe("structure validation — required sections", () => {
  it("produces an error when ## TL;DR is missing", () => {
    const content = VALID_PLAN.replace(/## TL;DR[\s\S]*?(?=## Context)/, "")
    const planPath = writePlan("no-tldr", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(false)
    const err = result.errors.find((e) => e.message.includes("TL;DR"))
    expect(err).toBeDefined()
    expect(err!.category).toBe("structure")
  })

  it("produces an error when ## TODOs is missing", () => {
    const content = VALID_PLAN.replace(/## TODOs[\s\S]*?(?=## Verification)/, "")
    const planPath = writePlan("no-todos", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(false)
    const err = result.errors.find((e) => e.message.includes("TODOs"))
    expect(err).toBeDefined()
    expect(err!.category).toBe("structure")
  })

  it("produces an error when ## Verification is missing", () => {
    const content = VALID_PLAN.replace(/## Verification[\s\S]*$/, "")
    const planPath = writePlan("no-verification", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(false)
    const err = result.errors.find((e) => e.message.includes("Verification"))
    expect(err).toBeDefined()
    expect(err!.category).toBe("structure")
  })
})

describe("structure validation — optional sections", () => {
  it("produces a warning when ## Context is missing", () => {
    const content = VALID_PLAN.replace(/## Context[\s\S]*?(?=## Objectives)/, "")
    const planPath = writePlan("no-context", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true) // warnings only
    const warn = result.warnings.find((w) => w.message.includes("Context"))
    expect(warn).toBeDefined()
    expect(warn!.category).toBe("structure")
    expect(warn!.severity).toBe("warning")
  })

  it("produces a warning when ## Objectives is missing", () => {
    const content = VALID_PLAN.replace(/## Objectives[\s\S]*?(?=## TODOs)/, "")
    const planPath = writePlan("no-objectives", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    const warn = result.warnings.find((w) => w.message.includes("Objectives"))
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe("warning")
  })
})

// ─── Checkbox validation ──────────────────────────────────────────────────────

describe("checkbox validation", () => {
  it("produces an error when ## TODOs has no checkboxes", () => {
    const content = VALID_PLAN.replace(
      /- \[ \] 1\. \*\*First task\*\*[\s\S]*?(?=- \[ \] 2\.)/,
      ""
    ).replace(/- \[ \] 2\. \*\*Second task\*\*[\s\S]*?(?=## Verification)/, "")
    const planPath = writePlan("no-checkboxes", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(false)
    const err = result.errors.find((e) => e.category === "checkboxes")
    expect(err).toBeDefined()
    expect(err!.message).toContain("no checkboxes")
  })

  it("produces a warning for a task missing **What** sub-field", () => {
    const content = VALID_PLAN.replace("  **What**: Create the feature\n", "")
    const planPath = writePlan("missing-what", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    const warn = result.warnings.find((w) => w.message.includes("**What**"))
    expect(warn).toBeDefined()
    expect(warn!.category).toBe("checkboxes")
  })

  it("produces a warning for a task missing **Files** sub-field", () => {
    const content = VALID_PLAN.replace(
      "  **Files**: src/features/my-feature.ts (new)\n",
      ""
    )
    const planPath = writePlan("missing-files", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    const warn = result.warnings.find((w) => w.message.includes("**Files**"))
    expect(warn).toBeDefined()
    expect(warn!.category).toBe("checkboxes")
  })

  it("produces a warning for a task missing **Acceptance** sub-field", () => {
    const content = VALID_PLAN.replace("  **Acceptance**: Feature works\n", "")
    const planPath = writePlan("missing-acceptance", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    const warn = result.warnings.find((w) => w.message.includes("**Acceptance**"))
    expect(warn).toBeDefined()
    expect(warn!.category).toBe("checkboxes")
  })
})

// ─── File reference validation ────────────────────────────────────────────────

describe("file reference validation", () => {
  it("passes when a referenced file exists in projectDir", () => {
    // Create a real file in testDir
    writeFileSync(join(testDir, "existing.ts"), "// exists", "utf-8")
    const content = VALID_PLAN.replace(
      "  **Files**: src/features/my-feature.ts (new)\n",
      "  **Files**: existing.ts\n"
    )
    const planPath = writePlan("existing-ref", content)
    const result = validatePlan(planPath, testDir)
    // Should not produce a file-references warning for the existing file
    const fileWarn = result.warnings.filter((w) => w.category === "file-references")
    expect(fileWarn).toHaveLength(0)
  })

  it("produces a warning for a non-existent file without (new) marker", () => {
    const content = VALID_PLAN.replace(
      "  **Files**: src/features/my-feature.ts (new)\n",
      "  **Files**: src/nonexistent/thing.ts\n"
    )
    const planPath = writePlan("nonexistent-ref", content)
    const result = validatePlan(planPath, testDir)
    const warn = result.warnings.find((w) => w.category === "file-references")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("thing.ts")
  })

  it("skips existence check for files marked with (new)", () => {
    // The valid plan already uses (new) — should have no file-references warning
    const planPath = writePlan("new-marker", VALID_PLAN)
    const result = validatePlan(planPath, testDir)
    const fileWarn = result.warnings.filter((w) => w.category === "file-references")
    expect(fileWarn).toHaveLength(0)
  })

  it("skips existence check for files with Create prefix", () => {
    const content = VALID_PLAN.replace(
      "  **Files**: src/features/my-feature.ts (new)\n",
      "  **Files**: Create src/features/new-thing.ts\n"
    )
    const planPath = writePlan("create-prefix", content)
    const result = validatePlan(planPath, testDir)
    const fileWarn = result.warnings.filter((w) => w.category === "file-references")
    expect(fileWarn).toHaveLength(0)
  })

  it("rejects absolute file paths in **Files** references", () => {
    const content = VALID_PLAN.replace(
      "  **Files**: src/features/my-feature.ts (new)\n",
      "  **Files**: /etc/shadow\n"
    )
    const planPath = writePlan("abs-path", content)
    const result = validatePlan(planPath, testDir)
    const warn = result.warnings.find((w) => w.category === "file-references")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("Absolute file path")
  })

  it("rejects ../ traversal in **Files** references", () => {
    const content = VALID_PLAN.replace(
      "  **Files**: src/features/my-feature.ts (new)\n",
      "  **Files**: ../../etc/passwd\n"
    )
    const planPath = writePlan("traversal-ref", content)
    const result = validatePlan(planPath, testDir)
    const warn = result.warnings.find((w) => w.category === "file-references")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("path traversal")
  })

  it("accepts file references within projectDir when paths use native separators", () => {
    writeFileSync(join(testDir, "lib.ts"), "// exists", "utf-8")
    const content = VALID_PLAN.replace(
      "  **Files**: src/features/my-feature.ts (new)\n",
      "  **Files**: lib.ts\n"
    )
    const planPath = writePlan("native-sep-ref", content)
    const result = validatePlan(resolve(planPath), resolve(testDir))
    const fileWarn = result.warnings.filter((w) => w.category === "file-references")
    expect(fileWarn).toHaveLength(0)
  })
})

// ─── Numbering validation ─────────────────────────────────────────────────────

describe("numbering validation", () => {
  it("produces an error for duplicate task numbers", () => {
    const content = VALID_PLAN.replace("- [ ] 2. **Second task**", "- [ ] 1. **Second task**")
    const planPath = writePlan("duplicate-num", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(false)
    const err = result.errors.find((e) => e.category === "numbering")
    expect(err).toBeDefined()
    expect(err!.message).toContain("Duplicate task number: 1")
  })

  it("produces a warning for a gap in task numbering", () => {
    const content = VALID_PLAN.replace("- [ ] 2. **Second task**", "- [ ] 4. **Second task**")
    const planPath = writePlan("gap-num", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    const warn = result.warnings.find((w) => w.category === "numbering")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("Gap")
  })

  it("accepts unnumbered tasks without errors or numbering warnings", () => {
    const content = VALID_PLAN
      .replace("- [ ] 1. **First task**", "- [ ] **First task**")
      .replace("- [ ] 2. **Second task**", "- [ ] **Second task**")
    const planPath = writePlan("unnumbered", content)
    const result = validatePlan(planPath, testDir)
    const numWarn = result.warnings.filter((w) => w.category === "numbering")
    const numErr = result.errors.filter((e) => e.category === "numbering")
    expect(numWarn).toHaveLength(0)
    expect(numErr).toHaveLength(0)
  })
})

// ─── Effort estimate validation ───────────────────────────────────────────────

describe("effort estimate validation", () => {
  it("produces a warning when Estimated Effort is missing", () => {
    const content = VALID_PLAN.replace("> **Estimated Effort**: Medium\n", "")
    const planPath = writePlan("no-effort", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    const warn = result.warnings.find((w) => w.category === "effort-estimate")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("Estimated Effort")
  })

  it("produces a warning for an invalid effort value", () => {
    const content = VALID_PLAN.replace("> **Estimated Effort**: Medium", "> **Estimated Effort**: Huge")
    const planPath = writePlan("bad-effort", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    const warn = result.warnings.find((w) => w.category === "effort-estimate")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("Huge")
  })

  it("accepts all valid effort values", () => {
    for (const value of ["Quick", "Short", "Medium", "Large", "XL"]) {
      const content = VALID_PLAN.replace("> **Estimated Effort**: Medium", `> **Estimated Effort**: ${value}`)
      const planPath = writePlan(`effort-${value.toLowerCase()}`, content)
      const result = validatePlan(planPath, testDir)
      const effortWarns = result.warnings.filter((w) => w.category === "effort-estimate")
      expect(effortWarns).toHaveLength(0)
    }
  })
})

// ─── Verification section validation ─────────────────────────────────────────

describe("verification section validation", () => {
  it("produces an error when Verification section has no checkboxes", () => {
    const content = VALID_PLAN.replace(
      "## Verification\n- [ ] All tests pass\n- [ ] Build succeeds\n",
      "## Verification\nNo checkboxes here.\n"
    )
    const planPath = writePlan("empty-verification", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(false)
    const err = result.errors.find((e) => e.category === "verification")
    expect(err).toBeDefined()
    expect(err!.message).toContain("no checkboxes")
  })

  it("accepts a Verification section with only checked items", () => {
    const content = VALID_PLAN.replace(
      "- [ ] All tests pass\n- [ ] Build succeeds",
      "- [x] All tests pass\n- [x] Build succeeds"
    )
    const planPath = writePlan("checked-verification", content)
    const result = validatePlan(planPath, testDir)
    const verErr = result.errors.filter((e) => e.category === "verification")
    expect(verErr).toHaveLength(0)
  })
})

// ─── ValidationResult shape ───────────────────────────────────────────────────

describe("ValidationResult structure", () => {
  it("returns valid:false when there are errors", () => {
    const planPath = writePlan("bad", "# Bad plan\n## TODOs\n- [ ] task\n")
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("returns valid:true when there are only warnings", () => {
    // Missing optional sections + missing effort estimate = warnings only
    const content = `## TL;DR
> **Summary**: Something
> **Estimated Effort**: Medium

## TODOs
- [ ] 1. Task
  **What**: something
  **Files**: src/new.ts (new)
  **Acceptance**: works

## Verification
- [ ] done
`
    const planPath = writePlan("warnings-only", content)
    const result = validatePlan(planPath, testDir)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    // Context and Objectives are missing → warnings
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
