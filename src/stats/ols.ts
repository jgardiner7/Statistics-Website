import { studentTCdf } from "./distributions";

export interface OLSResult {
  coefficients: number[];
  standardErrors: number[];
  tStatistics: number[];
  pValues: number[];
  residuals: number[];
  fitted: number[];
  r2: number;
  adjustedR2: number;
  n: number;
  degreesOfFreedom: number;
  residualVariance: number;
  rss: number;
  leverage: number[];
  standardizedResiduals: number[];
  cooksDistance: number[];
}

function transpose(matrix: number[][]): number[][] {
  if (matrix.length === 0 || matrix[0].length === 0) {
    return [];
  }
  return matrix[0].map((_, c) => matrix.map((row) => row[c]));
}

function multiply(a: number[][], b: number[][]): number[][] {
  if (a.length === 0 || b.length === 0) {
    return [];
  }
  const rows = a.length;
  const cols = b[0].length;
  const inner = b.length;
  const out = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    for (let k = 0; k < inner; k += 1) {
      for (let j = 0; j < cols; j += 1) {
        out[i][j] += a[i][k] * b[k][j];
      }
    }
  }

  return out;
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) =>
    row.reduce((accumulator, value, index) => accumulator + value * vector[index], 0)
  );
}

function gaussianSolve(a: number[][], b: number[]): number[] {
  const n = a.length;
  if (n === 0) {
    throw new Error("Cannot solve an empty linear system.");
  }
  if (a.some((row) => row.length !== n)) {
    throw new Error("Coefficient matrix must be square.");
  }
  if (b.length !== n) {
    throw new Error("Right-hand side vector size does not match matrix size.");
  }

  const augmented = a.map((row, index) => [...row, b[index]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      throw new Error("Singular matrix in OLS solve");
    }
    if (pivot !== col) {
      [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    }

    const divisor = augmented[col][col];
    for (let j = col; j <= n; j += 1) {
      augmented[col][j] /= divisor;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = augmented[row][col];
      for (let j = col; j <= n; j += 1) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const inverse = Array.from({ length: n }, () => Array(n).fill(0));
  for (let col = 0; col < n; col += 1) {
    const unit = Array(n).fill(0);
    unit[col] = 1;
    const solved = gaussianSolve(
      matrix.map((row) => [...row]),
      unit
    );
    for (let row = 0; row < n; row += 1) {
      inverse[row][col] = solved[row];
    }
  }
  return inverse;
}

function addIntercept(x: number[][]): number[][] {
  return x.map((row) => [1, ...row]);
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

export function fitOLS(
  y: number[],
  x: number[][],
  options: { intercept?: boolean } = {}
): OLSResult {
  if (y.length === 0) {
    throw new Error("y cannot be empty");
  }
  if (x.length !== y.length) {
    throw new Error("x and y row counts must match");
  }

  const predictorCount = x[0]?.length ?? 0;
  if (x.some((row) => row.length !== predictorCount)) {
    throw new Error("All predictor rows must have the same width.");
  }

  const useIntercept = options.intercept !== false;
  if (!useIntercept && predictorCount === 0) {
    throw new Error("At least one predictor is required when intercept is disabled.");
  }

  const design = useIntercept ? addIntercept(x) : x.map((row) => [...row]);
  const n = y.length;
  const parameterCount = design[0]?.length ?? 0;
  if (parameterCount === 0) {
    throw new Error("Design matrix has no columns.");
  }
  if (n <= parameterCount) {
    throw new Error(
      "Not enough rows to fit OLS with inferential statistics (n must exceed parameter count)."
    );
  }

  const xt = transpose(design);
  const xtx = multiply(xt, design);
  const xty = multiplyMatrixVector(xt, y);
  const coefficients = gaussianSolve(
    xtx.map((row) => [...row]),
    xty
  );

  const fitted = design.map((row) =>
    row.reduce((accumulator, value, index) => accumulator + value * coefficients[index], 0)
  );
  const residuals = y.map((value, index) => value - fitted[index]);

  const meanY = y.reduce((accumulator, value) => accumulator + value, 0) / n;
  const ssTot = y.reduce((accumulator, value) => accumulator + (value - meanY) ** 2, 0);
  const rss = residuals.reduce((accumulator, value) => accumulator + value ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - rss / ssTot;

  const degreesOfFreedom = n - parameterCount;
  const residualVariance = rss / degreesOfFreedom;
  const xtxInverse = invertMatrix(xtx);
  const leverage = design.map((row) => {
    const projected = xtxInverse.map((inverseRow) =>
      inverseRow.reduce((accumulator, value, index) => accumulator + value * row[index], 0)
    );
    return row.reduce((accumulator, value, index) => accumulator + value * projected[index], 0);
  });

  const standardErrors = xtxInverse.map((row, index) => {
    const diagonal = row[index];
    return Math.sqrt(Math.max(0, residualVariance * diagonal));
  });
  const tStatistics = coefficients.map((estimate, index) => {
    const standardError = standardErrors[index];
    if (!Number.isFinite(standardError) || standardError <= 0) {
      return estimate === 0 ? 0 : Number.POSITIVE_INFINITY;
    }
    return estimate / standardError;
  });
  const pValues = tStatistics.map((tStatistic) => {
    if (!Number.isFinite(tStatistic)) {
      return 0;
    }
    const cdf = studentTCdf(Math.abs(tStatistic), degreesOfFreedom);
    return clampProbability(2 * (1 - cdf));
  });

  const denominatorDegrees = useIntercept ? n - 1 : n;
  const adjustedR2 =
    ssTot === 0 || denominatorDegrees <= 0
      ? 1
      : 1 - (rss / degreesOfFreedom) / (ssTot / denominatorDegrees);
  const residualStdError = Math.sqrt(Math.max(0, residualVariance));
  const parameterCountForInfluence = Math.max(1, parameterCount);
  const standardizedResiduals = residuals.map((residual, index) => {
    const leverageValue = Math.max(0, Math.min(0.999999, leverage[index] ?? 0));
    const denominator = residualStdError * Math.sqrt(Math.max(1e-12, 1 - leverageValue));
    if (!Number.isFinite(denominator) || denominator <= 0) {
      return 0;
    }
    return residual / denominator;
  });
  const cooksDistance = residuals.map((residual, index) => {
    const leverageValue = Math.max(0, Math.min(0.999999, leverage[index] ?? 0));
    const denominator = Math.max(1e-12, residualVariance);
    return (
      ((residual * residual) / (parameterCountForInfluence * denominator)) *
      (leverageValue / Math.max(1e-12, (1 - leverageValue) ** 2))
    );
  });

  return {
    coefficients,
    standardErrors,
    tStatistics,
    pValues,
    residuals,
    fitted,
    r2,
    adjustedR2,
    n,
    degreesOfFreedom,
    residualVariance,
    rss,
    leverage,
    standardizedResiduals,
    cooksDistance
  };
}
