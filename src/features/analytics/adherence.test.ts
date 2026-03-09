import { describe, it, expect } from "bun:test"
import { calculateAdherence } from "./adherence"

describe("calculateAdherence", () => {
  it("calculates coverage and precision for partial overlap", () => {
    const result = calculateAdherence(
      ["a.ts", "b.ts", "c.ts"],
      ["a.ts", "b.ts", "d.ts"],
    )
    expect(result.coverage).toBeCloseTo(2 / 3)
    expect(result.precision).toBeCloseTo(2 / 3)
    expect(result.plannedFilesChanged).toEqual(["a.ts", "b.ts"])
    expect(result.unplannedChanges).toEqual(["d.ts"])
    expect(result.missedFiles).toEqual(["c.ts"])
    expect(result.totalPlannedFiles).toBe(3)
    expect(result.totalActualFiles).toBe(3)
  })

  it("returns perfect scores for exact match", () => {
    const result = calculateAdherence(
      ["a.ts", "b.ts"],
      ["a.ts", "b.ts"],
    )
    expect(result.coverage).toBe(1)
    expect(result.precision).toBe(1)
    expect(result.plannedFilesChanged).toEqual(["a.ts", "b.ts"])
    expect(result.unplannedChanges).toEqual([])
    expect(result.missedFiles).toEqual([])
  })

  it("returns coverage=1 (vacuous) when no files were planned", () => {
    const result = calculateAdherence([], ["a.ts", "b.ts"])
    expect(result.coverage).toBe(1)
    expect(result.precision).toBe(0)
    expect(result.unplannedChanges).toEqual(["a.ts", "b.ts"])
    expect(result.missedFiles).toEqual([])
  })

  it("returns precision=1 (vacuous) when no files were changed", () => {
    const result = calculateAdherence(["a.ts", "b.ts"], [])
    expect(result.coverage).toBe(0)
    expect(result.precision).toBe(1)
    expect(result.missedFiles).toEqual(["a.ts", "b.ts"])
    expect(result.unplannedChanges).toEqual([])
  })

  it("returns perfect scores when both lists are empty", () => {
    const result = calculateAdherence([], [])
    expect(result.coverage).toBe(1)
    expect(result.precision).toBe(1)
    expect(result.totalPlannedFiles).toBe(0)
    expect(result.totalActualFiles).toBe(0)
  })

  it("handles no overlap between planned and actual", () => {
    const result = calculateAdherence(["a.ts"], ["b.ts"])
    expect(result.coverage).toBe(0)
    expect(result.precision).toBe(0)
    expect(result.missedFiles).toEqual(["a.ts"])
    expect(result.unplannedChanges).toEqual(["b.ts"])
  })

  it("performs case-insensitive comparison", () => {
    const result = calculateAdherence(
      ["SRC/Foo.ts"],
      ["src/foo.ts"],
    )
    expect(result.coverage).toBe(1)
    expect(result.precision).toBe(1)
    expect(result.plannedFilesChanged).toEqual(["SRC/Foo.ts"])
  })

  it("strips leading ./ for comparison", () => {
    const result = calculateAdherence(
      ["./src/foo.ts"],
      ["src/foo.ts"],
    )
    expect(result.coverage).toBe(1)
    expect(result.precision).toBe(1)
  })

  it("handles actual having all planned files plus extras", () => {
    const result = calculateAdherence(
      ["a.ts"],
      ["a.ts", "b.ts", "c.ts"],
    )
    expect(result.coverage).toBe(1)
    expect(result.precision).toBeCloseTo(1 / 3)
    expect(result.unplannedChanges).toEqual(["b.ts", "c.ts"])
  })
})
