import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  ChiSquareTestResult,
  NotebookChartPayload,
  NotebookBlock,
  OLSRegressionResult,
  PearsonCorrelationResult,
  PrimitiveValue,
  QueryTargetRef,
  TableProfile,
  WelchTTestResult
} from "../../shared/types";
import type { QueryResult, ResultsTab } from "../state";
import { DataGrid } from "./DataGrid";
import { TabBar } from "./TabBar";

interface ResultsWindowProps {
  tab: ResultsTab;
  onTabChange: (tab: ResultsTab) => void;
  queryResult: QueryResult | null;
  notebookBlocks: NotebookBlock[];
  onRerunNotebookBlock: (blockId: string) => void;
  onDeleteNotebookBlock: (blockId: string) => void;
  onLoadMoreTableRows?: (input: {
    querySql: string;
    queryTarget: QueryTargetRef;
    offset: number;
    limit: number;
  }) => Promise<{
    columns: string[];
    rows: PrimitiveValue[][];
    rowCount: number;
  }>;
  profile: TableProfile | null;
  describeOptions: {
    data: Array<{
      key: string;
      label: string;
      target: QueryTargetRef;
    }>;
    transforms: Array<{
      key: string;
      label: string;
      target: QueryTargetRef;
    }>;
    queries: Array<{
      key: string;
      label: string;
      target: QueryTargetRef;
    }>;
  };
  onDescribe: (target: QueryTargetRef) => void;
}

function formatStatValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "NA";
  }
  return value.toPrecision(4);
}

function formatProfileNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "NA";
  }
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toPrecision(4);
}

function formatProfileValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NA";
  }
  if (typeof value === "number") {
    return formatProfileNumber(value);
  }
  return String(value);
}

function formatTopValues(
  values: Array<{ value: PrimitiveValue; count: number }> | undefined
): string {
  if (!values || values.length === 0) {
    return "NA";
  }
  return values
    .map((entry) => `${formatProfileValue(entry.value)} (${entry.count.toLocaleString()})`)
    .join(", ");
}

function getTestSummary(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as { kind?: string };
  if (candidate.kind === "welch_t_test") {
    const result = payload as WelchTTestResult;
    return `p=${formatStatValue(result.pValue)} | diff=${formatStatValue(
      result.meanDifference
    )} | n=${result.completeCases.effectiveSampleSize}`;
  }
  if (candidate.kind === "pearson_correlation") {
    const result = payload as PearsonCorrelationResult;
    const method = result.method ? `${result.method} ` : "";
    return `${method}r=${formatStatValue(result.correlation)} | p=${formatStatValue(
      result.pValue
    )} | n=${result.completeCases.effectiveSampleSize}`;
  }
  if (candidate.kind === "chi_square_test") {
    const result = payload as ChiSquareTestResult;
    return `chi2=${formatStatValue(result.chiSquare)} | p=${formatStatValue(
      result.pValue
    )} | n=${result.completeCases.effectiveSampleSize}`;
  }
  if (candidate.kind === "ols_regression") {
    const result = payload as OLSRegressionResult;
    return `R²=${formatStatValue(result.r2)} | adj=${formatStatValue(
      result.adjustedR2
    )} | n=${result.n}`;
  }
  return null;
}

function toSafeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function buildEmbedSnippet(input: {
  kind: "table" | "chart" | "model";
  title: string;
  payload: unknown;
  querySql?: string;
  queryTarget?: QueryTargetRef;
}): string {
  const embed = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    ...input
  };
  const safeJson = toSafeJson(embed);
  return `<div class="statsfish-embed" data-kind="${input.kind}" data-title="${input.title}"></div>
<script type="application/json" class="statsfish-embed-data">
${safeJson}
</script>`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is not available in this browser.");
  }
  await navigator.clipboard.writeText(text);
}

function isChartPayload(payload: unknown): payload is NotebookChartPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as {
    kind?: string;
    chartType?: string;
    xColumn?: string;
    yColumn?: string;
    points?: unknown;
  };
  return (
    candidate.kind === "chart_v1" &&
    (candidate.chartType === "bar" ||
      candidate.chartType === "line" ||
      candidate.chartType === "scatter" ||
      candidate.chartType === "histogram") &&
    typeof candidate.xColumn === "string" &&
    typeof candidate.yColumn === "string" &&
    Array.isArray(candidate.points)
  );
}

function isTablePayload(payload: unknown): payload is QueryResult {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as {
    columns?: unknown;
    rows?: unknown;
    rowCount?: unknown;
  };
  return (
    Array.isArray(candidate.columns) &&
    Array.isArray(candidate.rows) &&
    typeof candidate.rowCount === "number"
  );
}

function isOLSRegressionPayload(payload: unknown): payload is OLSRegressionResult {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as {
    kind?: string;
    coefficients?: unknown;
    residualSummary?: unknown;
  };
  return (
    candidate.kind === "ols_regression" &&
    Array.isArray(candidate.coefficients) &&
    typeof candidate.residualSummary === "object"
  );
}

function buildHistogramPoints(
  values: number[],
  maxBins = 24
): Array<{ x: number; y: number }> {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return [];
  }
  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  if (minValue === maxValue) {
    return [{ x: minValue, y: finiteValues.length }];
  }
  const binCount = Math.max(
    5,
    Math.min(maxBins, Math.ceil(Math.sqrt(finiteValues.length)))
  );
  const binWidth = (maxValue - minValue) / binCount;
  if (!(binWidth > 0)) {
    return [{ x: minValue, y: finiteValues.length }];
  }

  const bins = Array.from({ length: binCount }, () => 0);
  for (const value of finiteValues) {
    const rawIndex = Math.floor((value - minValue) / binWidth);
    const clampedIndex = Math.max(0, Math.min(binCount - 1, rawIndex));
    bins[clampedIndex] += 1;
  }

  return bins.map((count, index) => ({
    x: minValue + binWidth * (index + 0.5),
    y: count
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ChartBlockView({
  payload,
  onExpand
}: {
  payload: NotebookChartPayload;
  onExpand?: () => void;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const contextMenuSuppressorRef = useRef<((event: MouseEvent) => void) | null>(null);
  const pointerReleaseSuppressorRef = useRef<((event: PointerEvent | MouseEvent) => void) | null>(
    null
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [xDomain, setXDomain] = useState<{ min: number; max: number } | null>(null);
  const [yDomain, setYDomain] = useState<{ min: number; max: number } | null>(null);
  const [pointerPlot, setPointerPlot] = useState<{
    svgX: number;
    svgY: number;
    dataX: number;
    dataY: number;
  } | null>(null);
  const [dragState, setDragState] = useState<
    | {
        mode: "pan";
        pointerId: number;
        startSvgX: number;
        startSvgY: number;
        startXMin: number;
        startXMax: number;
        startYMin: number;
        startYMax: number;
      }
    | {
        mode: "zoom_box";
        pointerId: number;
        startX: number;
        startY: number;
        endX: number;
        endY: number;
      }
    | null
  >(null);
  const clipId = useId().replace(/:/g, "_");
  const clipPathId = useMemo(() => `chart-clip-${clipId}`, [clipId]);

  const installGlobalContextMenuSuppressor = () => {
    if (contextMenuSuppressorRef.current) {
      return;
    }
    const suppress = (event: MouseEvent) => {
      event.preventDefault();
    };
    contextMenuSuppressorRef.current = suppress;
    window.addEventListener("contextmenu", suppress, true);
    const onPointerRelease = () => {
      removeGlobalContextMenuSuppressor();
    };
    pointerReleaseSuppressorRef.current = onPointerRelease;
    window.addEventListener("pointerup", onPointerRelease, true);
    window.addEventListener("mouseup", onPointerRelease, true);
  };

  const removeGlobalContextMenuSuppressor = () => {
    const suppress = contextMenuSuppressorRef.current;
    if (suppress) {
      window.removeEventListener("contextmenu", suppress, true);
      contextMenuSuppressorRef.current = null;
    }
    const pointerReleaseSuppressor = pointerReleaseSuppressorRef.current;
    if (pointerReleaseSuppressor) {
      window.removeEventListener("pointerup", pointerReleaseSuppressor, true);
      window.removeEventListener("mouseup", pointerReleaseSuppressor, true);
      pointerReleaseSuppressorRef.current = null;
    }
  };

  useEffect(() => {
    setXDomain(null);
    setYDomain(null);
    setHoveredIndex(null);
    setPointerPlot(null);
    setDragState(null);
    removeGlobalContextMenuSuppressor();
  }, [payload]);

  useEffect(() => {
    const previewElement = previewRef.current;
    if (!previewElement) {
      return;
    }
    const preventWheelScroll = (event: WheelEvent) => {
      event.preventDefault();
    };
    previewElement.addEventListener("wheel", preventWheelScroll, {
      passive: false
    });
    return () => {
      previewElement.removeEventListener("wheel", preventWheelScroll);
    };
  }, []);

  useEffect(
    () => () => {
      removeGlobalContextMenuSuppressor();
    },
    []
  );

  const width = 680;
  const height = 320;
  const points = payload.points;

  if (points.length === 0) {
    return <div className="empty-box">Chart has no points.</div>;
  }

  const numericX = points.every(
    (point) => typeof point.x === "number" && Number.isFinite(point.x)
  );
  const hasCategoricalXAxis = !numericX;
  const margin = {
    top: 20,
    right: 20,
    bottom: hasCategoricalXAxis ? 72 : 48,
    left: 56
  };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);

  const indexedPoints = points.map((point, rawIndex) => ({
    ...point,
    rawIndex,
    xValue: numericX ? (point.x as number) : rawIndex
  }));
  const seriesValues = Array.from(
    new Set(indexedPoints.map((point) => point.series ?? "__all__"))
  );
  const hasSeries = seriesValues.length > 1;
  const seriesColorPalette = [
    "#0f766e",
    "#1d4ed8",
    "#b45309",
    "#be185d",
    "#7c3aed",
    "#166534",
    "#334155",
    "#b91c1c"
  ];
  const colorForSeries = (seriesValue: string): string => {
    const index = seriesValues.indexOf(seriesValue);
    const normalizedIndex = index < 0 ? 0 : index;
    return seriesColorPalette[normalizedIndex % seriesColorPalette.length];
  };
  const groupedSeriesPoints = seriesValues.map((seriesValue) => ({
    seriesValue,
    points: indexedPoints.filter((point) => (point.series ?? "__all__") === seriesValue)
  }));

  const xValues = indexedPoints.map((point) => point.xValue);
  const yValues = indexedPoints.map((point) => point.y);
  const rawXMin = Math.min(...xValues);
  const rawXMax = Math.max(...xValues);
  const rawYMin = Math.min(...yValues);
  const rawYMax = Math.max(...yValues);

  const autoXMin = rawXMin;
  const autoXMax = rawXMax;

  let autoYMin = rawYMin;
  let autoYMax = rawYMax;
  if (payload.chartType === "bar" || payload.chartType === "histogram") {
    autoYMin = Math.min(0, rawYMin);
    autoYMax = Math.max(0, rawYMax);
    if (autoYMin === autoYMax) {
      const pad = Math.max(1, Math.abs(autoYMax) * 0.05 || 1);
      autoYMin -= pad;
      autoYMax += pad;
    } else {
      autoYMax += (autoYMax - autoYMin) * 0.04;
    }
  } else {
    const pad = autoYMin === autoYMax ? Math.max(1, Math.abs(autoYMin) * 0.05 || 1) : 0;
    autoYMin -= pad;
    autoYMax += pad;
  }

  const useAutoRange = payload.autoRange !== false;
  const requestedXMin = payload.xRange?.min;
  const requestedXMax = payload.xRange?.max;
  const requestedYMin = payload.yRange?.min;
  const requestedYMax = payload.yRange?.max;

  const finiteRequestedXMin =
    typeof requestedXMin === "number" && Number.isFinite(requestedXMin)
      ? requestedXMin
      : undefined;
  const finiteRequestedXMax =
    typeof requestedXMax === "number" && Number.isFinite(requestedXMax)
      ? requestedXMax
      : undefined;
  const finiteRequestedYMin =
    typeof requestedYMin === "number" && Number.isFinite(requestedYMin)
      ? requestedYMin
      : undefined;
  const finiteRequestedYMax =
    typeof requestedYMax === "number" && Number.isFinite(requestedYMax)
      ? requestedYMax
      : undefined;

  let baseXMin = autoXMin;
  let baseXMax = autoXMax;
  if (!useAutoRange && numericX) {
    baseXMin = finiteRequestedXMin ?? autoXMin;
    baseXMax = finiteRequestedXMax ?? autoXMax;
    if (!(baseXMax > baseXMin)) {
      baseXMin = autoXMin;
      baseXMax = autoXMax;
    }
  }

  let baseYMin = autoYMin;
  let baseYMax = autoYMax;
  if (!useAutoRange) {
    baseYMin = finiteRequestedYMin ?? autoYMin;
    baseYMax = finiteRequestedYMax ?? autoYMax;
    if (!(baseYMax > baseYMin)) {
      baseYMin = autoYMin;
      baseYMax = autoYMax;
    }
  }

  const clampDomainWithinBase = (
    min: number,
    max: number,
    baseMin: number,
    baseMax: number
  ): { min: number; max: number } => {
    if (!(baseMax > baseMin)) {
      return {
        min: baseMin,
        max: baseMax
      };
    }
    const baseSpan = baseMax - baseMin;
    const span = max - min;
    if (!(span > 0) || span >= baseSpan) {
      return {
        min: baseMin,
        max: baseMax
      };
    }
    let nextMin = min;
    let nextMax = max;
    if (nextMin < baseMin) {
      const shift = baseMin - nextMin;
      nextMin += shift;
      nextMax += shift;
    }
    if (nextMax > baseMax) {
      const shift = nextMax - baseMax;
      nextMin -= shift;
      nextMax -= shift;
    }
    return {
      min: clamp(nextMin, baseMin, baseMax - span),
      max: clamp(nextMax, baseMin + span, baseMax)
    };
  };

  const resolvedXDomain =
    xDomain === null
      ? { min: baseXMin, max: baseXMax }
      : clampDomainWithinBase(xDomain.min, xDomain.max, baseXMin, baseXMax);
  const resolvedYDomain =
    yDomain === null
      ? { min: baseYMin, max: baseYMax }
      : clampDomainWithinBase(yDomain.min, yDomain.max, baseYMin, baseYMax);

  const xMin = resolvedXDomain.min;
  const xMax = resolvedXDomain.max;
  const yMin = resolvedYDomain.min;
  const yMax = resolvedYDomain.max;
  const xSpan = Math.max(1e-9, xMax - xMin);
  const ySpan = Math.max(1e-9, yMax - yMin);

  const xScale = (value: number) => margin.left + ((value - xMin) / xSpan) * plotWidth;
  const yScale = (value: number) => margin.top + ((yMax - value) / ySpan) * plotHeight;
  const xFromSvg = (svgX: number) => xMin + ((svgX - margin.left) / Math.max(1, plotWidth)) * xSpan;
  const yFromSvg = (svgY: number) => yMax - ((svgY - margin.top) / Math.max(1, plotHeight)) * ySpan;

  const inXDomain = (value: number) => value >= xMin - 1e-9 && value <= xMax + 1e-9;
  const inYDomain = (value: number) => value >= yMin - 1e-9 && value <= yMax + 1e-9;
  const xPoint = (point: { xValue: number }) => xScale(point.xValue);

  const xDomainPoints = indexedPoints.filter((point) => inXDomain(point.xValue));
  const visiblePoints = indexedPoints.filter(
    (point) => inXDomain(point.xValue) && inYDomain(point.y)
  );

  const linePathBySeries = groupedSeriesPoints.map((seriesGroup) => ({
    seriesValue: seriesGroup.seriesValue,
    linePath: seriesGroup.points
      .map((point) => `${xPoint(point)},${yScale(point.y)}`)
      .join(" ")
  }));
  const baselineValue = yMin <= 0 && yMax >= 0 ? 0 : yMin;
  const baselineY = yScale(baselineValue);
  const barWidth = Math.max(
    6,
    Math.min(40, (plotWidth / Math.max(xDomainPoints.length, 1)) * 0.72)
  );

  const xTickItems = numericX
    ? Array.from({ length: 6 }, (_, index) => {
        const ratio = index / 5;
        const value = xMin + ratio * (xMax - xMin);
        return {
          key: `x-num-${index}`,
          position: xScale(value),
          label: formatProfileNumber(value)
        };
      })
    : (() => {
        const maxTicks = payload.chartType === "bar" ? 16 : 10;
        const step = Math.max(1, Math.ceil(xDomainPoints.length / maxTicks));
        const tickMap = new Map<number, { key: string; position: number; label: string }>();
        xDomainPoints.forEach((point, visibleIndex) => {
          const isEdge = visibleIndex === 0 || visibleIndex === xDomainPoints.length - 1;
          if (!isEdge && visibleIndex % step !== 0) {
            return;
          }
          const labelRaw =
            typeof point.x === "number" ? formatProfileNumber(point.x) : String(point.x);
          const label = labelRaw.length > 18 ? `${labelRaw.slice(0, 17)}...` : labelRaw;
          tickMap.set(point.rawIndex, {
            key: `x-cat-${point.rawIndex}`,
            position: xPoint(point),
            label
          });
        });
        return Array.from(tickMap.values());
      })();

  const isZoomedX =
    baseXMax > baseXMin &&
    (Math.abs(xMin - baseXMin) > 1e-9 || Math.abs(xMax - baseXMax) > 1e-9);
  const isZoomedY =
    baseYMax > baseYMin &&
    (Math.abs(yMin - baseYMin) > 1e-9 || Math.abs(yMax - baseYMax) > 1e-9);
  const canZoom = baseXMax > baseXMin || baseYMax > baseYMin;
  const canPan = isZoomedX || isZoomedY;
  const canResetZoom = canPan;

  const zoomAlongAxis = (
    axis: {
      baseMin: number;
      baseMax: number;
      min: number;
      max: number;
      minSpan: number;
    },
    factor: number,
    anchorRatioFromMin: number
  ): { min: number; max: number } | null => {
    const baseSpan = axis.baseMax - axis.baseMin;
    if (!(baseSpan > 0)) {
      return null;
    }
    const safeAnchorRatio = clamp(anchorRatioFromMin, 0, 1);
    const currentSpan = Math.max(1e-9, axis.max - axis.min);
    const nextSpan = clamp(currentSpan / factor, axis.minSpan, baseSpan);
    const anchorValue = axis.min + safeAnchorRatio * currentSpan;
    let nextMin = anchorValue - safeAnchorRatio * nextSpan;
    let nextMax = nextMin + nextSpan;
    if (nextMin < axis.baseMin) {
      nextMin = axis.baseMin;
      nextMax = axis.baseMin + nextSpan;
    }
    if (nextMax > axis.baseMax) {
      nextMax = axis.baseMax;
      nextMin = axis.baseMax - nextSpan;
    }
    return {
      min: nextMin,
      max: nextMax
    };
  };

  const applyZoom = (
    factor: number,
    anchorXRatioFromMin = 0.5,
    anchorYRatioFromMin = 0.5
  ) => {
    if (factor <= 0 || !canZoom) {
      return;
    }
    const baseXSpan = baseXMax - baseXMin;
    const baseYSpan = baseYMax - baseYMin;
    const minXSpan = numericX
      ? Math.max(baseXSpan / 500, 1e-9)
      : Math.max(1, Math.ceil(baseXSpan * 0.02));
    const minYSpan = Math.max(baseYSpan / 500, 1e-9);

    const nextX = zoomAlongAxis(
      {
        baseMin: baseXMin,
        baseMax: baseXMax,
        min: xMin,
        max: xMax,
        minSpan: minXSpan
      },
      factor,
      anchorXRatioFromMin
    );
    const nextY = zoomAlongAxis(
      {
        baseMin: baseYMin,
        baseMax: baseYMax,
        min: yMin,
        max: yMax,
        minSpan: minYSpan
      },
      factor,
      anchorYRatioFromMin
    );

    if (nextX) {
      setXDomain(nextX);
    }
    if (nextY) {
      setYDomain(nextY);
    }
  };

  const toSvgCoordinates = (
    target: SVGSVGElement,
    clientX: number,
    clientY: number
  ): { x: number; y: number } => {
    const rect = target.getBoundingClientRect();
    const safeWidth = Math.max(1, rect.width);
    const safeHeight = Math.max(1, rect.height);
    return {
      x: ((clientX - rect.left) / safeWidth) * width,
      y: ((clientY - rect.top) / safeHeight) * height
    };
  };

  const isInsidePlot = (svgX: number, svgY: number): boolean =>
    svgX >= margin.left &&
    svgX <= width - margin.right &&
    svgY >= margin.top &&
    svgY <= height - margin.bottom;

  const updatePointerFromClient = (
    target: SVGSVGElement,
    clientX: number,
    clientY: number
  ): {
    svgX: number;
    svgY: number;
    clampedX: number;
    clampedY: number;
  } => {
    const { x: svgX, y: svgY } = toSvgCoordinates(target, clientX, clientY);
    const clampedX = clamp(svgX, margin.left, width - margin.right);
    const clampedY = clamp(svgY, margin.top, height - margin.bottom);
    if (isInsidePlot(clampedX, clampedY)) {
      setPointerPlot({
        svgX: clampedX,
        svgY: clampedY,
        dataX: xFromSvg(clampedX),
        dataY: yFromSvg(clampedY)
      });
    } else {
      setPointerPlot(null);
    }
    return {
      svgX,
      svgY,
      clampedX,
      clampedY
    };
  };

  const plotPointerForDisplay =
    pointerPlot && isInsidePlot(pointerPlot.svgX, pointerPlot.svgY) ? pointerPlot : null;
  const nearestPointForCategoricalX =
    plotPointerForDisplay && !numericX
      ? xDomainPoints.reduce((best, point) => {
          const bestDistance = Math.abs(best.xValue - plotPointerForDisplay.dataX);
          const distance = Math.abs(point.xValue - plotPointerForDisplay.dataX);
          return distance < bestDistance ? point : best;
        }, xDomainPoints[0] ?? indexedPoints[0])
      : null;
  const hoveredPoint =
    hoveredIndex === null
      ? null
      : indexedPoints.find((point) => point.rawIndex === hoveredIndex) ?? null;

  const coordinateX = hoveredPoint
    ? String(hoveredPoint.x)
    : plotPointerForDisplay
      ? numericX
        ? formatProfileNumber(plotPointerForDisplay.dataX)
        : String(nearestPointForCategoricalX?.x ?? "--")
      : "--";
  const coordinateY = hoveredPoint
    ? formatProfileNumber(hoveredPoint.y)
    : plotPointerForDisplay
      ? formatProfileNumber(plotPointerForDisplay.dataY)
      : "--";
  const coordinateSeries = hoveredPoint?.series ?? "--";

  const bestFitLine =
    payload.bestFitLine &&
    numericX &&
    (payload.chartType === "line" || payload.chartType === "scatter")
      ? payload.bestFitLine
      : null;
  const bestFitYAtXMin = bestFitLine ? bestFitLine.slope * xMin + bestFitLine.intercept : null;
  const bestFitYAtXMax = bestFitLine ? bestFitLine.slope * xMax + bestFitLine.intercept : null;

  const finalizeBoxZoom = (box: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }) => {
    const left = clamp(Math.min(box.startX, box.endX), margin.left, width - margin.right);
    const right = clamp(Math.max(box.startX, box.endX), margin.left, width - margin.right);
    const top = clamp(Math.min(box.startY, box.endY), margin.top, height - margin.bottom);
    const bottom = clamp(Math.max(box.startY, box.endY), margin.top, height - margin.bottom);
    if (right - left < 6 || bottom - top < 6) {
      return;
    }

    if (baseXMax > baseXMin) {
      const nextXMin = Math.min(xFromSvg(left), xFromSvg(right));
      const nextXMax = Math.max(xFromSvg(left), xFromSvg(right));
      const clamped = clampDomainWithinBase(nextXMin, nextXMax, baseXMin, baseXMax);
      if (clamped.max > clamped.min) {
        setXDomain(clamped);
      }
    }
    if (baseYMax > baseYMin) {
      const nextYMin = Math.min(yFromSvg(bottom), yFromSvg(top));
      const nextYMax = Math.max(yFromSvg(bottom), yFromSvg(top));
      const clamped = clampDomainWithinBase(nextYMin, nextYMax, baseYMin, baseYMax);
      if (clamped.max > clamped.min) {
        setYDomain(clamped);
      }
    }
  };

  return (
    <div
      ref={previewRef}
      className={onExpand ? "chart-preview clickable-preview" : "chart-preview"}
      onClick={onExpand}
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (!onExpand) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onExpand();
        }
      }}
      role={onExpand ? "button" : undefined}
      tabIndex={onExpand ? 0 : undefined}
      aria-label={onExpand ? "Expand chart preview" : undefined}
    >
      {payload.title ? <div className="list-subtitle">{payload.title}</div> : null}
      {hasSeries ? (
        <div className="hint-line">
          Series:{" "}
          {seriesValues
            .map((seriesValue) => (seriesValue === "__all__" ? "All" : seriesValue))
            .join(", ")}
        </div>
      ) : null}
      <div className="chart-controls" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="btn btn-ghost compact"
          onClick={() => {
            setXDomain(null);
            setYDomain(null);
          }}
          disabled={!canResetZoom}
        >
          Reset Zoom
        </button>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={`${payload.chartType} chart of ${payload.yColumn} by ${payload.xColumn}`}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!canZoom) {
            return;
          }
          const { x: svgX, y: svgY } = toSvgCoordinates(
            event.currentTarget,
            event.clientX,
            event.clientY
          );
          const xRatioFromMin = clamp((svgX - margin.left) / Math.max(1, plotWidth), 0, 1);
          const yRatioFromMin = clamp(
            1 - (svgY - margin.top) / Math.max(1, plotHeight),
            0,
            1
          );
          if (event.deltaY < 0) {
            applyZoom(1.2, xRatioFromMin, yRatioFromMin);
          } else {
            applyZoom(1 / 1.2, xRatioFromMin, yRatioFromMin);
          }
        }}
        onPointerDown={(event) => {
          const { svgX, svgY, clampedX, clampedY } = updatePointerFromClient(
            event.currentTarget,
            event.clientX,
            event.clientY
          );

          if (event.button === 2) {
            if (!canZoom || !isInsidePlot(svgX, svgY)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            installGlobalContextMenuSuppressor();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragState({
              mode: "zoom_box",
              pointerId: event.pointerId,
              startX: clampedX,
              startY: clampedY,
              endX: clampedX,
              endY: clampedY
            });
            return;
          }

          if (event.button === 0 && canPan && isInsidePlot(svgX, svgY)) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragState({
              mode: "pan",
              pointerId: event.pointerId,
              startSvgX: svgX,
              startSvgY: svgY,
              startXMin: xMin,
              startXMax: xMax,
              startYMin: yMin,
              startYMax: yMax
            });
          }
        }}
        onPointerMove={(event) => {
          const { svgX, svgY, clampedX, clampedY } = updatePointerFromClient(
            event.currentTarget,
            event.clientX,
            event.clientY
          );

          if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (dragState.mode === "zoom_box") {
            setDragState({
              ...dragState,
              endX: clampedX,
              endY: clampedY
            });
            return;
          }

          const dxData = ((svgX - dragState.startSvgX) / Math.max(1, plotWidth)) *
            (dragState.startXMax - dragState.startXMin);
          const dyData = ((svgY - dragState.startSvgY) / Math.max(1, plotHeight)) *
            (dragState.startYMax - dragState.startYMin);

          if (isZoomedX) {
            const nextX = clampDomainWithinBase(
              dragState.startXMin - dxData,
              dragState.startXMax - dxData,
              baseXMin,
              baseXMax
            );
            setXDomain(nextX);
          }
          if (isZoomedY) {
            const nextY = clampDomainWithinBase(
              dragState.startYMin + dyData,
              dragState.startYMax + dyData,
              baseYMin,
              baseYMax
            );
            setYDomain(nextY);
          }
        }}
        onMouseMove={(event) => {
          updatePointerFromClient(event.currentTarget, event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (event.button === 2) {
            removeGlobalContextMenuSuppressor();
          }
          if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (dragState.mode === "zoom_box") {
            const { x: svgX, y: svgY } = toSvgCoordinates(
              event.currentTarget,
              event.clientX,
              event.clientY
            );
            const completed = {
              ...dragState,
              endX: clamp(svgX, margin.left, width - margin.right),
              endY: clamp(svgY, margin.top, height - margin.bottom)
            };
            finalizeBoxZoom(completed);
          }
          setDragState(null);
        }}
        onPointerCancel={(event) => {
          removeGlobalContextMenuSuppressor();
          if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setDragState(null);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setXDomain(null);
          setYDomain(null);
        }}
        onMouseLeave={() => {
          setHoveredIndex(null);
          setPointerPlot(null);
        }}
      >
        <defs>
          <clipPath id={clipPathId}>
            <rect
              x={margin.left}
              y={margin.top}
              width={plotWidth}
              height={plotHeight}
            />
          </clipPath>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = margin.top + tick * plotHeight;
          const value = yMax - tick * (yMax - yMin);
          return (
            <g key={`grid-${tick}`}>
              <line
                x1={margin.left}
                y1={y}
                x2={width - margin.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
              <text
                x={margin.left - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="currentColor"
                opacity={0.7}
              >
                {formatProfileNumber(value)}
              </text>
            </g>
          );
        })}

        <g clipPath={`url(#${clipPathId})`}>
          {xTickItems.map((tick) => (
            <line
              key={`x-grid-${tick.key}`}
              x1={tick.position}
              y1={margin.top}
              x2={tick.position}
              y2={height - margin.bottom}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
          ))}
          <line
            x1={margin.left}
            y1={baselineY}
            x2={width - margin.right}
            y2={baselineY}
            stroke="currentColor"
            strokeOpacity={0.5}
          />

          {bestFitLine && bestFitYAtXMin !== null && bestFitYAtXMax !== null && (
            <line
              className="chart-best-fit-line"
              x1={xScale(xMin)}
              y1={yScale(bestFitYAtXMin)}
              x2={xScale(xMax)}
              y2={yScale(bestFitYAtXMax)}
            />
          )}

          {payload.chartType === "line" && (
            <>
              {linePathBySeries.map((seriesLine) => (
                <polyline
                  key={`line-series-${seriesLine.seriesValue}`}
                  points={seriesLine.linePath}
                  fill="none"
                  stroke={
                    hasSeries ? colorForSeries(seriesLine.seriesValue) : "currentColor"
                  }
                  strokeOpacity={0.85}
                  strokeWidth={2}
                />
              ))}
              {indexedPoints.map((point) => (
                <circle
                  key={`line-point-${point.rawIndex}`}
                  cx={xPoint(point)}
                  cy={yScale(point.y)}
                  r={hoveredIndex === point.rawIndex ? 5 : 3.5}
                  fill={
                    hasSeries
                      ? colorForSeries(point.series ?? "__all__")
                      : "currentColor"
                  }
                  fillOpacity={hoveredIndex === point.rawIndex ? 0.95 : 0.7}
                  onMouseEnter={() => setHoveredIndex(point.rawIndex)}
                />
              ))}
            </>
          )}

          {payload.chartType === "scatter" &&
            indexedPoints.map((point) => (
              <circle
                key={`scatter-point-${point.rawIndex}`}
                cx={xPoint(point)}
                cy={yScale(point.y)}
                r={hoveredIndex === point.rawIndex ? 5 : 4}
                fill={
                  hasSeries
                    ? colorForSeries(point.series ?? "__all__")
                    : "currentColor"
                }
                fillOpacity={hoveredIndex === point.rawIndex ? 0.95 : 0.72}
                onMouseEnter={() => setHoveredIndex(point.rawIndex)}
              />
            ))}

          {(payload.chartType === "bar" || payload.chartType === "histogram") &&
            indexedPoints.map((point) => {
              const xCenter = xPoint(point);
              const yValue = yScale(point.y);
              const histogramBarWidth =
                payload.chartType === "histogram" && numericX && indexedPoints.length > 1
                  ? Math.max(
                      2,
                      Math.abs(xPoint(indexedPoints[1]) - xPoint(indexedPoints[0])) * 0.94
                    )
                  : barWidth;
              return (
                <rect
                  key={`bar-${point.rawIndex}`}
                  x={xCenter - histogramBarWidth / 2}
                  y={Math.min(yValue, baselineY)}
                  width={histogramBarWidth}
                  height={Math.max(1, Math.abs(baselineY - yValue))}
                  fill={
                    hasSeries
                      ? colorForSeries(point.series ?? "__all__")
                      : "currentColor"
                  }
                  fillOpacity={hoveredIndex === point.rawIndex ? 0.95 : 0.72}
                  onMouseEnter={() => setHoveredIndex(point.rawIndex)}
                />
              );
            })}

          {plotPointerForDisplay && (
            <>
              <line
                className="chart-crosshair-y"
                x1={margin.left}
                y1={plotPointerForDisplay.svgY}
                x2={plotPointerForDisplay.svgX}
                y2={plotPointerForDisplay.svgY}
              />
              {payload.chartType !== "bar" && (
                <line
                  className="chart-crosshair-x"
                  x1={plotPointerForDisplay.svgX}
                  y1={height - margin.bottom}
                  x2={plotPointerForDisplay.svgX}
                  y2={plotPointerForDisplay.svgY}
                />
              )}
            </>
          )}
        </g>

        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left}
          y2={height - margin.bottom}
          stroke="currentColor"
          strokeOpacity={0.6}
        />
        <line
          x1={margin.left}
          y1={height - margin.bottom}
          x2={width - margin.right}
          y2={height - margin.bottom}
          stroke="currentColor"
          strokeOpacity={0.6}
        />

        {xTickItems.map((tick) => {
          const tickY = height - margin.bottom;
          const textY = tickY + 14;
          if (hasCategoricalXAxis && payload.chartType === "bar") {
            return (
              <g key={tick.key}>
                <line
                  x1={tick.position}
                  y1={tickY}
                  x2={tick.position}
                  y2={tickY + 4}
                  stroke="currentColor"
                  strokeOpacity={0.6}
                />
                <text
                  x={tick.position}
                  y={textY}
                  textAnchor="end"
                  fontSize="10"
                  fill="currentColor"
                  opacity={0.72}
                  transform={`rotate(-30 ${tick.position} ${textY})`}
                >
                  {tick.label}
                </text>
              </g>
            );
          }
          return (
            <g key={tick.key}>
              <line
                x1={tick.position}
                y1={tickY}
                x2={tick.position}
                y2={tickY + 4}
                stroke="currentColor"
                strokeOpacity={0.6}
              />
              <text
                x={tick.position}
                y={textY}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                opacity={0.72}
              >
                {tick.label}
              </text>
            </g>
          );
        })}

        {dragState?.mode === "zoom_box" && (
          <rect
            className="chart-zoom-rect"
            x={Math.min(dragState.startX, dragState.endX)}
            y={Math.min(dragState.startY, dragState.endY)}
            width={Math.abs(dragState.endX - dragState.startX)}
            height={Math.abs(dragState.endY - dragState.startY)}
          />
        )}

        <text
          x={margin.left + plotWidth / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize="11"
          fill="currentColor"
          opacity={0.78}
        >
          {payload.xAxisLabel?.trim() || payload.xColumn}
        </text>
        <text
          x={14}
          y={margin.top + plotHeight / 2}
          textAnchor="middle"
          fontSize="11"
          fill="currentColor"
          opacity={0.78}
          transform={`rotate(-90 14 ${margin.top + plotHeight / 2})`}
        >
          {payload.yAxisLabel?.trim() || payload.yColumn}
        </text>
      </svg>
      <div className="hint-line">
        {(payload.xAxisLabel?.trim() || payload.xColumn)} vs{" "}
        {(payload.yAxisLabel?.trim() || payload.yColumn)} |{" "}
        {visiblePoints.length.toLocaleString()} of {points.length.toLocaleString()} points | x: {coordinateX} | y: {coordinateY}
        {hasSeries ? ` | series: ${coordinateSeries}` : ""}
        {bestFitLine ? ` | fit: y = ${bestFitLine.slope.toPrecision(4)}x + ${bestFitLine.intercept.toPrecision(4)}` : ""}
      </div>
    </div>
  );
}
function NotebookView({
  queryResult,
  notebookBlocks,
  onRerunNotebookBlock,
  onDeleteNotebookBlock,
  onLoadMoreTableRows
}: Pick<
  ResultsWindowProps,
  | "queryResult"
  | "notebookBlocks"
  | "onRerunNotebookBlock"
  | "onDeleteNotebookBlock"
  | "onLoadMoreTableRows"
>) {
  const [expandedPreview, setExpandedPreview] = useState<
    | {
        kind: "table";
        title: string;
        columns: string[];
        rows: PrimitiveValue[][];
        rowCount: number;
        querySql?: string;
        queryTarget?: QueryTargetRef;
      }
    | {
        kind: "chart";
        title: string;
        payload: NotebookChartPayload;
      }
    | null
  >(null);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [embedMessage, setEmbedMessage] = useState("");
  const tableLoadChunkSize = 250;

  useEffect(() => {
    setLoadMoreError("");
    setLoadingMore(false);
  }, [expandedPreview]);

  useEffect(() => {
    if (!embedMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setEmbedMessage("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [embedMessage]);

  const onLoadMoreExpandedRows = async () => {
    if (
      !expandedPreview ||
      expandedPreview.kind !== "table" ||
      !expandedPreview.querySql ||
      !expandedPreview.queryTarget ||
      !onLoadMoreTableRows ||
      isLoadingMore
    ) {
      return;
    }
    setLoadMoreError("");
    setLoadingMore(true);
    try {
      const payload = await onLoadMoreTableRows({
        querySql: expandedPreview.querySql,
        queryTarget: expandedPreview.queryTarget,
        offset: expandedPreview.rows.length,
        limit: tableLoadChunkSize
      });
      setExpandedPreview((current) => {
        if (!current || current.kind !== "table") {
          return current;
        }
        const nextRows = [...current.rows, ...payload.rows];
        return {
          ...current,
          columns: payload.columns.length > 0 ? payload.columns : current.columns,
          rowCount: payload.rowCount,
          rows: nextRows
        };
      });
    } catch (error) {
      setLoadMoreError(String(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const onCopyEmbed = async (input: Parameters<typeof buildEmbedSnippet>[0]) => {
    try {
      const snippet = buildEmbedSnippet(input);
      await copyToClipboard(snippet);
      setEmbedMessage(`Embed snippet copied for "${input.title}".`);
    } catch (error) {
      setEmbedMessage(`Embed copy failed: ${String(error)}`);
    }
  };

  return (
    <div className="pane-body scroll-pane">
      <h3>Latest Query Result</h3>
      {queryResult ? (
        <div
          className="expandable-preview"
          role="button"
          tabIndex={0}
          onClick={() =>
            setExpandedPreview({
              kind: "table",
              title: "Latest Query Result",
              columns: queryResult.columns,
              rows: queryResult.rows,
              rowCount: queryResult.rowCount,
              querySql: queryResult.querySql,
              queryTarget: queryResult.queryTarget
            })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExpandedPreview({
                kind: "table",
                title: "Latest Query Result",
                columns: queryResult.columns,
                rows: queryResult.rows,
                rowCount: queryResult.rowCount,
                querySql: queryResult.querySql,
                queryTarget: queryResult.queryTarget
              });
            }
          }}
          aria-label="Expand latest query result"
        >
          <DataGrid
            className="notebook-preview-grid"
            columns={queryResult.columns}
            rows={queryResult.rows.slice(0, 14)}
            emptyText="Run a query to see results."
          />
          <div className="hint-line">
            Click table to expand. Showing {Math.min(queryResult.rows.length, 14)} of{" "}
            {queryResult.rowCount.toLocaleString()} rows.
          </div>
          <div className="inline-row">
            <button
              type="button"
              className="btn btn-secondary compact"
              onClick={(event) => {
                event.stopPropagation();
                void onCopyEmbed({
                  kind: "table",
                  title: "Latest Query Result",
                  payload: {
                    columns: queryResult.columns,
                    rows: queryResult.rows,
                    rowCount: queryResult.rowCount
                  },
                  querySql: queryResult.querySql,
                  queryTarget: queryResult.queryTarget
                });
              }}
            >
              Embed Latest
            </button>
          </div>
        </div>
      ) : (
        <DataGrid columns={[]} rows={[]} emptyText="Run a query to see results." />
      )}
      <h3>Notebook Blocks</h3>
      {embedMessage ? <div className="hint-line">{embedMessage}</div> : null}
      {notebookBlocks.length === 0 ? (
        <div className="empty-box">No notebook blocks saved yet.</div>
      ) : (
        <ul className="list-block notebook-list">
          {notebookBlocks.map((block) => {
            const testSummary =
              block.type === "test" || block.type === "model"
                ? getTestSummary(block.payload)
                : null;
            const chartPayload =
              block.type === "chart" && isChartPayload(block.payload)
                ? block.payload
                : null;
            const tablePayload =
              block.type === "table" && isTablePayload(block.payload)
                ? block.payload
                : null;
            const olsPayload =
              block.type === "model" && isOLSRegressionPayload(block.payload)
                ? block.payload
                : null;
            const olsCoefficientColumns = [
              "Term",
              "Estimate",
              "Std Error",
              "t Stat",
              "p Value"
            ];
            const olsCoefficientRows =
              olsPayload?.coefficients.map((coefficient) => [
                coefficient.term,
                formatStatValue(coefficient.estimate),
                formatStatValue(coefficient.standardError),
                formatStatValue(coefficient.tStatistic),
                formatStatValue(coefficient.pValue)
              ]) ?? [];
            const olsResidualSummaryColumns = [
              "Residual Mean",
              "Residual Std",
              "Residual Min",
              "Residual 25%",
              "Residual 50%",
              "Residual 75%",
              "Residual Max",
              "RMSE",
              "MAE"
            ];
            const olsResidualSummaryRows = olsPayload
              ? [
                  [
                    formatStatValue(olsPayload.residualSummary.mean),
                    formatStatValue(olsPayload.residualSummary.std),
                    formatStatValue(olsPayload.residualSummary.min),
                    formatStatValue(olsPayload.residualSummary.q25),
                    formatStatValue(olsPayload.residualSummary.q50),
                    formatStatValue(olsPayload.residualSummary.q75),
                    formatStatValue(olsPayload.residualSummary.max),
                    formatStatValue(olsPayload.residualSummary.rmse),
                    formatStatValue(olsPayload.residualSummary.mae)
                  ]
                ]
              : [];
            const olsResidualChartPayload: NotebookChartPayload | null =
              olsPayload && olsPayload.residualsVsFitted.points.length > 0
                ? {
                    kind: "chart_v1",
                    chartType: "scatter",
                    title: "Residuals vs Fitted",
                    xColumn: "fitted",
                    yColumn: "residual",
                    xAxisLabel: "Fitted",
                    yAxisLabel: "Residual",
                    points: olsPayload.residualsVsFitted.points.map((point) => ({
                      x: point.fitted,
                      y: point.residual
                    }))
                  }
                : null;
            const olsObservedVsFittedChartPayload: NotebookChartPayload | null =
              olsPayload && olsPayload.residualsVsFitted.points.length > 0
                ? {
                    kind: "chart_v1",
                    chartType: "scatter",
                    title: "Observed vs Fitted",
                    xColumn: "fitted",
                    yColumn: "observed",
                    xAxisLabel: "Fitted",
                    yAxisLabel: "Observed",
                    points: olsPayload.residualsVsFitted.points.map((point) => ({
                      x: point.fitted,
                      y: point.fitted + point.residual
                    }))
                  }
                : null;
            const olsResidualHistogramPayload: NotebookChartPayload | null =
              olsPayload && olsPayload.residualsVsFitted.points.length > 0
                ? {
                    kind: "chart_v1",
                    chartType: "histogram",
                    title: "Residual Distribution",
                    xColumn: "residual",
                    yColumn: "count",
                    xAxisLabel: "Residual",
                    yAxisLabel: "Count",
                    points: buildHistogramPoints(
                      olsPayload.residualsVsFitted.points.map((point) => point.residual)
                    )
                  }
                : null;
            const olsQqChartPayload: NotebookChartPayload | null =
              olsPayload &&
              olsPayload.qqPlot &&
              olsPayload.qqPlot.points.length > 0
                ? {
                    kind: "chart_v1",
                    chartType: "scatter",
                    title: "Normal Q-Q Plot",
                    xColumn: "theoretical_quantile",
                    yColumn: "standardized_residual",
                    xAxisLabel: "Theoretical Quantile",
                    yAxisLabel: "Standardized Residual",
                    points: olsPayload.qqPlot.points.map((point) => ({
                      x: point.theoreticalQuantile,
                      y: point.standardizedResidual
                    }))
                  }
                : null;
            const olsLeverageChartPayload: NotebookChartPayload | null =
              olsPayload &&
              olsPayload.leverageVsResidual &&
              olsPayload.leverageVsResidual.points.length > 0
                ? {
                    kind: "chart_v1",
                    chartType: "scatter",
                    title: "Leverage vs Standardized Residual",
                    xColumn: "leverage",
                    yColumn: "standardized_residual",
                    xAxisLabel: "Leverage",
                    yAxisLabel: "Standardized Residual",
                    points: olsPayload.leverageVsResidual.points.map((point) => ({
                      x: point.leverage,
                      y: point.standardizedResidual
                    }))
                  }
                : null;
            const olsInfluenceColumns = [
              "Row",
              "Leverage",
              "Std Residual",
              "Cook's Distance"
            ];
            const olsInfluenceRows =
              olsPayload?.topInfluencePoints?.map((point) => [
                point.rowIndex.toLocaleString(),
                formatStatValue(point.leverage),
                formatStatValue(point.standardizedResidual),
                formatStatValue(point.cooksDistance)
              ]) ?? [];
            const canRerun =
              !!block.querySql &&
              !!block.queryTarget &&
              (block.type === "table" ||
                block.type === "chart" ||
                ((block.type === "test" || block.type === "model") &&
                  !!block.analysisRequest));

            return (
              <li
                key={block.id}
                className={chartPayload ? "list-row chart-row" : "list-row"}
              >
                <div className="notebook-row-content">
                  <div className="list-title">{block.title}</div>
                  <div className="list-subtitle">
                    {block.type}
                    {testSummary ? ` | ${testSummary}` : ""}
                  </div>
                  {chartPayload ? (
                    <ChartBlockView
                      payload={chartPayload}
                      onExpand={() =>
                        setExpandedPreview({
                          kind: "chart",
                          title: block.title,
                          payload: chartPayload
                        })
                      }
                    />
                  ) : null}
                  {tablePayload ? (
                    <div
                      className="expandable-preview"
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setExpandedPreview({
                          kind: "table",
                          title: block.title,
                          columns: tablePayload.columns,
                          rows: tablePayload.rows,
                          rowCount: tablePayload.rowCount,
                          querySql: block.querySql,
                          queryTarget: block.queryTarget
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setExpandedPreview({
                            kind: "table",
                            title: block.title,
                            columns: tablePayload.columns,
                            rows: tablePayload.rows,
                            rowCount: tablePayload.rowCount,
                            querySql: block.querySql,
                            queryTarget: block.queryTarget
                          });
                        }
                      }}
                      aria-label={`Expand ${block.title}`}
                    >
                      <DataGrid
                        className="notebook-preview-grid"
                        columns={tablePayload.columns}
                        rows={tablePayload.rows.slice(0, 12)}
                        emptyText="No rows"
                      />
                      <div className="hint-line">
                        Click table to expand. Showing{" "}
                        {Math.min(tablePayload.rows.length, 12)} of{" "}
                        {tablePayload.rowCount.toLocaleString()} rows.
                      </div>
                    </div>
                  ) : null}
                  {olsPayload ? (
                    <div className="result-model-details">
                      <div className="hint-line">
                        R²={formatStatValue(olsPayload.r2)} | Adjusted R²=
                        {formatStatValue(olsPayload.adjustedR2)} | n=
                        {olsPayload.n.toLocaleString()} | Dropped rows=
                        {olsPayload.completeCases.droppedRows.toLocaleString()}
                      </div>
                      <div
                        className="expandable-preview"
                        role="button"
                        tabIndex={0}
                        aria-label={`Expand ${block.title} coefficients`}
                        onClick={() =>
                          setExpandedPreview({
                            kind: "table",
                            title: `${block.title} Coefficients`,
                            columns: olsCoefficientColumns,
                            rows: olsCoefficientRows,
                            rowCount: olsCoefficientRows.length
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setExpandedPreview({
                              kind: "table",
                              title: `${block.title} Coefficients`,
                              columns: olsCoefficientColumns,
                              rows: olsCoefficientRows,
                              rowCount: olsCoefficientRows.length
                            });
                          }
                        }}
                      >
                        <DataGrid
                          className="notebook-model-grid"
                          columns={olsCoefficientColumns}
                          rows={olsCoefficientRows}
                          emptyText="No coefficients."
                        />
                        <div className="hint-line">Click table to expand.</div>
                      </div>
                      <div
                        className="expandable-preview"
                        role="button"
                        tabIndex={0}
                        aria-label={`Expand ${block.title} residual summary`}
                        onClick={() =>
                          setExpandedPreview({
                            kind: "table",
                            title: `${block.title} Residual Summary`,
                            columns: olsResidualSummaryColumns,
                            rows: olsResidualSummaryRows,
                            rowCount: olsResidualSummaryRows.length
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setExpandedPreview({
                              kind: "table",
                              title: `${block.title} Residual Summary`,
                              columns: olsResidualSummaryColumns,
                              rows: olsResidualSummaryRows,
                              rowCount: olsResidualSummaryRows.length
                            });
                          }
                        }}
                      >
                        <DataGrid
                          className="notebook-model-grid"
                          columns={olsResidualSummaryColumns}
                          rows={olsResidualSummaryRows}
                          emptyText="No residual summary."
                        />
                        <div className="hint-line">Click table to expand.</div>
                      </div>
                      <div className="hint-line">
                        Residual diagnostic points:{" "}
                        {olsPayload.residualsVsFitted.points.length.toLocaleString()} of{" "}
                        {olsPayload.residualsVsFitted.totalPoints.toLocaleString()}
                        {olsPayload.residualsVsFitted.sampled ? " (sampled)" : ""}
                      </div>
                      {olsResidualChartPayload && (
                        <ChartBlockView
                          payload={olsResidualChartPayload}
                          onExpand={() =>
                            setExpandedPreview({
                              kind: "chart",
                              title: `${block.title} Residuals vs Fitted`,
                              payload: olsResidualChartPayload
                            })
                          }
                        />
                      )}
                      {olsObservedVsFittedChartPayload && (
                        <ChartBlockView
                          payload={olsObservedVsFittedChartPayload}
                          onExpand={() =>
                            setExpandedPreview({
                              kind: "chart",
                              title: `${block.title} Observed vs Fitted`,
                              payload: olsObservedVsFittedChartPayload
                            })
                          }
                        />
                      )}
                      {olsResidualHistogramPayload &&
                        olsResidualHistogramPayload.points.length > 0 && (
                          <ChartBlockView
                            payload={olsResidualHistogramPayload}
                            onExpand={() =>
                              setExpandedPreview({
                                kind: "chart",
                                title: `${block.title} Residual Distribution`,
                              payload: olsResidualHistogramPayload
                            })
                          }
                        />
                      )}
                      {olsQqChartPayload && (
                        <ChartBlockView
                          payload={olsQqChartPayload}
                          onExpand={() =>
                            setExpandedPreview({
                              kind: "chart",
                              title: `${block.title} Normal Q-Q`,
                              payload: olsQqChartPayload
                            })
                          }
                        />
                      )}
                      {olsLeverageChartPayload && (
                        <ChartBlockView
                          payload={olsLeverageChartPayload}
                          onExpand={() =>
                            setExpandedPreview({
                              kind: "chart",
                              title: `${block.title} Leverage vs Residual`,
                              payload: olsLeverageChartPayload
                            })
                          }
                        />
                      )}
                      {olsInfluenceRows.length > 0 && (
                        <div
                          className="expandable-preview"
                          role="button"
                          tabIndex={0}
                          aria-label={`Expand ${block.title} influence points`}
                          onClick={() =>
                            setExpandedPreview({
                              kind: "table",
                              title: `${block.title} Influence Points`,
                              columns: olsInfluenceColumns,
                              rows: olsInfluenceRows,
                              rowCount: olsInfluenceRows.length
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setExpandedPreview({
                                kind: "table",
                                title: `${block.title} Influence Points`,
                                columns: olsInfluenceColumns,
                                rows: olsInfluenceRows,
                                rowCount: olsInfluenceRows.length
                              });
                            }
                          }}
                        >
                          <DataGrid
                            className="notebook-model-grid"
                            columns={olsInfluenceColumns}
                            rows={olsInfluenceRows}
                            emptyText="No influence rows."
                          />
                          <div className="hint-line">Click table to expand.</div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="inline-row notebook-actions">
                  <span className="hint-line">
                    {new Date(block.createdAt).toLocaleTimeString()}
                  </span>
                  {(tablePayload || chartPayload || olsPayload) && (
                    <button
                      type="button"
                      className="btn btn-secondary compact"
                      onClick={() =>
                        setExpandedPreview(
                          tablePayload
                            ? {
                                kind: "table",
                                title: block.title,
                                columns: tablePayload.columns,
                                rows: tablePayload.rows,
                                rowCount: tablePayload.rowCount,
                                querySql: block.querySql,
                                queryTarget: block.queryTarget
                              }
                            : chartPayload || olsResidualChartPayload
                              ? {
                                  kind: "chart",
                                  title: block.title,
                                  payload: (chartPayload ??
                                    olsResidualChartPayload) as NotebookChartPayload
                                }
                              : {
                                  kind: "table",
                                  title: `${block.title} Coefficients`,
                                  columns: olsCoefficientColumns,
                                  rows: olsCoefficientRows,
                                  rowCount: olsCoefficientRows.length
                                }
                        )
                      }
                    >
                      Expand
                    </button>
                  )}
                  {(tablePayload || chartPayload || olsPayload) && (
                    <button
                      type="button"
                      className="btn btn-secondary compact"
                      onClick={() => {
                        void onCopyEmbed(
                          tablePayload
                            ? {
                                kind: "table",
                                title: block.title,
                                payload: tablePayload,
                                querySql: block.querySql,
                                queryTarget: block.queryTarget
                              }
                            : chartPayload
                              ? {
                                  kind: "chart",
                                  title: block.title,
                                  payload: chartPayload,
                                  querySql: block.querySql,
                                  queryTarget: block.queryTarget
                                }
                              : {
                                  kind: "model",
                                  title: block.title,
                                  payload: olsPayload
                                }
                        );
                      }}
                    >
                      Embed
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    onClick={() => onRerunNotebookBlock(block.id)}
                    disabled={!canRerun}
                  >
                    Rerun
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost compact danger"
                    onClick={() => onDeleteNotebookBlock(block.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {expandedPreview && (
        <div
          className="modal-backdrop"
          onClick={() => setExpandedPreview(null)}
        >
          <div
            className="impact-modal result-expand-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="inline-row spread">
              <h3>{expandedPreview.title}</h3>
              <button
                type="button"
                className="btn btn-ghost compact"
                onClick={() => setExpandedPreview(null)}
              >
                Close
              </button>
            </div>
            {expandedPreview.kind === "table" ? (
              <>
                <DataGrid
                  className="notebook-expanded-grid"
                  columns={expandedPreview.columns}
                  rows={expandedPreview.rows}
                  emptyText="No rows."
                />
                <div className="inline-row notebook-expand-actions">
                  <span className="hint-line">
                    Showing {expandedPreview.rows.length.toLocaleString()} of{" "}
                    {expandedPreview.rowCount.toLocaleString()} rows.
                  </span>
                  {expandedPreview.querySql &&
                    expandedPreview.queryTarget &&
                    onLoadMoreTableRows &&
                    expandedPreview.rows.length < expandedPreview.rowCount && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          void onLoadMoreExpandedRows();
                        }}
                        disabled={isLoadingMore}
                      >
                        {isLoadingMore ? "Loading..." : "Load 250 more rows"}
                      </button>
                    )}
                </div>
                {loadMoreError ? <div className="storage-mode-banner">{loadMoreError}</div> : null}
              </>
            ) : (
              <ChartBlockView payload={expandedPreview.payload} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type DescribeScope = "data" | "transforms" | "queries";

function DescribeView({
  profile,
  describeOptions,
  onDescribe
}: Pick<ResultsWindowProps, "profile" | "describeOptions" | "onDescribe">) {
  const [scope, setScope] = useState<DescribeScope>("data");
  const [selectedKey, setSelectedKey] = useState("");
  const options = describeOptions[scope];

  useEffect(() => {
    if (options.length === 0) {
      setSelectedKey("");
      return;
    }
    if (!options.some((option) => option.key === selectedKey)) {
      setSelectedKey(options[0].key);
    }
  }, [options, selectedKey]);

  const selectedOption =
    options.find((option) => option.key === selectedKey) ?? null;

  const describeColumns = useMemo(
    () => [
      "Column",
      "Type",
      "Count",
      "Distinct",
      "Null",
      "Top Values",
      "Mean",
      "Std",
      "Min",
      "25%",
      "50%",
      "75%",
      "Max"
    ],
    []
  );
  const describeRows = useMemo(
    () =>
      profile
        ? profile.columns.map((column) => [
            column.column,
            column.type,
            column.count,
            column.distinctCount,
            column.nullCount,
            formatTopValues(column.topValues),
            formatProfileNumber(column.mean),
            formatProfileNumber(column.std),
            formatProfileValue(column.min),
            formatProfileNumber(column.q25),
            formatProfileNumber(column.q50),
            formatProfileNumber(column.q75),
            formatProfileValue(column.max)
          ])
        : [],
    [profile]
  );

  return (
    <div className="pane-body scroll-pane">
      <div className="describe-source-tabs">
        <button
          type="button"
          className={scope === "data" ? "describe-source-btn active" : "describe-source-btn"}
          onClick={() => setScope("data")}
        >
          Data
        </button>
        <button
          type="button"
          className={scope === "transforms" ? "describe-source-btn active" : "describe-source-btn"}
          onClick={() => setScope("transforms")}
        >
          Transforms
        </button>
        <button
          type="button"
          className={scope === "queries" ? "describe-source-btn active" : "describe-source-btn"}
          onClick={() => setScope("queries")}
        >
          Queries
        </button>
      </div>

      <div className="inline-row">
        <label htmlFor="describe-target-select">Target:</label>
        <select
          id="describe-target-select"
          value={selectedKey}
          disabled={options.length === 0}
          onChange={(event) => setSelectedKey(event.target.value)}
        >
          {options.length === 0 ? (
            <option value="">No options available</option>
          ) : (
            options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!selectedOption}
          onClick={() => {
            if (!selectedOption) {
              return;
            }
            onDescribe(selectedOption.target);
          }}
        >
          Describe
        </button>
      </div>

      {!profile ? (
        <div className="empty-box">Choose a target and click Describe.</div>
      ) : (
        <>
          <div className="inline-row spread">
            <h3>{profile.tableName}</h3>
            <span className="hint-line">{profile.rowCount.toLocaleString()} rows</span>
          </div>
          <DataGrid columns={describeColumns} rows={describeRows} />
        </>
      )}
    </div>
  );
}

export function ResultsWindow({
  tab,
  onTabChange,
  queryResult,
  notebookBlocks,
  onRerunNotebookBlock,
  onDeleteNotebookBlock,
  onLoadMoreTableRows,
  profile,
  describeOptions,
  onDescribe
}: ResultsWindowProps) {
  return (
    <section className="window results-window">
      <TabBar
        value={tab}
        onChange={onTabChange}
        tabs={[
          { id: "notebook", label: "Notebook" },
          { id: "describe", label: "Describe" }
        ]}
      />
      {tab === "notebook" && (
        <NotebookView
          queryResult={queryResult}
          notebookBlocks={notebookBlocks}
          onRerunNotebookBlock={onRerunNotebookBlock}
          onDeleteNotebookBlock={onDeleteNotebookBlock}
          onLoadMoreTableRows={onLoadMoreTableRows}
        />
      )}
      {tab === "describe" && (
        <DescribeView
          profile={profile}
          describeOptions={describeOptions}
          onDescribe={onDescribe}
        />
      )}
    </section>
  );
}
