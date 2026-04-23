import {
  chiSquareSurvival,
  inverseNormalCdf,
  inverseStudentTCdf,
  studentTCdf
} from "./distributions";

export type CorrelationMethod = "pearson" | "kendall" | "spearman";

export interface WelchTTestResult {
  kind: "welch_t_test";
  sampleSizeA: number;
  sampleSizeB: number;
  meanA: number;
  meanB: number;
  varianceA: number;
  varianceB: number;
  meanDifference: number;
  standardError: number;
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  confidenceLevel: number;
  ciLower: number;
  ciUpper: number;
  effectSize: number;
}

export interface PearsonCorrelationResult {
  kind: "pearson_correlation";
  method: CorrelationMethod;
  sampleSize: number;
  correlation: number;
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  confidenceLevel: number;
  ciLower: number;
  ciUpper: number;
}

export interface ChiSquareTestResult {
  kind: "chi_square_test";
  sampleSize: number;
  degreesOfFreedom: number;
  chiSquare: number;
  pValue: number;
  cramersV: number;
  rowLabels: string[];
  columnLabels: string[];
  observed: number[][];
  expected: number[][];
  rowTotals: number[];
  columnTotals: number[];
}

export interface ContingencyObservation {
  rowCategory: string;
  columnCategory: string;
}

function mean(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function sampleVariance(values: number[], valueMean: number): number {
  if (values.length < 2) {
    throw new Error("At least two values are required for sample variance.");
  }
  const sumSquares = values.reduce(
    (acc, value) => acc + (value - valueMean) ** 2,
    0
  );
  return sumSquares / (values.length - 1);
}

function assertConfidenceLevel(confidenceLevel: number): void {
  if (
    !Number.isFinite(confidenceLevel) ||
    confidenceLevel <= 0 ||
    confidenceLevel >= 1
  ) {
    throw new Error("confidenceLevel must be between 0 and 1.");
  }
}

function clampProbability(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function pairCount(size: number): number {
  return (size * (size - 1)) / 2;
}

function rankWithAverageTies(values: number[]): number[] {
  const ranked = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);

  let cursor = 0;
  while (cursor < ranked.length) {
    let end = cursor + 1;
    while (end < ranked.length && ranked[end].value === ranked[cursor].value) {
      end += 1;
    }
    const averageRank = (cursor + 1 + end) / 2;
    for (let i = cursor; i < end; i += 1) {
      result[ranked[i].index] = averageRank;
    }
    cursor = end;
  }
  return result;
}

function mergeCountInversions(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  const scratch = [...values];

  function divideAndCount(left: number, right: number): number {
    if (right - left <= 1) {
      return 0;
    }
    const middle = Math.floor((left + right) / 2);
    let inversions = divideAndCount(left, middle) + divideAndCount(middle, right);

    let i = left;
    let j = middle;
    let k = left;
    while (i < middle && j < right) {
      if (values[i] <= values[j]) {
        scratch[k] = values[i];
        i += 1;
      } else {
        scratch[k] = values[j];
        inversions += middle - i;
        j += 1;
      }
      k += 1;
    }
    while (i < middle) {
      scratch[k] = values[i];
      i += 1;
      k += 1;
    }
    while (j < right) {
      scratch[k] = values[j];
      j += 1;
      k += 1;
    }
    for (let m = left; m < right; m += 1) {
      values[m] = scratch[m];
    }
    return inversions;
  }

  return divideAndCount(0, values.length);
}

export function welchTTest(
  sampleA: number[],
  sampleB: number[],
  confidenceLevel = 0.95
): WelchTTestResult {
  assertConfidenceLevel(confidenceLevel);
  if (sampleA.length < 2 || sampleB.length < 2) {
    throw new Error("Welch t-test requires at least two values in each group.");
  }

  const meanA = mean(sampleA);
  const meanB = mean(sampleB);
  const varianceA = sampleVariance(sampleA, meanA);
  const varianceB = sampleVariance(sampleB, meanB);
  const termA = varianceA / sampleA.length;
  const termB = varianceB / sampleB.length;
  const standardError = Math.sqrt(termA + termB);
  if (!Number.isFinite(standardError) || standardError <= 0) {
    throw new Error(
      "Welch t-test could not be computed because pooled standard error was zero."
    );
  }

  const meanDifference = meanA - meanB;
  const tStatistic = meanDifference / standardError;
  const numerator = (termA + termB) ** 2;
  const denominator =
    termA ** 2 / (sampleA.length - 1) + termB ** 2 / (sampleB.length - 1);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new Error("Welch t-test degrees of freedom could not be computed.");
  }
  const degreesOfFreedom = numerator / denominator;

  const cdf = studentTCdf(Math.abs(tStatistic), degreesOfFreedom);
  const pValue = clampProbability(2 * (1 - cdf));
  const alpha = 1 - confidenceLevel;
  const critical = inverseStudentTCdf(1 - alpha / 2, degreesOfFreedom);
  const ciLower = meanDifference - critical * standardError;
  const ciUpper = meanDifference + critical * standardError;

  const pooledVarianceNumerator =
    (sampleA.length - 1) * varianceA + (sampleB.length - 1) * varianceB;
  const pooledVarianceDenominator = sampleA.length + sampleB.length - 2;
  const pooledVariance =
    pooledVarianceDenominator > 0
      ? pooledVarianceNumerator / pooledVarianceDenominator
      : 0;
  const pooledStdDev =
    pooledVariance > 0 ? Math.sqrt(pooledVariance) : 0;
  const effectSize =
    pooledStdDev > 0 ? meanDifference / pooledStdDev : 0;

  return {
    kind: "welch_t_test",
    sampleSizeA: sampleA.length,
    sampleSizeB: sampleB.length,
    meanA,
    meanB,
    varianceA,
    varianceB,
    meanDifference,
    standardError,
    tStatistic,
    degreesOfFreedom,
    pValue,
    confidenceLevel,
    ciLower,
    ciUpper,
    effectSize
  };
}

export function pearsonCorrelationTest(
  x: number[],
  y: number[],
  confidenceLevel = 0.95
): PearsonCorrelationResult {
  assertConfidenceLevel(confidenceLevel);
  if (x.length !== y.length) {
    throw new Error("x and y must contain the same number of values.");
  }
  if (x.length < 3) {
    throw new Error("Pearson correlation requires at least three paired values.");
  }

  const xMean = mean(x);
  const yMean = mean(y);
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    sumXX += dx * dx;
    sumYY += dy * dy;
    sumXY += dx * dy;
  }

  if (sumXX <= 0 || sumYY <= 0) {
    throw new Error(
      "Pearson correlation cannot be computed when either variable has zero variance."
    );
  }

  const rawCorrelation = sumXY / Math.sqrt(sumXX * sumYY);
  const correlation = Math.max(-1, Math.min(1, rawCorrelation));
  const degreesOfFreedom = x.length - 2;

  const tStatistic =
    Math.abs(correlation) >= 1
      ? Number.POSITIVE_INFINITY
      : correlation * Math.sqrt(degreesOfFreedom / (1 - correlation * correlation));
  const pValue =
    Number.isFinite(tStatistic)
      ? clampProbability(2 * (1 - studentTCdf(Math.abs(tStatistic), degreesOfFreedom)))
      : 0;

  if (x.length <= 3) {
    return {
      kind: "pearson_correlation",
      method: "pearson",
      sampleSize: x.length,
      correlation,
      tStatistic,
      degreesOfFreedom,
      pValue,
      confidenceLevel,
      ciLower: -1,
      ciUpper: 1
    };
  }

  const alpha = 1 - confidenceLevel;
  const zCritical = inverseNormalCdf(1 - alpha / 2);
  const fisherZ = 0.5 * Math.log((1 + correlation) / (1 - correlation));
  const standardError = 1 / Math.sqrt(x.length - 3);
  const lowerZ = fisherZ - zCritical * standardError;
  const upperZ = fisherZ + zCritical * standardError;
  const ciLower = Math.tanh(lowerZ);
  const ciUpper = Math.tanh(upperZ);

  return {
    kind: "pearson_correlation",
    method: "pearson",
    sampleSize: x.length,
    correlation,
    tStatistic,
    degreesOfFreedom,
    pValue,
    confidenceLevel,
    ciLower,
    ciUpper
  };
}

export function spearmanCorrelationTest(
  x: number[],
  y: number[],
  confidenceLevel = 0.95
): PearsonCorrelationResult {
  if (x.length !== y.length) {
    throw new Error("x and y must contain the same number of values.");
  }
  const rankedX = rankWithAverageTies(x);
  const rankedY = rankWithAverageTies(y);
  const stats = pearsonCorrelationTest(rankedX, rankedY, confidenceLevel);
  return {
    ...stats,
    method: "spearman"
  };
}

export function kendallCorrelationTest(
  x: number[],
  y: number[],
  confidenceLevel = 0.95
): PearsonCorrelationResult {
  assertConfidenceLevel(confidenceLevel);
  if (x.length !== y.length) {
    throw new Error("x and y must contain the same number of values.");
  }
  if (x.length < 3) {
    throw new Error("Kendall correlation requires at least three paired values.");
  }

  const pairs = x
    .map((xValue, index) => ({
      x: xValue,
      y: y[index]
    }))
    .sort((a, b) => {
      if (a.x !== b.x) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });

  let tiedX = 0;
  let tiedY = 0;
  let tiedBoth = 0;
  const ySorted = pairs.map((pair) => pair.y);

  let start = 0;
  while (start < pairs.length) {
    let end = start + 1;
    while (end < pairs.length && pairs[end].x === pairs[start].x) {
      end += 1;
    }
    const groupSize = end - start;
    tiedX += pairCount(groupSize);
    let overlapStart = start;
    while (overlapStart < end) {
      let overlapEnd = overlapStart + 1;
      while (
        overlapEnd < end &&
        pairs[overlapEnd].x === pairs[overlapStart].x &&
        pairs[overlapEnd].y === pairs[overlapStart].y
      ) {
        overlapEnd += 1;
      }
      tiedBoth += pairCount(overlapEnd - overlapStart);
      overlapStart = overlapEnd;
    }
    start = end;
  }

  const byY = [...pairs].sort((a, b) => a.y - b.y);
  start = 0;
  while (start < byY.length) {
    let end = start + 1;
    while (end < byY.length && byY[end].y === byY[start].y) {
      end += 1;
    }
    tiedY += pairCount(end - start);
    start = end;
  }

  const totalPairs = pairCount(pairs.length);
  const discordant = mergeCountInversions([...ySorted]);
  const concordantMinusDiscordant =
    totalPairs - tiedX - tiedY + tiedBoth - 2 * discordant;
  const denominator = Math.sqrt((totalPairs - tiedX) * (totalPairs - tiedY));
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new Error(
      "Kendall correlation cannot be computed when either variable has no usable rank variance."
    );
  }
  const correlation = Math.max(
    -1,
    Math.min(1, concordantMinusDiscordant / denominator)
  );

  const variance = (2 * (2 * x.length + 5)) / (9 * x.length * (x.length - 1));
  const standardError = Math.sqrt(Math.max(variance, Number.EPSILON));
  const zStatistic = correlation / standardError;
  const pValue = clampProbability(2 * (1 - studentTCdf(Math.abs(zStatistic), 1e6)));
  const alpha = 1 - confidenceLevel;
  const zCritical = inverseNormalCdf(1 - alpha / 2);
  const ciLower = Math.max(-1, correlation - zCritical * standardError);
  const ciUpper = Math.min(1, correlation + zCritical * standardError);

  return {
    kind: "pearson_correlation",
    method: "kendall",
    sampleSize: x.length,
    correlation,
    tStatistic: zStatistic,
    degreesOfFreedom: x.length - 2,
    pValue,
    confidenceLevel,
    ciLower,
    ciUpper
  };
}

export function chiSquareTest(
  observations: ContingencyObservation[]
): ChiSquareTestResult {
  if (observations.length === 0) {
    throw new Error("Chi-square test requires at least one observation.");
  }

  const rowLabelSet = new Set<string>();
  const columnLabelSet = new Set<string>();
  for (const observation of observations) {
    rowLabelSet.add(observation.rowCategory);
    columnLabelSet.add(observation.columnCategory);
  }

  const rowLabels = Array.from(rowLabelSet.values()).sort((a, b) =>
    a.localeCompare(b)
  );
  const columnLabels = Array.from(columnLabelSet.values()).sort((a, b) =>
    a.localeCompare(b)
  );
  if (rowLabels.length < 2 || columnLabels.length < 2) {
    throw new Error(
      "Chi-square test requires at least two categories in each dimension."
    );
  }

  const rowIndex = new Map(rowLabels.map((label, index) => [label, index]));
  const columnIndex = new Map(
    columnLabels.map((label, index) => [label, index])
  );
  const observed = rowLabels.map(() => columnLabels.map(() => 0));

  for (const observation of observations) {
    const r = rowIndex.get(observation.rowCategory);
    const c = columnIndex.get(observation.columnCategory);
    if (r === undefined || c === undefined) {
      continue;
    }
    observed[r][c] += 1;
  }

  const rowTotals = observed.map((row) =>
    row.reduce((acc, value) => acc + value, 0)
  );
  const columnTotals = columnLabels.map((_, column) =>
    observed.reduce((acc, row) => acc + row[column], 0)
  );
  const sampleSize = rowTotals.reduce((acc, value) => acc + value, 0);

  const expected = rowLabels.map((_, row) =>
    columnLabels.map(
      (_, column) => (rowTotals[row] * columnTotals[column]) / sampleSize
    )
  );

  let chiSquare = 0;
  for (let r = 0; r < observed.length; r += 1) {
    for (let c = 0; c < observed[r].length; c += 1) {
      const expectedValue = expected[r][c];
      if (expectedValue <= 0) {
        continue;
      }
      const delta = observed[r][c] - expectedValue;
      chiSquare += (delta * delta) / expectedValue;
    }
  }

  const degreesOfFreedom = (rowLabels.length - 1) * (columnLabels.length - 1);
  const pValue = chiSquareSurvival(chiSquare, degreesOfFreedom);
  const denominator =
    sampleSize * Math.min(rowLabels.length - 1, columnLabels.length - 1);
  const cramersV = denominator > 0 ? Math.sqrt(chiSquare / denominator) : 0;

  return {
    kind: "chi_square_test",
    sampleSize,
    degreesOfFreedom,
    chiSquare,
    pValue,
    cramersV,
    rowLabels,
    columnLabels,
    observed,
    expected,
    rowTotals,
    columnTotals
  };
}
