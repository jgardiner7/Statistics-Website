import { describe, expect, it } from "vitest";
import {
  chiSquareTest,
  kendallCorrelationTest,
  pearsonCorrelationTest,
  spearmanCorrelationTest,
  welchTTest
} from "./hypothesis";

function observationsFromCounts(
  counts: number[][],
  rowLabels: string[],
  columnLabels: string[]
) {
  const observations: Array<{ rowCategory: string; columnCategory: string }> = [];
  for (let r = 0; r < counts.length; r += 1) {
    for (let c = 0; c < counts[r].length; c += 1) {
      const count = counts[r][c];
      for (let i = 0; i < count; i += 1) {
        observations.push({
          rowCategory: rowLabels[r],
          columnCategory: columnLabels[c]
        });
      }
    }
  }
  return observations;
}

describe("welchTTest", () => {
  it("computes expected statistics on a known sample", () => {
    const result = welchTTest([5, 6, 7, 8, 9], [1, 2, 3, 4, 5]);

    expect(result.meanDifference).toBeCloseTo(4, 10);
    expect(result.tStatistic).toBeCloseTo(4, 10);
    expect(result.degreesOfFreedom).toBeCloseTo(8, 10);
    expect(result.pValue).toBeLessThan(0.01);
    expect(result.effectSize).toBeCloseTo(2.5298, 3);
    expect(result.ciLower).toBeLessThan(result.meanDifference);
    expect(result.ciUpper).toBeGreaterThan(result.meanDifference);
  });

  it("requires at least two values in each group", () => {
    expect(() => welchTTest([1], [1, 2])).toThrow("at least two values");
  });
});

describe("pearsonCorrelationTest", () => {
  it("detects perfect positive correlation", () => {
    const result = pearsonCorrelationTest(
      [1, 2, 3, 4, 5],
      [2, 4, 6, 8, 10]
    );

    expect(result.correlation).toBeCloseTo(1, 10);
    expect(result.method).toBe("pearson");
    expect(result.pValue).toBeLessThan(1e-10);
    expect(result.degreesOfFreedom).toBe(3);
    expect(result.ciLower).toBeLessThanOrEqual(1);
    expect(result.ciUpper).toBeLessThanOrEqual(1);
  });

  it("rejects constant columns", () => {
    expect(() =>
      pearsonCorrelationTest([1, 1, 1], [2, 3, 4])
    ).toThrow("zero variance");
  });
});

describe("spearmanCorrelationTest", () => {
  it("detects perfect monotonic association", () => {
    const result = spearmanCorrelationTest([1, 2, 3, 4], [10, 20, 30, 40]);

    expect(result.method).toBe("spearman");
    expect(result.correlation).toBeCloseTo(1, 10);
    expect(result.pValue).toBeLessThan(0.05);
  });
});

describe("kendallCorrelationTest", () => {
  it("returns a high tau for monotonic data", () => {
    const result = kendallCorrelationTest([1, 2, 3, 4, 5], [3, 6, 9, 12, 15]);

    expect(result.method).toBe("kendall");
    expect(result.correlation).toBeCloseTo(1, 10);
    expect(result.pValue).toBeLessThan(0.05);
  });
});

describe("chiSquareTest", () => {
  it("returns zero association for independent counts", () => {
    const observations = observationsFromCounts(
      [
        [15, 15],
        [15, 15]
      ],
      ["A", "B"],
      ["X", "Y"]
    );

    const result = chiSquareTest(observations);
    expect(result.chiSquare).toBeCloseTo(0, 12);
    expect(result.pValue).toBeCloseTo(1, 12);
    expect(result.cramersV).toBeCloseTo(0, 12);
  });

  it("detects strong association", () => {
    const observations = observationsFromCounts(
      [
        [20, 0],
        [0, 20]
      ],
      ["A", "B"],
      ["X", "Y"]
    );

    const result = chiSquareTest(observations);
    expect(result.degreesOfFreedom).toBe(1);
    expect(result.chiSquare).toBeCloseTo(40, 8);
    expect(result.pValue).toBeLessThan(1e-8);
    expect(result.cramersV).toBeCloseTo(1, 8);
  });
});
