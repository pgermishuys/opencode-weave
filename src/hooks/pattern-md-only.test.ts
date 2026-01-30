import { describe, it, expect } from "bun:test"
import { checkPatternWrite } from "./pattern-md-only"

describe("checkPatternWrite", () => {
  describe("allows non-pattern agents", () => {
    it("allows loom to write .ts files", () => {
      const result = checkPatternWrite("loom", "write", "/proj/src/foo.ts")
      expect(result.allowed).toBe(true)
    })

    it("allows tapestry to edit source code", () => {
      const result = checkPatternWrite("tapestry", "edit", "/proj/src/bar.ts")
      expect(result.allowed).toBe(true)
    })
  })

  describe("allows non-write tools for pattern", () => {
    it("allows pattern to read any file", () => {
      const result = checkPatternWrite("pattern", "read", "/proj/src/foo.ts")
      expect(result.allowed).toBe(true)
    })

    it("allows pattern to use grep", () => {
      const result = checkPatternWrite("pattern", "grep", "/proj/src/")
      expect(result.allowed).toBe(true)
    })
  })

  describe("allows pattern to write .md in .weave/", () => {
    it("allows writing plan files", () => {
      const result = checkPatternWrite("pattern", "write", "/proj/.weave/plans/my-plan.md")
      expect(result.allowed).toBe(true)
    })

    it("allows editing plan files", () => {
      const result = checkPatternWrite("pattern", "edit", "/proj/.weave/plans/feature.md")
      expect(result.allowed).toBe(true)
    })

    it("allows writing draft files", () => {
      const result = checkPatternWrite("pattern", "write", "/proj/.weave/drafts/notes.md")
      expect(result.allowed).toBe(true)
    })
  })

  describe("blocks pattern from writing code files", () => {
    it("blocks .ts files in src/", () => {
      const result = checkPatternWrite("pattern", "write", "/proj/src/foo.ts")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("only write to .weave/ directory")
    })

    it("blocks .js files anywhere", () => {
      const result = checkPatternWrite("pattern", "edit", "/proj/index.js")
      expect(result.allowed).toBe(false)
    })
  })

  describe("blocks pattern from writing non-.md in .weave/", () => {
    it("blocks .ts files inside .weave/", () => {
      const result = checkPatternWrite("pattern", "write", "/proj/.weave/plans/foo.ts")
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("only write .md files")
    })

    it("blocks .json files inside .weave/", () => {
      const result = checkPatternWrite("pattern", "write", "/proj/.weave/state.json")
      expect(result.allowed).toBe(false)
    })
  })

  describe("handles Windows paths", () => {
    it("allows .md in .weave with backslashes", () => {
      const result = checkPatternWrite("pattern", "write", "C:\\proj\\.weave\\plans\\plan.md")
      expect(result.allowed).toBe(true)
    })

    it("blocks .ts with backslashes", () => {
      const result = checkPatternWrite("pattern", "write", "C:\\proj\\src\\foo.ts")
      expect(result.allowed).toBe(false)
    })
  })
})
