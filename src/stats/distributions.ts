const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.9999999999998099,
  676.5203681218851,
  -1259.1392167224028,
  771.3234287776531,
  -176.6150291621406,
  12.507343278686905,
  -0.13857109526572012,
  0.000009984369578019572,
  0.00000015056327351493116
];

const EPSILON = 1e-12;
const TINY = 1e-300;
const MAX_ITERATIONS = 200;

function assertProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be within [0, 1].`);
  }
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
}

export function logGamma(z: number): number {
  if (!Number.isFinite(z)) {
    throw new Error("logGamma input must be finite.");
  }
  if (z < 0.5) {
    return (
      Math.log(Math.PI) -
      Math.log(Math.sin(Math.PI * z)) -
      logGamma(1 - z)
    );
  }

  let x = LANCZOS_COEFFICIENTS[0];
  const shifted = z - 1;
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i += 1) {
    x += LANCZOS_COEFFICIENTS[i] / (shifted + i);
  }
  const t = shifted + LANCZOS_G + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) {
    d = TINY;
  }
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m;

    let numerator =
      (m * (b - m) * x) /
      ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = 1 + numerator / c;
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    h *= d * c;

    numerator =
      (-(a + m) * (a + b + m) * x) /
      ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = 1 + numerator / c;
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) <= EPSILON) {
      break;
    }
  }

  return h;
}

export function regularizedIncompleteBeta(
  a: number,
  b: number,
  x: number
): number {
  assertPositive(a, "a");
  assertPositive(b, "b");
  assertProbability(x, "x");

  if (x === 0) {
    return 0;
  }
  if (x === 1) {
    return 1;
  }

  const front = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log1p(-x)
  );

  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function studentTCdf(t: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(t)) {
    throw new Error("t must be finite.");
  }
  assertPositive(degreesOfFreedom, "degreesOfFreedom");

  if (t === 0) {
    return 0.5;
  }

  const x =
    degreesOfFreedom /
    (degreesOfFreedom + t * t);
  const incompleteBeta = regularizedIncompleteBeta(
    degreesOfFreedom / 2,
    0.5,
    x
  );

  if (t > 0) {
    return 1 - 0.5 * incompleteBeta;
  }
  return 0.5 * incompleteBeta;
}

export function inverseStudentTCdf(
  probability: number,
  degreesOfFreedom: number
): number {
  assertProbability(probability, "probability");
  assertPositive(degreesOfFreedom, "degreesOfFreedom");

  if (probability === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (probability === 1) {
    return Number.POSITIVE_INFINITY;
  }
  if (probability === 0.5) {
    return 0;
  }
  if (probability < 0.5) {
    return -inverseStudentTCdf(1 - probability, degreesOfFreedom);
  }

  let low = 0;
  let high = 1;
  while (
    studentTCdf(high, degreesOfFreedom) < probability &&
    high < 1_000_000
  ) {
    high *= 2;
  }

  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const cdf = studentTCdf(mid, degreesOfFreedom);
    if (cdf < probability) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

export function regularizedGammaP(shape: number, x: number): number {
  assertPositive(shape, "shape");
  if (!Number.isFinite(x) || x < 0) {
    throw new Error("x must be greater than or equal to 0.");
  }
  if (x === 0) {
    return 0;
  }

  if (x > shape + 1) {
    return 1 - regularizedGammaQ(shape, x);
  }

  let term = 1 / shape;
  let sum = term;
  let ap = shape;

  for (let n = 1; n <= MAX_ITERATIONS; n += 1) {
    ap += 1;
    term *= x / ap;
    sum += term;
    if (Math.abs(term) <= Math.abs(sum) * EPSILON) {
      break;
    }
  }

  return sum * Math.exp(-x + shape * Math.log(x) - logGamma(shape));
}

export function regularizedGammaQ(shape: number, x: number): number {
  assertPositive(shape, "shape");
  if (!Number.isFinite(x) || x < 0) {
    throw new Error("x must be greater than or equal to 0.");
  }
  if (x === 0) {
    return 1;
  }

  if (x < shape + 1) {
    return 1 - regularizedGammaP(shape, x);
  }

  let b = x + 1 - shape;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= MAX_ITERATIONS; i += 1) {
    const numerator = -i * (i - shape);
    b += 2;
    d = numerator * d + b;
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = b + numerator / c;
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) <= EPSILON) {
      break;
    }
  }

  return Math.exp(-x + shape * Math.log(x) - logGamma(shape)) * h;
}

export function chiSquareSurvival(x: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(x) || x < 0) {
    throw new Error("x must be greater than or equal to 0.");
  }
  assertPositive(degreesOfFreedom, "degreesOfFreedom");
  return regularizedGammaQ(degreesOfFreedom / 2, x / 2);
}

export function inverseNormalCdf(probability: number): number {
  assertProbability(probability, "probability");
  if (probability === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (probability === 1) {
    return Number.POSITIVE_INFINITY;
  }

  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239
  ];
  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572
  ];
  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783
  ];
  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416
  ];
  const lower = 0.02425;
  const upper = 1 - lower;

  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (probability > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  const q = probability - 0.5;
  const r = q * q;
  return (
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}
