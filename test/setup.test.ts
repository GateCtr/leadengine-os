import { describe, it, expect } from "vitest";
import fc from "fast-check";

describe("Project setup", () => {
  it("should have vitest configured correctly", () => {
    expect(true).toBe(true);
  });

  it("should have fast-check available", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (n) => {
        return n >= 0 && n <= 100;
      }),
      { numRuns: 100 },
    );
  });
});
