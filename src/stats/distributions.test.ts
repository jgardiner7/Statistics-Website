import { describe, expect, it } from "vitest";
import {
  chiSquareSurvival,
  inverseNormalCdf,
  inverseStudentTCdf,
  logGamma,
  regularizedIncompleteBeta,
  studentTCdf
} from "./distributions";

describe("distribution helpers", () => {
  it("computes logGamma for integer inputs", () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 10);
  });

  it("computes regularized incomplete beta for beta(1/2, 1/2)", () => {
    const x = 0.25;
    const expected = (2 / Math.PI) * Math.asin(Math.sqrt(x));
    expect(regularizedIncompleteBeta(0.5, 0.5, x)).toBeCloseTo(expected, 10);
  });

  it("computes t cdf and inverse cdf around known critical points", () => {
    expect(studentTCdf(0, 10)).toBeCloseTo(0.5, 12);
    expect(studentTCdf(2.228, 10)).toBeCloseTo(0.975, 3);
    expect(inverseStudentTCdf(0.975, 10)).toBeCloseTo(2.228, 3);
  });

  it("computes chi-square survival probabilities", () => {
    expect(chiSquareSurvival(3.841458820694124, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareSurvival(0, 3)).toBeCloseTo(1, 12);
  });

  it("computes inverse normal values for common quantiles", () => {
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 12);
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.9599639845, 6);
  });
});
