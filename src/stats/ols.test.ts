import { describe, expect, it } from "vitest";
import { fitOLS } from "./ols";

describe("fitOLS", () => {
  it("fits a simple line with intercept", () => {
    const x = [[1], [2], [3], [4], [5]];
    const y = [3, 5, 7, 9, 11];

    const result = fitOLS(y, x, { intercept: true });

    expect(result.coefficients[0]).toBeCloseTo(1, 6);
    expect(result.coefficients[1]).toBeCloseTo(2, 6);
    expect(result.r2).toBeCloseTo(1, 8);
    expect(result.adjustedR2).toBeCloseTo(1, 8);
    expect(result.n).toBe(5);
    expect(result.degreesOfFreedom).toBe(3);
    expect(result.standardErrors[1]).toBeCloseTo(0, 8);
    expect(result.pValues[1]).toBeCloseTo(0, 8);
    expect(result.residuals.every((value) => Math.abs(value) < 1e-8)).toBe(true);
  });

  it("fits a noisy multivariate model with finite inferential stats", () => {
    const x = [
      [1, 0],
      [2, 1],
      [3, 4],
      [4, 2],
      [5, 3],
      [6, 5],
      [7, 1],
      [8, 4],
      [9, 2],
      [10, 3]
    ];
    const y = [3.1, 8.8, 19.0, 15.1, 20.2, 28.2, 17.9, 29.3, 24.9, 29.1];

    const result = fitOLS(y, x, { intercept: true });

    expect(result.coefficients).toHaveLength(3);
    expect(result.standardErrors).toHaveLength(3);
    expect(result.tStatistics).toHaveLength(3);
    expect(result.pValues).toHaveLength(3);
    expect(result.coefficients[1]).toBeGreaterThan(1.7);
    expect(result.coefficients[1]).toBeLessThan(2.2);
    expect(result.coefficients[2]).toBeGreaterThan(2.8);
    expect(result.coefficients[2]).toBeLessThan(3.3);
    expect(result.r2).toBeGreaterThan(0.99);
    expect(result.adjustedR2).toBeGreaterThan(0.99);
    expect(result.degreesOfFreedom).toBe(7);
    expect(result.leverage).toHaveLength(10);
    expect(result.standardizedResiduals).toHaveLength(10);
    expect(result.cooksDistance).toHaveLength(10);
    const leverageSum = result.leverage.reduce((acc, value) => acc + value, 0);
    expect(leverageSum).toBeCloseTo(result.coefficients.length, 4);
    for (const pValue of result.pValues) {
      expect(Number.isFinite(pValue)).toBe(true);
      expect(pValue).toBeGreaterThanOrEqual(0);
      expect(pValue).toBeLessThanOrEqual(1);
    }
  });

  it("supports intercept-free models", () => {
    const x = [[1], [2], [3], [4], [5], [6]];
    const y = [2, 4, 6, 8, 10, 12];

    const result = fitOLS(y, x, { intercept: false });

    expect(result.coefficients).toHaveLength(1);
    expect(result.coefficients[0]).toBeCloseTo(2, 8);
    expect(result.degreesOfFreedom).toBe(5);
  });

  it("rejects singular predictor matrices", () => {
    const x = [
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
      [5, 10]
    ];
    const y = [2, 4, 6, 8, 10];

    expect(() => fitOLS(y, x, { intercept: false })).toThrow("Singular matrix");
  });

  it("requires n > parameter count for inference-ready output", () => {
    const x = [
      [1, 2],
      [2, 3],
      [3, 4]
    ];
    const y = [2, 3, 4];

    expect(() => fitOLS(y, x, { intercept: true })).toThrow("Not enough rows");
  });
});
