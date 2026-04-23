import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  CastColumnStep,
  ChiSquareTestResult,
  ColumnSchemaEdit,
  CorrelationMethod,
  DummyVariablesStep,
  FilterStep,
  GroupAggregateStep,
  JoinStep,
  MergeMode,
  MissingValuesStep,
  MutateColumnStep,
  NotebookChartPayload,
  NotebookChartType,
  NotebookBlock,
  OLSRegressionResult,
  PearsonCorrelationResult,
  PipelineStep,
  PrimitiveValue,
  PivotStep,
  QueryTargetRef,
  RemoveDuplicatesStep,
  ScaleNumericStep,
  SQLTransformStep,
  SavedQuery,
  SavedQueryVersion,
  SortRowsStep,
  StatisticalTestRequest,
  SelectColumnsStep,
  TableProfile,
  TablePreview,
  WelchTTestResult
} from "../shared/types";
import { normalizePipelineSteps } from "../pipeline/validation";
import type { WorkerResponse } from "../shared/workerProtocol";
import { buildRecipe, parseRecipe } from "../serialization/recipe";
import {
  CHART_QUERY_MAX_ROWS,
  OLS_DIAGNOSTIC_MAX_POINTS
} from "../shared/limits";
import {
  applyImpactDecisions,
  formatQueryTarget,
  getActiveVersion,
  pruneQueryVersions,
  saveQueryVersion,
  validateSavedQueries
} from "../queries/lineage";
import { buildRuntimeSql } from "../queries/runtimeSql";
import { quoteIdentifier, sanitizeIdentifier } from "../shared/sql";
import { DataWindow } from "./components/DataWindow";
import { ConfirmActionModal } from "./components/ConfirmActionModal";
import { DependencyImpactModal } from "./components/DependencyImpactModal";
import { ImportCsvModal } from "./components/ImportCsvModal";
import { ResultsWindow } from "./components/ResultsWindow";
import { WorkWindow } from "./components/WorkWindow";
import { useWorkerClient } from "./hooks/useWorkerClient";
import {
  IMPORT_SAMPLE_ROW_FALLBACK,
  isImportLimitErrorMessage,
  toErrorMessage
} from "./importFallback";
import {
  clearPersistedState,
  getStorageMode,
  loadPersistedState,
  persistState
} from "./localProjectStore";
import { initialState, reducer } from "./state";

function asPayload<T>(response: WorkerResponse): T {
  if (response.status !== "ok") {
    throw new Error(response.error.message);
  }
  return response.payload as T;
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

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!("crypto" in window) || !("subtle" in window.crypto)) {
    return "";
  }
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function hashRuntimeSql(sql: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sql.length; index += 1) {
    hash ^= sql.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function targetKey(target: QueryTargetRef): string {
  switch (target.kind) {
    case "table":
      return `table:${target.tableName}`;
    case "pipeline_step":
      return `pipeline:${target.baseTableName}:${target.stepId}`;
    case "query_version":
      return `query:${target.versionId}`;
    default:
      return "";
  }
}

function clonePipelineSteps(steps: PipelineStep[]): PipelineStep[] {
  if (typeof structuredClone === "function") {
    return structuredClone(steps) as PipelineStep[];
  }
  return JSON.parse(JSON.stringify(steps)) as PipelineStep[];
}

function pipelineSnapshotHash(steps: PipelineStep[]): string {
  const signature = JSON.stringify(
    steps.map((step) => ({
      id: step.id,
      name: step.name,
      type: step.type,
      enabled: step.enabled,
      params: step.params
    }))
  );
  return hashRuntimeSql(signature);
}

function buildPipelineStepTarget(
  baseTableName: string,
  steps: PipelineStep[],
  stepIndex: number
): QueryTargetRef {
  const step = steps[stepIndex];
  if (!step) {
    throw new Error(`Unknown pipeline step index ${stepIndex} for ${baseTableName}.`);
  }
  return {
    kind: "pipeline_step",
    stepId: step.id,
    stepName: step.name,
    baseTableName,
    pipelineSnapshot: clonePipelineSteps(steps.slice(0, stepIndex + 1))
  };
}

function getUpstreamVersionId(target: QueryTargetRef): string {
  switch (target.kind) {
    case "table":
      return target.tableName;
    case "pipeline_step":
      return `pipeline:${target.baseTableName}:${target.stepId}:${pipelineSnapshotHash(
        target.pipelineSnapshot ?? []
      )}`;
    case "query_version":
      return target.versionId;
    default:
      return "";
  }
}

function isSelectLikeSql(sql: string): boolean {
  return /^\s*(with|select)\b/i.test(sql.trim());
}

function toFiniteNumber(value: string | number | boolean | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function computeLinearBestFit(points: Array<{ x: number; y: number }>): {
  slope: number;
  intercept: number;
  r2: number;
} | null {
  if (points.length < 2) {
    return null;
  }
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (Math.abs(sxx) < 1e-12) {
    return null;
  }
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  let sse = 0;
  for (const point of points) {
    const residual = point.y - (slope * point.x + intercept);
    sse += residual * residual;
  }
  const r2 = syy > 0 ? Math.max(0, 1 - sse / syy) : 1;
  return {
    slope,
    intercept,
    r2
  };
}

function formatProfileLabel(target: QueryTargetRef | null): string {
  if (!target) {
    return "Result";
  }
  return formatQueryTarget(target);
}

function renameQueryTarget(
  target: QueryTargetRef,
  queryId: string,
  queryName: string
): QueryTargetRef {
  if (target.kind !== "query_version" || target.queryId !== queryId) {
    return target;
  }
  return {
    ...target,
    queryName
  };
}

function renamePipelineStepTarget(
  target: QueryTargetRef,
  stepId: string,
  stepName: string,
  baseTableName?: string
): QueryTargetRef {
  if (
    target.kind !== "pipeline_step" ||
    target.stepId !== stepId ||
    (baseTableName ? target.baseTableName !== baseTableName : false)
  ) {
    return target;
  }
  return {
    ...target,
    stepName
  };
}

const TABLE_PREVIEW_INITIAL_LIMIT = 20;
const TABLE_PREVIEW_INCREMENT = 10;
const PIPELINE_AUTO_RUN_DELAY_MS = 700;

interface TargetOption {
  key: string;
  label: string;
  target: QueryTargetRef;
}

interface DescribeTargetOption {
  key: string;
  label: string;
  target: QueryTargetRef;
}

type DeleteDialogState =
  | {
      kind: "dataset";
      tableName: string;
    }
  | {
      kind: "all";
    };

interface ImportDialogInput {
  destination: "new" | "existing";
  tableName: string;
  mergeMode: MergeMode;
  delimiter: string;
  hasHeader: boolean;
}

interface ImportCapFallbackState {
  input: ImportDialogInput;
  message: string;
}

interface PruneQueryDialogState {
  queryId: string;
  queryName: string;
  selectedVersionIds: string[];
  removableVersions: Array<{
    versionId: string;
    versionLabel: string;
    createdAt: string;
    targetLabel: string;
    sql: string;
  }>;
}

function normalizeSavedQueries(raw: unknown): SavedQuery[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const now = new Date().toISOString();
  return raw
    .map((entry) => {
      const candidate = entry as Record<string, unknown>;
      if (
        Array.isArray(candidate.versions) &&
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.activeVersionId === "string"
      ) {
        return candidate as unknown as SavedQuery;
      }

      if (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.sql === "string"
      ) {
        const versionId = crypto.randomUUID();
        const target = {
          kind: "table",
          tableName:
            typeof candidate.target === "string"
              ? candidate.target
              : "unknown_table"
        } as QueryTargetRef;
        const version: SavedQueryVersion = {
          versionId,
          sql: candidate.sql,
          target,
          dependsOnVersionIds: [],
          createdAt:
            typeof candidate.createdAt === "string"
              ? candidate.createdAt
              : now
        };
        return {
          id: candidate.id,
          name: candidate.name,
          activeVersionId: versionId,
          versions: [version],
          createdAt:
            typeof candidate.createdAt === "string"
              ? candidate.createdAt
              : now
        };
      }
      return null;
    })
    .filter((entry): entry is SavedQuery => entry !== null);
}

function normalizePipelinesByTable(raw: unknown): Record<string, Array<unknown>> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  const result: Record<string, Array<unknown>> = {};
  for (const [tableName, value] of entries) {
    if (Array.isArray(value)) {
      result[tableName] = value;
    }
  }
  return result;
}

function normalizeActivePipelineStepIdByTable(
  raw: unknown
): Record<string, string | null> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result: Record<string, string | null> = {};
  for (const [tableName, stepId] of Object.entries(raw as Record<string, unknown>)) {
    result[tableName] = typeof stepId === "string" ? stepId : null;
  }
  return result;
}

function normalizeColumnEditsByTable(
  raw: unknown
): Record<string, ColumnSchemaEdit[]> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result: Record<string, ColumnSchemaEdit[]> = {};
  for (const [tableName, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const normalizedEdits: ColumnSchemaEdit[] = value
      .map((entry) => {
        const candidate = entry as Partial<ColumnSchemaEdit>;
        if (
          typeof candidate.id !== "string" ||
          typeof candidate.tableName !== "string" ||
          typeof candidate.fromColumnName !== "string" ||
          typeof candidate.toColumnName !== "string" ||
          typeof candidate.fromType !== "string" ||
          typeof candidate.toType !== "string" ||
          typeof candidate.appliedAt !== "string"
        ) {
          return null;
        }
        return {
          id: candidate.id,
          tableName: candidate.tableName,
          fromColumnName: candidate.fromColumnName,
          toColumnName: candidate.toColumnName,
          fromType: candidate.fromType,
          toType: candidate.toType,
          appliedAt: candidate.appliedAt
        };
      })
      .filter((entry): entry is ColumnSchemaEdit => entry !== null);
    result[tableName] = normalizedEdits;
  }
  return result;
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const worker = useWorkerClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recipeInputRef = useRef<HTMLInputElement>(null);
  const [activeTablePreviewLimit, setActiveTablePreviewLimit] = useState(
    TABLE_PREVIEW_INITIAL_LIMIT
  );
  const [statisticsAvailableColumns, setStatisticsAvailableColumns] = useState<string[]>(
    []
  );
  const [importDialogFiles, setImportDialogFiles] = useState<File[]>([]);
  const [isImportDialogOpen, setImportDialogOpen] = useState(false);
  const [importCapFallback, setImportCapFallback] =
    useState<ImportCapFallbackState | null>(null);
  const [openNewQuerySignal, setOpenNewQuerySignal] = useState(0);
  const [openNewTransformSignal, setOpenNewTransformSignal] = useState(0);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [pruneQueryDialog, setPruneQueryDialog] = useState<PruneQueryDialogState | null>(
    null
  );
  const tablesRef = useRef<TablePreview[]>(state.tables);
  const activeTablePreviewLimitRef = useRef(activeTablePreviewLimit);
  const activeTableNameRef = useRef<string | null>(state.activeTableName);
  const activeQueryTargetRef = useRef<QueryTargetRef | null>(state.activeQueryTarget);
  const lastAutoRunPipelineSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    tablesRef.current = state.tables;
  }, [state.tables]);

  useEffect(() => {
    activeTablePreviewLimitRef.current = activeTablePreviewLimit;
  }, [activeTablePreviewLimit]);

  useEffect(() => {
    activeTableNameRef.current = state.activeTableName;
  }, [state.activeTableName]);

  useEffect(() => {
    activeQueryTargetRef.current = state.activeQueryTarget;
  }, [state.activeQueryTarget]);

  const previewTable = useMemo(
    () => state.tables.find((table) => table.tableName === state.activeTableName) ?? null,
    [state.tables, state.activeTableName]
  );
  const transformTable = useMemo(
    () =>
      state.tables.find((table) => table.tableName === state.selectedTransformTableName) ??
      null,
    [state.tables, state.selectedTransformTableName]
  );
  const transformPipelineSteps = useMemo(
    () =>
      state.selectedTransformTableName
        ? state.pipelinesByTable[state.selectedTransformTableName] ?? []
        : [],
    [state.pipelinesByTable, state.selectedTransformTableName]
  );
  const pipelineAutoRunSignature = useMemo(
    () =>
      state.selectedTransformTableName
        ? JSON.stringify({
            table: state.selectedTransformTableName,
            steps: transformPipelineSteps.map((step) => ({
              id: step.id,
              name: step.name,
              type: step.type,
              enabled: step.enabled,
              params: step.params
            }))
          })
        : "",
    [state.selectedTransformTableName, transformPipelineSteps]
  );
  const activeQuery = useMemo(
    () => state.savedQueries.find((query) => query.id === state.activeQueryId) ?? null,
    [state.savedQueries, state.activeQueryId]
  );
  const activePipelineStep = useMemo(
    () =>
      transformPipelineSteps.find(
        (step) =>
          step.id ===
          (state.selectedTransformTableName
            ? state.activePipelineStepIdByTable[state.selectedTransformTableName] ?? null
            : null)
      ) ?? null,
    [
      state.activePipelineStepIdByTable,
      state.selectedTransformTableName,
      transformPipelineSteps
    ]
  );
  const availableColumns = useMemo(
    () => transformTable?.columns.map((column) => column.name) ?? [],
    [transformTable]
  );
  const tableColumnOptions = useMemo(
    () =>
      state.tables.map((table) => ({
        tableName: table.tableName,
        columns: table.columns.map((column) => column.name)
      })),
    [state.tables]
  );
  const executionTarget = useMemo<QueryTargetRef | null>(
    () => state.activeQueryTarget,
    [state.activeQueryTarget]
  );
  const transformExecutionTarget = useMemo<QueryTargetRef | null>(
    () =>
      state.selectedTransformTableName
        ? { kind: "table", tableName: state.selectedTransformTableName }
        : null,
    [state.selectedTransformTableName]
  );
  const firstTableName = state.tables[0]?.tableName ?? null;

  const buildRuntimeSqlForTarget = useCallback(
    (userSql: string, target: QueryTargetRef | null) =>
      buildRuntimeSql({
        userSql,
        fallbackTableName: firstTableName,
        target,
        savedQueries: state.savedQueries,
        pipelineSteps: [],
        pipelineStepsByTable: state.pipelinesByTable
      }),
    [firstTableName, state.pipelinesByTable, state.savedQueries]
  );

  const buildPipelineStateHash = useCallback(
    (querySql: string, target: QueryTargetRef | null): string =>
      hashRuntimeSql(buildRuntimeSqlForTarget(querySql, target)),
    [buildRuntimeSqlForTarget]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadStatisticsColumns() {
      if (!executionTarget) {
        setStatisticsAvailableColumns([]);
        return;
      }

      if (executionTarget.kind === "table") {
        const table = state.tables.find(
          (entry) => entry.tableName === executionTarget.tableName
        );
        const cachedColumns = table?.columns.map((column) => column.name) ?? [];
        if (cachedColumns.length > 0) {
          setStatisticsAvailableColumns(cachedColumns);
          return;
        }
      }
      setStatisticsAvailableColumns([]);

      try {
        const runtimeSql = buildRuntimeSqlForTarget(
          "SELECT * FROM source",
          executionTarget
        );
        const response = await worker.sendLatest("load_statistics_columns", {
          type: "RUN_SQL",
          payload: {
            sql: runtimeSql,
            limit: 1,
            includeTotalRowCount: false
          }
        });
        if (cancelled) {
          return;
        }
        const payload = asPayload<{
          columns: string[];
          rows: Array<Array<string | number | boolean | null>>;
          rowCount: number;
        }>(response);
        setStatisticsAvailableColumns(payload.columns);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        setStatisticsAvailableColumns([]);
      }
    }

    void loadStatisticsColumns();

    return () => {
      cancelled = true;
    };
  }, [
    buildRuntimeSqlForTarget,
    executionTarget,
    state.tables,
    worker
  ]);

  const targetOptions = useMemo(() => {
    const options: TargetOption[] = [];
    const seen = new Set<string>();
    const byVersionId = new Map<
      string,
      { queryId: string; queryName: string; versionNumber: number }
    >();

    const pushTarget = (target: QueryTargetRef, label: string) => {
      const key = targetKey(target);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      options.push({ key, label, target });
    };

    for (const query of state.savedQueries) {
      query.versions.forEach((version, index) => {
        byVersionId.set(version.versionId, {
          queryId: query.id,
          queryName: query.name,
          versionNumber: index + 1
        });
      });
    }

    for (const table of state.tables) {
      const target: QueryTargetRef = {
        kind: "table",
        tableName: table.tableName
      };
      pushTarget(target, `Table: ${table.tableName}`);
    }

    for (const table of state.tables) {
      const steps = state.pipelinesByTable[table.tableName] ?? [];
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const target = buildPipelineStepTarget(table.tableName, steps, index);
        pushTarget(target, `Pipeline: ${table.tableName} / ${step.name}`);
      }
    }

    for (const query of state.savedQueries) {
      const version = getActiveVersion(query);
      const target: QueryTargetRef = {
        kind: "query_version",
        queryId: query.id,
        queryName: query.name,
        versionId: version.versionId
      };
      const activeIndex =
        query.versions.findIndex((entry) => entry.versionId === version.versionId) + 1;
      pushTarget(target, `Query: ${query.name} (active v${Math.max(activeIndex, 1)})`);
    }

    for (const query of state.savedQueries) {
      const activeVersion = getActiveVersion(query);
      if (activeVersion.target.kind !== "query_version") {
        continue;
      }
      const owner = byVersionId.get(activeVersion.target.versionId);
      const target: QueryTargetRef = owner
        ? {
            kind: "query_version",
            queryId: owner.queryId,
            queryName: owner.queryName,
            versionId: activeVersion.target.versionId
          }
        : activeVersion.target;
      const label = owner
        ? `Query: ${owner.queryName} (pinned v${owner.versionNumber})`
        : `Query: ${activeVersion.target.queryName} (pinned)`;
      pushTarget(target, label);
    }

    if (state.activeQueryTarget?.kind === "query_version") {
      const owner = byVersionId.get(state.activeQueryTarget.versionId);
      const target: QueryTargetRef = owner
        ? {
            kind: "query_version",
            queryId: owner.queryId,
            queryName: owner.queryName,
            versionId: state.activeQueryTarget.versionId
          }
        : state.activeQueryTarget;
      const label = owner
        ? `Query: ${owner.queryName} (pinned v${owner.versionNumber})`
        : `Query: ${state.activeQueryTarget.queryName} (pinned)`;
      pushTarget(target, label);
    }

    if (state.activeQueryTarget?.kind === "pipeline_step") {
      pushTarget(
        state.activeQueryTarget,
        `Pipeline: ${state.activeQueryTarget.stepName}`
      );
    }

    return options;
  }, [
    state.activeQueryTarget,
    state.pipelinesByTable,
    state.savedQueries,
    state.tables
  ]);

  const describeTargetOptions = useMemo(() => {
    const dataOptions: DescribeTargetOption[] = state.tables.map((table) => ({
      key: `table:${table.tableName}`,
      label: table.tableName,
      target: {
        kind: "table",
        tableName: table.tableName
      }
    }));

    const transformOptions: DescribeTargetOption[] = state.tables.flatMap((table) => {
      const steps = state.pipelinesByTable[table.tableName] ?? [];
      return steps.map((step, index) => ({
        key: `pipeline:${table.tableName}:${step.id}`,
        label: `${table.tableName} / ${step.name}`,
        target: buildPipelineStepTarget(table.tableName, steps, index)
      }));
    });

    const queryOptions: DescribeTargetOption[] = state.savedQueries.map((query) => {
      const version = getActiveVersion(query);
      return {
        key: `query:${version.versionId}`,
        label: query.name,
        target: {
          kind: "query_version",
          queryId: query.id,
          queryName: query.name,
          versionId: version.versionId
        }
      };
    });

    return {
      data: dataOptions,
      transforms: transformOptions,
      queries: queryOptions
    };
  }, [state.pipelinesByTable, state.savedQueries, state.tables]);

  const targetLookup = useMemo(() => {
    const map = new Map<string, QueryTargetRef>();
    for (const option of targetOptions) {
      map.set(option.key, option.target);
    }
    return map;
  }, [targetOptions]);

  useEffect(() => {
    if (targetOptions.length === 0) {
      return;
    }
    if (!state.activeQueryTarget) {
      dispatch({
        type: "SET_QUERY_TARGET",
        target: targetOptions[0].target
      });
      return;
    }
    const key = targetKey(state.activeQueryTarget);
    if (!targetLookup.has(key)) {
      dispatch({
        type: "SET_QUERY_TARGET",
        target: targetOptions[0].target
      });
    }
  }, [state.activeQueryTarget, targetLookup, targetOptions]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const detectedStorageMode = getStorageMode();
        if (!mounted) {
          return;
        }
        dispatch({
          type: "SET_STORAGE_MODE",
          storageMode: detectedStorageMode
        });
        let warning: string | null =
          detectedStorageMode === "idb_only_fallback"
            ? "OPFS unavailable; using IndexedDB-only storage fallback mode."
            : null;

        const persisted = await loadPersistedState();
        if (!mounted) {
          return;
        }
        if (!persisted) {
          if (warning) {
            dispatch({
              type: "SET_STATUS",
              statusText: warning
            });
          }
          return;
        }
        const persistedPipelineRaw = (persisted as { pipelineSteps?: unknown }).pipelineSteps;
        const persistedActivePipelineStepId = (
          persisted as { activePipelineStepId?: unknown }
        ).activePipelineStepId;
        const persistedPipelinesByTableRaw = normalizePipelinesByTable(
          (persisted as { pipelinesByTable?: unknown }).pipelinesByTable
        );
        const normalizedActivePipelineStepIdByTable = normalizeActivePipelineStepIdByTable(
          (persisted as { activePipelineStepIdByTable?: unknown })
            .activePipelineStepIdByTable
        );
        const normalizedColumnEditsByTable = normalizeColumnEditsByTable(
          (persisted as { columnEditsByTable?: unknown }).columnEditsByTable
        );
        const normalizedPipelinesByTable: Record<string, ReturnType<typeof normalizePipelineSteps>> =
          {};
        for (const [tableName, rawSteps] of Object.entries(persistedPipelinesByTableRaw)) {
          const normalizedSteps = normalizePipelineSteps(rawSteps);
          normalizedPipelinesByTable[tableName] = normalizedSteps;
          if (normalizedSteps.length !== rawSteps.length) {
            warning = warning
              ? `${warning} Some invalid pipeline steps were skipped for ${tableName}.`
              : `Some invalid pipeline steps were skipped for ${tableName}.`;
          }
        }
        const normalizedSavedQueries = normalizeSavedQueries(persisted.savedQueries);
        const normalizedPipelineSteps = normalizePipelineSteps(
          persistedPipelineRaw ?? []
        );
        let safeSavedQueries = normalizedSavedQueries;
        try {
          validateSavedQueries(normalizedSavedQueries);
        } catch (error) {
          safeSavedQueries = [];
          warning = warning
            ? `${warning} Local saved queries were skipped: ${String(error)}`
            : `Local saved queries were skipped: ${String(error)}`;
        }
        if (
          Array.isArray(persistedPipelineRaw) &&
          normalizedPipelineSteps.length !== persistedPipelineRaw.length
        ) {
          warning = warning
            ? `${warning} Some invalid pipeline steps were skipped.`
            : "Some invalid pipeline steps were skipped.";
        }
        const persistedResultsTab = (persisted as { resultsTab?: unknown }).resultsTab;
        const normalizedResultsTab =
          persistedResultsTab === "profile"
            ? "describe"
            : persisted.resultsTab === "describe"
              ? "describe"
              : "notebook";
        const persistedSelectedTransformTableName =
          typeof persisted.selectedTransformTableName === "string"
            ? persisted.selectedTransformTableName
            : null;
        const inferredTransformTableNameFromTarget =
          persisted.activeQueryTarget?.kind === "table"
            ? persisted.activeQueryTarget.tableName
            : persisted.activeQueryTarget?.kind === "pipeline_step"
              ? persisted.activeQueryTarget.baseTableName
              : null;
        const selectedTransformTableName =
          persistedSelectedTransformTableName ??
          Object.keys(normalizedPipelinesByTable)[0] ??
          inferredTransformTableNameFromTarget;
        dispatch({
          type: "HYDRATE",
          patch: {
            ...persisted,
            resultsTab: normalizedResultsTab,
            savedQueries: safeSavedQueries,
            selectedTransformTableName,
            pipelinesByTable: normalizedPipelinesByTable,
            activePipelineStepIdByTable: normalizedActivePipelineStepIdByTable,
            columnEditsByTable: normalizedColumnEditsByTable,
            pipelineSteps: normalizedPipelineSteps,
            activePipelineStepId:
              normalizedPipelineSteps.find(
                (step) =>
                  step.id ===
                  (typeof persistedActivePipelineStepId === "string"
                    ? persistedActivePipelineStepId
                    : null)
              )?.id ??
              normalizedPipelineSteps[0]?.id ??
              null
          }
        });
        if (warning) {
          dispatch({
            type: "SET_STATUS",
            statusText: warning
          });
        }
      } catch (error) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Local state restore skipped: ${String(error)}`
        });
        // Non-fatal: continue with fresh state.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const loadPreviewForTable = useCallback(
    async (tableName: string, limit = TABLE_PREVIEW_INITIAL_LIMIT) => {
      const previewResponse = await worker.send({
        type: "PREVIEW_TABLE",
        payload: {
          tableName,
          limit
        }
      });
      return asPayload<TablePreview>(previewResponse);
    },
    [worker]
  );

  const refreshTables = useCallback(
    async (options?: { activeTableName?: string | null; activeLimit?: number }) => {
      try {
        const listResponse = await worker.send({ type: "LIST_TABLES" });
        const listPayload = asPayload<{ tableNames: string[] }>(listResponse);
        const hasActiveOverride =
          !!options && Object.prototype.hasOwnProperty.call(options, "activeTableName");
        const requestedActiveTableName = hasActiveOverride
          ? (options?.activeTableName ?? null)
          : (activeTableNameRef.current ?? null);
        const resolvedActiveTableName =
          requestedActiveTableName &&
          listPayload.tableNames.includes(requestedActiveTableName)
            ? requestedActiveTableName
            : listPayload.tableNames[0] ?? null;
        const activeLimit = Math.max(
          1,
          options?.activeLimit ?? activeTablePreviewLimitRef.current
        );
        const existingByTableName = new Map(
          tablesRef.current.map((table) => [table.tableName, table] as const)
        );
        const previews: TablePreview[] = listPayload.tableNames.map((tableName) => {
          const existing = existingByTableName.get(tableName);
          if (existing) {
            return {
              ...existing,
              rows: tableName === resolvedActiveTableName ? existing.rows : []
            };
          }
          return {
            tableName,
            rowCount: 0,
            columns: [],
            rows: []
          };
        });

        if (resolvedActiveTableName) {
          const activePreview = await loadPreviewForTable(
            resolvedActiveTableName,
            activeLimit
          );
          const targetIndex = previews.findIndex(
            (table) => table.tableName === resolvedActiveTableName
          );
          if (targetIndex >= 0) {
            previews[targetIndex] = activePreview;
          } else {
            previews.unshift(activePreview);
          }
        }

        dispatch({
          type: "SET_TABLES",
          tables: previews,
          activeTableName: resolvedActiveTableName
        });

        if (!activeQueryTargetRef.current && previews[0]) {
          dispatch({
            type: "SET_QUERY_TARGET",
            target: { kind: "table", tableName: previews[0].tableName }
          });
        }
      } catch (error) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Unable to refresh table registry: ${String(error)}`
        });
      }
    },
    [
      loadPreviewForTable,
      worker
    ]
  );

  useEffect(() => {
    const selectedTableName = state.selectedTransformTableName;
    if (!selectedTableName) {
      return;
    }
    const selectedTable = state.tables.find((table) => table.tableName === selectedTableName);
    if (!selectedTable || selectedTable.columns.length > 0) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const preview = await loadPreviewForTable(selectedTableName, 1);
        if (cancelled) {
          return;
        }
        dispatch({
          type: "SET_TABLES",
          tables: state.tables.map((table) =>
            table.tableName === selectedTableName
              ? {
                  ...table,
                  columns: preview.columns,
                  rowCount: preview.rowCount
                }
              : table
          ),
          activeTableName: state.activeTableName
        });
      } catch {
        // Best-effort schema hydration for non-active transform tables.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loadPreviewForTable,
    state.activeTableName,
    state.selectedTransformTableName,
    state.tables
  ]);

  const applyColumnSchemaEdit = useCallback(
    async (input: {
      tableName: string;
      columnName: string;
      nextName: string;
      nextType: string;
      nextNullable?: boolean;
    }) => {
      const response = await worker.send({
        type: "ALTER_TABLE_COLUMN",
        payload: {
          tableName: input.tableName,
          columnName: input.columnName,
          nextName: input.nextName,
          nextType: input.nextType,
          nextNullable: input.nextNullable
        }
      });
      return asPayload<{
        tableName: string;
        columns: Array<{ name: string; type: string; nullable?: boolean }>;
      }>(response);
    },
    [worker]
  );

  const onRenameTable = useCallback(
    async (nextNameRaw: string) => {
      const fromTableName = state.activeTableName;
      if (!fromTableName) {
        return;
      }
      const toTableName = nextNameRaw.trim();
      if (!toTableName) {
        dispatch({
          type: "SET_STATUS",
          statusText: "New table name cannot be empty."
        });
        return;
      }
      dispatch({
        type: "SET_STATUS",
        statusText: `Renaming table ${fromTableName}...`
      });
      try {
        const response = await worker.send({
          type: "RENAME_TABLE",
          payload: {
            fromTableName,
            toTableName
          }
        });
        const payload = asPayload<{ tableNames: string[]; renamedTo: string }>(response);
        const renamedTo = payload.renamedTo;

        const remapTarget = (target: QueryTargetRef): QueryTargetRef => {
          if (target.kind === "table" && target.tableName === fromTableName) {
            return {
              ...target,
              tableName: renamedTo
            };
          }
          if (
            target.kind === "pipeline_step" &&
            target.baseTableName === fromTableName
          ) {
            return {
              ...target,
              baseTableName: renamedTo
            };
          }
          return target;
        };

        const updatedSavedQueries = state.savedQueries.map((query) => ({
          ...query,
          versions: query.versions.map((version) => ({
            ...version,
            target: remapTarget(version.target)
          }))
        }));
        const updatedNotebookBlocks = state.notebookBlocks.map((block) => {
          const nextUpstreamVersionId =
            block.upstreamVersionId === fromTableName
              ? renamedTo
              : block.upstreamVersionId.startsWith(`pipeline:${fromTableName}:`)
                ? block.upstreamVersionId.replace(
                    `pipeline:${fromTableName}:`,
                    `pipeline:${renamedTo}:`
                  )
                : block.upstreamVersionId;
          return {
            ...block,
            upstreamVersionId: nextUpstreamVersionId,
            queryTarget: block.queryTarget ? remapTarget(block.queryTarget) : block.queryTarget
          };
        });
        const updatedPipelinesByTable = Object.fromEntries(
          Object.entries(state.pipelinesByTable).map(([tableName, steps]) => [
            tableName === fromTableName ? renamedTo : tableName,
            steps
          ])
        );
        const updatedActiveStepByTable = Object.fromEntries(
          Object.entries(state.activePipelineStepIdByTable).map(([tableName, stepId]) => [
            tableName === fromTableName ? renamedTo : tableName,
            stepId
          ])
        );
        const updatedColumnEditsByTable = Object.fromEntries(
          Object.entries(state.columnEditsByTable).map(([tableName, edits]) => [
            tableName === fromTableName ? renamedTo : tableName,
            (tableName === fromTableName
              ? edits.map((edit) => ({
                  ...edit,
                  tableName: renamedTo
                }))
              : edits)
          ])
        );

        dispatch({
          type: "HYDRATE",
          patch: {
            savedQueries: updatedSavedQueries,
            notebookBlocks: updatedNotebookBlocks,
            pipelinesByTable: updatedPipelinesByTable,
            activePipelineStepIdByTable: updatedActiveStepByTable,
            columnEditsByTable: updatedColumnEditsByTable,
            selectedTransformTableName:
              state.selectedTransformTableName === fromTableName
                ? renamedTo
                : state.selectedTransformTableName,
            activeQueryTarget: state.activeQueryTarget
              ? remapTarget(state.activeQueryTarget)
              : state.activeQueryTarget
          }
        });

        await refreshTables({
          activeTableName: renamedTo,
          activeLimit: activeTablePreviewLimit
        });
        if (!state.activeQueryId) {
          dispatch({
            type: "SET_QUERY_TARGET",
            target: { kind: "table", tableName: renamedTo }
          });
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Table renamed to ${renamedTo}.`
        });
      } catch (error) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Table rename failed: ${String(error)}`
        });
      }
    },
    [
      refreshTables,
      state.activeQueryId,
      state.activeQueryTarget,
      state.activeTableName,
      state.activePipelineStepIdByTable,
      state.columnEditsByTable,
      state.pipelinesByTable,
      state.selectedTransformTableName,
      activeTablePreviewLimit,
      state.notebookBlocks,
      state.savedQueries,
      worker
    ]
  );

  const onUpdateColumn = useCallback(
    async (input: {
      tableName: string;
      columnName: string;
      nextName: string;
      nextType: string;
      nextNullable?: boolean;
    }) => {
      const currentTable = state.tables.find((table) => table.tableName === input.tableName);
      const currentColumn = currentTable?.columns.find(
        (column) => column.name === input.columnName
      );
      const fromType = currentColumn?.type ?? "";
      const fromNullable = currentColumn?.nullable;
      dispatch({
        type: "SET_STATUS",
        statusText: `Updating column ${input.columnName} in ${input.tableName}...`
      });
      try {
        await applyColumnSchemaEdit(input);
        const normalizedToType = input.nextType.trim().replace(/\s+/g, " ").toUpperCase();
        const normalizedFromType = fromType.trim().replace(/\s+/g, " ").toUpperCase();
        const schemaEdit: ColumnSchemaEdit = {
          id: crypto.randomUUID(),
          tableName: input.tableName,
          fromColumnName: input.columnName,
          toColumnName: input.nextName,
          fromType: fromType || input.nextType,
          toType: input.nextType,
          fromNullable,
          toNullable: input.nextNullable,
          appliedAt: new Date().toISOString()
        };
        const shouldRecord =
          input.columnName !== input.nextName ||
          normalizedFromType !== normalizedToType ||
          (typeof fromNullable === "boolean" &&
            typeof input.nextNullable === "boolean" &&
            fromNullable !== input.nextNullable);
        if (shouldRecord) {
          dispatch({
            type: "HYDRATE",
            patch: {
              columnEditsByTable: {
                ...state.columnEditsByTable,
                [input.tableName]: [
                  ...(state.columnEditsByTable[input.tableName] ?? []),
                  schemaEdit
                ]
              }
            }
          });
        }

        await refreshTables({
          activeTableName: state.activeTableName,
          activeLimit: activeTablePreviewLimit
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `Column updated: ${input.columnName} -> ${input.nextName} (${input.nextType}${
            typeof input.nextNullable === "boolean"
              ? input.nextNullable
                ? ", NULL allowed"
                : ", NOT NULL"
              : ""
          }).`
        });
      } catch (error) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Column update failed: ${String(error)}`
        });
      }
    },
    [
      activeTablePreviewLimit,
      applyColumnSchemaEdit,
      refreshTables,
      state.activeTableName,
      state.columnEditsByTable,
      state.tables
    ]
  );

  const onRequestDeleteDataset = useCallback((tableName: string) => {
    setDeleteDialog({
      kind: "dataset",
      tableName
    });
  }, []);

  const onRequestDeleteAllData = useCallback(() => {
    setDeleteDialog({
      kind: "all"
    });
  }, []);

  const onCancelDeleteDialog = useCallback(() => {
    setDeleteDialog(null);
  }, []);

  const onConfirmDeleteDialog = useCallback(async () => {
    if (!deleteDialog) {
      return;
    }
    const pendingDelete = deleteDialog;
    setDeleteDialog(null);

    if (pendingDelete.kind === "dataset") {
      dispatch({
        type: "SET_STATUS",
        statusText: `Deleting dataset ${pendingDelete.tableName}...`
      });
      try {
        const response = await worker.send({
          type: "DELETE_TABLE",
          payload: {
            tableName: pendingDelete.tableName
          }
        });
        const payload = asPayload<{
          tableNames: string[];
          deletedTableName: string;
        }>(response);
        const nextActiveTableName = payload.tableNames[0] ?? null;
        const nextPipelinesByTable = Object.fromEntries(
          Object.entries(state.pipelinesByTable).filter(
            ([tableName]) => tableName !== payload.deletedTableName
          )
        );
        const nextActiveStepByTable = Object.fromEntries(
          Object.entries(state.activePipelineStepIdByTable).filter(
            ([tableName]) => tableName !== payload.deletedTableName
          )
        );
        const nextColumnEditsByTable = Object.fromEntries(
          Object.entries(state.columnEditsByTable).filter(
            ([tableName]) => tableName !== payload.deletedTableName
          )
        );
        dispatch({
          type: "HYDRATE",
          patch: {
            pipelinesByTable: nextPipelinesByTable,
            activePipelineStepIdByTable: nextActiveStepByTable,
            columnEditsByTable: nextColumnEditsByTable,
            selectedTransformTableName:
              state.selectedTransformTableName === payload.deletedTableName
                ? nextActiveTableName
                : state.selectedTransformTableName
          }
        });
        await refreshTables({
          activeTableName: nextActiveTableName,
          activeLimit: TABLE_PREVIEW_INITIAL_LIMIT
        });
        setActiveTablePreviewLimit(TABLE_PREVIEW_INITIAL_LIMIT);

        const activeTarget = state.activeQueryTarget;
        if (
          !activeTarget ||
          (activeTarget.kind === "table" &&
            activeTarget.tableName === payload.deletedTableName) ||
          (activeTarget.kind === "pipeline_step" &&
            activeTarget.baseTableName === payload.deletedTableName)
        ) {
          dispatch({
            type: "SET_QUERY_TARGET",
            target: nextActiveTableName
              ? {
                  kind: "table",
                  tableName: nextActiveTableName
                }
              : null
          });
        }
        if (state.activeTableName === payload.deletedTableName) {
          dispatch({
            type: "SET_QUERY_RESULT",
            result: null
          });
          dispatch({
            type: "SET_PROFILE",
            profile: null
          });
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Deleted dataset ${payload.deletedTableName}.`
        });
      } catch (error) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Delete failed: ${String(error)}`
        });
      }
      return;
    }

    dispatch({
      type: "SET_STATUS",
      statusText: "Deleting all project data..."
    });
    try {
      await worker.send({
        type: "RESET_PROJECT"
      });
      await clearPersistedState();
      setActiveTablePreviewLimit(TABLE_PREVIEW_INITIAL_LIMIT);
      dispatch({
        type: "HYDRATE",
        patch: {
          ...initialState,
          ready: true,
          storageMode: state.storageMode
        }
      });
      dispatch({
        type: "SET_STATUS",
        statusText: "All project data deleted."
      });
    } catch (error) {
      dispatch({
        type: "SET_STATUS",
        statusText: `Delete all failed: ${String(error)}`
      });
    }
  }, [
    deleteDialog,
    refreshTables,
    state.activeQueryTarget,
    state.activeTableName,
    state.activePipelineStepIdByTable,
    state.columnEditsByTable,
    state.pipelinesByTable,
    state.selectedTransformTableName,
    state.storageMode,
    worker
  ]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await worker.send({ type: "INIT_ENGINE" });
        if (!mounted) {
          return;
        }
        dispatch({
          type: "SET_READY",
          ready: true,
          statusText: "Worker ready. Import one or more CSV files to begin."
        });
        await refreshTables();
      } catch (error) {
        if (!mounted) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Worker initialization failed: ${String(error)}`
        });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshTables, worker]);

  const onPickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInput = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }
      setImportCapFallback(null);
      setImportDialogFiles(Array.from(files));
      setImportDialogOpen(true);
    },
    []
  );

  const onCancelImportDialog = useCallback(() => {
    setImportDialogOpen(false);
    setImportDialogFiles([]);
    setImportCapFallback(null);
    dispatch({
      type: "SET_STATUS",
      statusText: "Import cancelled."
    });
  }, []);

  const executeCsvImport = useCallback(
    async (input: ImportDialogInput, sampleRows?: number) => {
      if (importDialogFiles.length === 0) {
        return;
      }
      setImportDialogOpen(false);
      setImportCapFallback(null);
      dispatch({
        type: "SET_STATUS",
        statusText: sampleRows
          ? `Importing sampled data (${sampleRows.toLocaleString()} rows per file max)...`
          : `Importing ${importDialogFiles.length} file(s)...`
      });

      try {
        const fileEntries = importDialogFiles.map((file) => ({
          fileName: file.name,
          sizeBytes: file.size,
          file
        }));
        const sourceHashMaxBytes = 64 * 1024 * 1024;

        dispatch({
          type: "SET_IMPORT_OPTIONS",
          mergeMode: input.mergeMode,
          hasHeader: input.hasHeader,
          delimiter: input.delimiter || ","
        });

        const importResponse = await worker.send(
          {
            type: "IMPORT_CSVS",
            payload: {
              tableName: sanitizeIdentifier(input.tableName),
              mergeMode: input.mergeMode,
              appendToExisting: input.destination === "existing",
              sampleRows,
              hasHeader: input.hasHeader,
              delimiter: input.delimiter || ",",
              files: fileEntries
            }
          }
        );

        const payload = asPayload<{ importedInto: string[]; tableNames: string[] }>(
          importResponse
        );
        const replayMessages: string[] = [];
        if (input.destination === "new") {
          for (const tableName of payload.importedInto) {
            const edits = state.columnEditsByTable[tableName] ?? [];
            if (edits.length === 0) {
              continue;
            }
            try {
              for (const edit of edits) {
                await applyColumnSchemaEdit({
                  tableName,
                  columnName: edit.fromColumnName,
                  nextName: edit.toColumnName,
                  nextType: edit.toType,
                  nextNullable: edit.toNullable
                });
              }
              replayMessages.push(
                `Applied ${edits.length.toLocaleString()} saved column edit(s) to ${tableName}.`
              );
            } catch (error) {
              replayMessages.push(
                `Column edit replay failed for ${tableName}: ${toErrorMessage(error)}`
              );
            }
          }
        }
        const activeTableName = payload.importedInto[0] ?? payload.tableNames[0] ?? null;
        setActiveTablePreviewLimit(TABLE_PREVIEW_INITIAL_LIMIT);
        await refreshTables({
          activeTableName,
          activeLimit: TABLE_PREVIEW_INITIAL_LIMIT
        });
        if (activeTableName) {
          dispatch({
            type: "SET_QUERY_TARGET",
            target: { kind: "table", tableName: activeTableName }
          });
        }
        const sourceMetadata = [];
        for (const entry of fileEntries) {
          let sha256: string | undefined;
          if (entry.sizeBytes <= sourceHashMaxBytes) {
            try {
              const buffer = await entry.file.arrayBuffer();
              const digest = await sha256Hex(buffer);
              sha256 = digest || undefined;
            } catch {
              sha256 = undefined;
            }
          }
          sourceMetadata.push({
            id: crypto.randomUUID(),
            name: entry.fileName,
            sizeBytes: entry.sizeBytes,
            sha256,
            hasHeader: input.hasHeader,
            delimiter: input.delimiter || ","
          });
        }
        dispatch({
          type: "ADD_SOURCES",
          sources: sourceMetadata
        });
        dispatch({
          type: "SET_STATUS",
          statusText: replayMessages.length
            ? `${
                sampleRows
                  ? `Sample import complete (${sampleRows.toLocaleString()} rows/file max). `
                  : ""
              }Imported into: ${payload.importedInto.join(", ")} | ${replayMessages.join(" ")}`
            : `${
                sampleRows
                  ? `Sample import complete (${sampleRows.toLocaleString()} rows/file max). `
                  : ""
              }Imported into: ${payload.importedInto.join(", ")}`
        });
        dispatch({
          type: "SET_DATA_TAB",
          tab: "data"
        });
        setImportDialogFiles([]);
      } catch (error) {
        const message = toErrorMessage(error);
        if (!sampleRows && isImportLimitErrorMessage(message)) {
          setImportCapFallback({
            input,
            message
          });
          dispatch({
            type: "SET_STATUS",
            statusText:
              "Import hit V1 limits. Choose whether to cancel or import a sampled subset."
          });
          return;
        }
        setImportDialogOpen(true);
        dispatch({
          type: "SET_STATUS",
          statusText: `Import failed: ${message}`
        });
      }
    },
    [
      applyColumnSchemaEdit,
      importDialogFiles,
      refreshTables,
      state.columnEditsByTable,
      worker
    ]
  );

  const onConfirmImportDialog = useCallback(
    async (input: ImportDialogInput) => {
      await executeCsvImport(input);
    },
    [executeCsvImport]
  );

  const onCancelImportCapFallback = useCallback(() => {
    setImportCapFallback(null);
    setImportDialogFiles([]);
    dispatch({
      type: "SET_STATUS",
      statusText: "Import cancelled."
    });
  }, []);

  const onConfirmImportCapFallback = useCallback(() => {
    if (!importCapFallback) {
      return;
    }
    void executeCsvImport(importCapFallback.input, IMPORT_SAMPLE_ROW_FALLBACK);
  }, [executeCsvImport, importCapFallback]);

  const onLoadExample = useCallback(async () => {
    dispatch({
      type: "SET_STATUS",
      statusText: "Loading example dataset..."
    });
    try {
      const response = await fetch("/examples/sales.csv");
      if (!response.ok) {
        throw new Error(`Unable to fetch example: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const sha256 = await sha256Hex(buffer);
      const importResponse = await worker.send(
        {
          type: "IMPORT_CSVS",
          payload: {
            tableName: "sales_example",
            mergeMode: "same_table_union_by_name",
            hasHeader: true,
            delimiter: ",",
            files: [{ fileName: "sales.csv", sizeBytes: buffer.byteLength, buffer }]
          }
        },
        [buffer]
      );
      const payload = asPayload<{ importedInto: string[]; tableNames: string[] }>(
        importResponse
      );
      const activeTableName = payload.importedInto[0] ?? payload.tableNames[0] ?? null;
      setActiveTablePreviewLimit(TABLE_PREVIEW_INITIAL_LIMIT);
      await refreshTables({
        activeTableName,
        activeLimit: TABLE_PREVIEW_INITIAL_LIMIT
      });
      if (activeTableName) {
        dispatch({
          type: "SET_QUERY_TARGET",
          target: { kind: "table", tableName: activeTableName }
        });
      }
      dispatch({
        type: "ADD_SOURCES",
        sources: [
          {
            id: crypto.randomUUID(),
            name: "sales.csv",
            sizeBytes: buffer.byteLength,
            sha256,
            hasHeader: true,
            delimiter: ","
          }
        ]
      });
      dispatch({
        type: "SET_STATUS",
        statusText: "Example dataset loaded."
      });
    } catch (error) {
      dispatch({
        type: "SET_STATUS",
        statusText: `Failed to load example: ${String(error)}`
      });
    }
  }, [refreshTables, worker]);

  const onRunSQL = useCallback(async () => {
    const queryText = state.sqlEditorText.trim();
    if (queryText && !isSelectLikeSql(queryText)) {
      dispatch({
        type: "SET_STATUS",
        statusText: "Only SELECT/CTE statements are allowed in query mode."
      });
      return;
    }

    dispatch({
      type: "SET_STATUS",
      statusText: "Running query..."
    });
    try {
      const runtimeSql = buildRuntimeSqlForTarget(
        state.sqlEditorText,
        state.activeQueryTarget
      );
      const response = await worker.sendLatest("run_sql", {
        type: "RUN_SQL",
        payload: {
          sql: runtimeSql,
          limit: 250
        }
      });
      const payload = asPayload<{
        columns: string[];
        rows: Array<Array<string | number | boolean | null>>;
        rowCount: number;
      }>(response);

      dispatch({
        type: "SET_QUERY_RESULT",
        result: {
          ...payload,
          querySql: state.sqlEditorText,
          queryTarget: state.activeQueryTarget ?? undefined
        }
      });
      dispatch({
        type: "SET_RESULTS_TAB",
        tab: "notebook"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `Query completed (${payload.rowCount.toLocaleString()} rows returned).`
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
        return;
      }
      dispatch({
        type: "SET_STATUS",
        statusText: `Query failed: ${String(error)}`
      });
    }
  }, [
    buildRuntimeSqlForTarget,
    state.activeQueryTarget,
    state.sqlEditorText,
    worker
  ]);

  const onSqlChange = useCallback((sql: string) => {
    dispatch({ type: "SET_SQL", sql });
  }, []);

  const onAddSqlStep = useCallback(() => {
    const trimmed = state.sqlEditorText.trim();
    if (!trimmed) {
      dispatch({
        type: "SET_STATUS",
        statusText: "Write SQL before adding a transform step."
      });
      return;
    }
    if (!isSelectLikeSql(trimmed)) {
      dispatch({
        type: "SET_STATUS",
        statusText: "SQL transform steps must be SELECT/CTE statements."
      });
      return;
    }

    const nextStep: SQLTransformStep = {
      id: crypto.randomUUID(),
      name: `SQL_Step_${transformPipelineSteps.length + 1}`,
      enabled: true,
      type: "SQLTransformStep",
      params: {
        sql: trimmed
      }
    };
    dispatch({
      type: "ADD_PIPELINE_STEP",
      step: nextStep
    });
    dispatch({
      type: "SET_ACTIVE_PIPELINE_STEP",
      stepId: nextStep.id
    });
    dispatch({
      type: "SET_DATA_TAB",
      tab: "transforms"
    });
    dispatch({
      type: "SET_STATUS",
      statusText: `${nextStep.name} added to pipeline.`
    });
  }, [state.sqlEditorText, transformPipelineSteps.length]);

  const onSaveFilterStep = useCallback(
    (input: {
      column: string;
      operator: FilterStep["params"]["operator"];
      value: string;
    }) => {
      const column = input.column.trim();
      if (!column) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Choose a column before saving a filter step."
        });
        return;
      }
      if (activePipelineStep?.type === "FilterStep") {
        const updatedStep: FilterStep = {
          ...activePipelineStep,
          params: {
            column,
            operator: input.operator,
            value: input.value
          }
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: FilterStep = {
        id: crypto.randomUUID(),
        name: `Filter_${sanitizeIdentifier(column)}`,
        enabled: true,
        type: "FilterStep",
        params: {
          column,
          operator: input.operator,
          value: input.value
        }
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep]
  );

  const onSaveSelectColumnsStep = useCallback(
    (input: { columns: string[] }) => {
      const columns = input.columns
        .map((column) => column.trim())
        .filter((column): column is string => column.length > 0);
      const uniqueColumns = Array.from(new Set(columns));
      if (!uniqueColumns.length) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select at least one column before saving a select step."
        });
        return;
      }

      if (activePipelineStep?.type === "SelectColumnsStep") {
        const updatedStep: SelectColumnsStep = {
          ...activePipelineStep,
          params: {
            columns: uniqueColumns
          }
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: SelectColumnsStep = {
        id: crypto.randomUUID(),
        name: `Select_Columns_${transformPipelineSteps.length + 1}`,
        enabled: true,
        type: "SelectColumnsStep",
        params: {
          columns: uniqueColumns
        }
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep, transformPipelineSteps.length]
  );

  const onSaveMutateColumnStep = useCallback(
    (input: { outputColumn: string; expression: string }) => {
      const outputColumn = input.outputColumn.trim();
      const expression = input.expression.trim();
      if (!outputColumn || !expression) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Output column and expression are required for mutate steps."
        });
        return;
      }

      if (activePipelineStep?.type === "MutateColumnStep") {
        const updatedStep: MutateColumnStep = {
          ...activePipelineStep,
          params: {
            outputColumn,
            expression
          }
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: MutateColumnStep = {
        id: crypto.randomUUID(),
        name: `Mutate_${sanitizeIdentifier(outputColumn)}`,
        enabled: true,
        type: "MutateColumnStep",
        params: {
          outputColumn,
          expression
        }
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep]
  );

  const onSaveRemoveDuplicatesStep = useCallback(
    (input: { columns: string[] }) => {
      const columns = Array.from(
        new Set(
          input.columns
            .map((column) => column.trim())
            .filter((column): column is string => column.length > 0)
        )
      );

      if (activePipelineStep?.type === "RemoveDuplicatesStep") {
        const updatedStep: RemoveDuplicatesStep = {
          ...activePipelineStep,
          params: {
            columns
          }
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: RemoveDuplicatesStep = {
        id: crypto.randomUUID(),
        name: `Remove_Duplicates_${transformPipelineSteps.length + 1}`,
        enabled: true,
        type: "RemoveDuplicatesStep",
        params: {
          columns
        }
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep, transformPipelineSteps.length]
  );

  const onSaveMissingValuesStep = useCallback(
    (input: {
      mode: MissingValuesStep["params"]["mode"];
      columns: string[];
      fillValue?: string;
    }) => {
      const columns = Array.from(
        new Set(
          input.columns
            .map((column) => column.trim())
            .filter((column): column is string => column.length > 0)
        )
      );
      if (!columns.length) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Choose at least one column for missing-value handling."
        });
        return;
      }
      const fillValue = input.fillValue?.trim() ?? "";
      if (input.mode === "fill" && fillValue.length === 0) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Provide a fill value when using fill mode."
        });
        return;
      }
      const params: MissingValuesStep["params"] = {
        mode: input.mode,
        columns,
        fillValue: input.mode === "fill" ? fillValue : undefined
      };

      if (activePipelineStep?.type === "MissingValuesStep") {
        const updatedStep: MissingValuesStep = {
          ...activePipelineStep,
          params
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: MissingValuesStep = {
        id: crypto.randomUUID(),
        name: `Missing_${input.mode}_${transformPipelineSteps.length + 1}`,
        enabled: true,
        type: "MissingValuesStep",
        params
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep, transformPipelineSteps.length]
  );

  const onSaveSortRowsStep = useCallback(
    (input: {
      column: string;
      direction: SortRowsStep["params"]["direction"];
      nulls: SortRowsStep["params"]["nulls"];
    }) => {
      const column = input.column.trim();
      if (!column) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Choose a sort column before saving."
        });
        return;
      }
      const params: SortRowsStep["params"] = {
        column,
        direction: input.direction,
        nulls: input.nulls
      };

      if (activePipelineStep?.type === "SortRowsStep") {
        const updatedStep: SortRowsStep = {
          ...activePipelineStep,
          params
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: SortRowsStep = {
        id: crypto.randomUUID(),
        name: `Sort_${sanitizeIdentifier(column)}_${transformPipelineSteps.length + 1}`,
        enabled: true,
        type: "SortRowsStep",
        params
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep, transformPipelineSteps.length]
  );

  const onSaveCastColumnStep = useCallback(
    (input: {
      column: string;
      targetType: string;
      outputColumn?: string;
      dateFormat?: string;
    }) => {
      const column = input.column.trim();
      const targetType = input.targetType.trim().toUpperCase();
      if (!column || !targetType) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Column and target type are required for cast steps."
        });
        return;
      }
      if (!/^[A-Z0-9_,()\s]+$/.test(targetType)) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Unsupported target type: ${input.targetType}`
        });
        return;
      }
      const outputColumn = input.outputColumn?.trim();
      const dateFormat = input.dateFormat?.trim();
      const params: CastColumnStep["params"] = {
        column,
        targetType,
        outputColumn: outputColumn || undefined,
        dateFormat: dateFormat || undefined
      };

      if (activePipelineStep?.type === "CastColumnStep") {
        const updatedStep: CastColumnStep = {
          ...activePipelineStep,
          params
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: CastColumnStep = {
        id: crypto.randomUUID(),
        name: `Cast_${sanitizeIdentifier(outputColumn || column)}_${transformPipelineSteps.length + 1}`,
        enabled: true,
        type: "CastColumnStep",
        params
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep, transformPipelineSteps.length]
  );

  const onSaveScaleNumericStep = useCallback(
    (input: {
      column: string;
      method: ScaleNumericStep["params"]["method"];
      outputColumn: string;
    }) => {
      const column = input.column.trim();
      const outputColumn = input.outputColumn.trim();
      if (!column || !outputColumn) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Source and output columns are required for scaling."
        });
        return;
      }
      const params: ScaleNumericStep["params"] = {
        column,
        method: input.method,
        outputColumn
      };

      if (activePipelineStep?.type === "ScaleNumericStep") {
        const updatedStep: ScaleNumericStep = {
          ...activePipelineStep,
          params
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: ScaleNumericStep = {
        id: crypto.randomUUID(),
        name: `Scale_${sanitizeIdentifier(outputColumn)}_${transformPipelineSteps.length + 1}`,
        enabled: true,
        type: "ScaleNumericStep",
        params
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep, transformPipelineSteps.length]
  );

  const onSaveDummyVariablesStep = useCallback(
    async (input: {
      sourceColumn: string;
      prefix?: string;
      dropOne: boolean;
      dropCategory?: string;
    }) => {
      const sourceColumn = input.sourceColumn.trim();
      if (!sourceColumn) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Choose a source column before creating dummy variables."
        });
        return;
      }
      if (!transformExecutionTarget) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select a transform table before creating dummy variables."
        });
        return;
      }

      dispatch({
        type: "SET_STATUS",
        statusText: `Loading categories for ${sourceColumn}...`
      });

      try {
        const columnRef = quoteIdentifier(sourceColumn);
        const categoryQuery = `
          SELECT DISTINCT ${columnRef} AS _sf_category
          FROM source
          WHERE ${columnRef} IS NOT NULL
          ORDER BY 1
          LIMIT 500
        `;
        const runtimeSql = buildRuntimeSqlForTarget(
          categoryQuery,
          transformExecutionTarget
        );
        const response = await worker.sendLatest("load_dummy_categories", {
          type: "RUN_SQL",
          payload: {
            sql: runtimeSql,
            limit: 600
          }
        });
        const payload = asPayload<{
          columns: string[];
          rows: Array<Array<string | number | boolean | null>>;
          rowCount: number;
        }>(response);
        const categories = Array.from(
          new Set(
            payload.rows
              .map((row) => row[0])
              .filter((value): value is string | number | boolean => value !== null)
              .map((value) => String(value))
          )
        );
        if (!categories.length) {
          dispatch({
            type: "SET_STATUS",
            statusText: `No non-null categories found in ${sourceColumn}.`
          });
          return;
        }

        const requestedDrop = input.dropCategory?.trim() ?? "";
        const dropCategory = input.dropOne ? requestedDrop || categories[0] : null;
        if (dropCategory && !categories.includes(dropCategory)) {
          dispatch({
            type: "SET_STATUS",
            statusText: `Drop category "${dropCategory}" is not present in ${sourceColumn}.`
          });
          return;
        }

        const prefix = input.prefix?.trim() ?? "";
        const params = {
          sourceColumn,
          categories,
          dropCategory,
          prefix: prefix || undefined
        };

        if (activePipelineStep?.type === "DummyVariablesStep") {
          const updatedStep: DummyVariablesStep = {
            ...activePipelineStep,
            params
          };
          dispatch({
            type: "UPDATE_PIPELINE_STEP",
            step: updatedStep
          });
          dispatch({
            type: "SET_STATUS",
            statusText: `${updatedStep.name} updated with ${categories.length} categories.`
          });
          return;
        }

        const nextStep: DummyVariablesStep = {
          id: crypto.randomUUID(),
          name: `Dummies_${sanitizeIdentifier(sourceColumn)}`,
          enabled: true,
          type: "DummyVariablesStep",
          params
        };
        dispatch({
          type: "ADD_PIPELINE_STEP",
          step: nextStep
        });
        dispatch({
          type: "SET_ACTIVE_PIPELINE_STEP",
          stepId: nextStep.id
        });
        dispatch({
          type: "SET_DATA_TAB",
          tab: "transforms"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${nextStep.name} added (${categories.length} categories).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Unable to build dummy variables: ${String(error)}`
        });
      }
    },
    [
      activePipelineStep,
      transformExecutionTarget,
      buildRuntimeSqlForTarget,
      worker
    ]
  );

  const onSaveGroupAggregateStep = useCallback(
    (input: {
      groupBy: string[];
      aggregates: Array<{
        expression: string;
        alias: string;
      }>;
    }) => {
      const groupBy = Array.from(
        new Set(
          input.groupBy
            .map((column) => column.trim())
            .filter((column): column is string => column.length > 0)
        )
      );
      const aggregates = input.aggregates
        .map((aggregate) => ({
          expression: aggregate.expression.trim(),
          alias: aggregate.alias.trim()
        }))
        .filter(
          (aggregate) => aggregate.expression.length > 0 && aggregate.alias.length > 0
        );
      if (!aggregates.length) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Add at least one aggregate expression before saving."
        });
        return;
      }

      if (activePipelineStep?.type === "GroupAggregateStep") {
        const updatedStep: GroupAggregateStep = {
          ...activePipelineStep,
          params: {
            groupBy,
            aggregates
          }
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: GroupAggregateStep = {
        id: crypto.randomUUID(),
        name: `Group_Aggregate_${transformPipelineSteps.length + 1}`,
        enabled: true,
        type: "GroupAggregateStep",
        params: {
          groupBy,
          aggregates
        }
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep, transformPipelineSteps.length]
  );

  const onSaveJoinStep = useCallback(
    (input: {
      rightTable: string;
      joinType: JoinStep["params"]["joinType"];
      conditions: Array<{
        leftColumn: string;
        operator: JoinStep["params"]["conditions"][number]["operator"];
        rightColumn: string;
      }>;
    }) => {
      const rightTable = input.rightTable.trim();
      if (!rightTable) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Choose a right table before saving a join step."
        });
        return;
      }
      if (!state.tables.some((table) => table.tableName === rightTable)) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Join table "${rightTable}" does not exist.`
        });
        return;
      }

      const conditions = input.conditions
        .map((condition) => ({
          leftColumn: condition.leftColumn.trim(),
          operator: condition.operator,
          rightColumn: condition.rightColumn.trim()
        }))
        .filter(
          (condition) =>
            condition.leftColumn.length > 0 && condition.rightColumn.length > 0
        );
      if (!conditions.length) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Add at least one valid join condition before saving."
        });
        return;
      }

      if (activePipelineStep?.type === "JoinStep") {
        const updatedStep: JoinStep = {
          ...activePipelineStep,
          params: {
            rightTable,
            joinType: input.joinType,
            conditions
          }
        };
        dispatch({
          type: "UPDATE_PIPELINE_STEP",
          step: updatedStep
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${updatedStep.name} updated.`
        });
        return;
      }

      const nextStep: JoinStep = {
        id: crypto.randomUUID(),
        name: `Join_${sanitizeIdentifier(rightTable)}_${transformPipelineSteps.length + 1}`,
        enabled: true,
        type: "JoinStep",
        params: {
          rightTable,
          joinType: input.joinType,
          conditions
        }
      };
      dispatch({
        type: "ADD_PIPELINE_STEP",
        step: nextStep
      });
      dispatch({
        type: "SET_ACTIVE_PIPELINE_STEP",
        stepId: nextStep.id
      });
      dispatch({
        type: "SET_DATA_TAB",
        tab: "transforms"
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${nextStep.name} added to pipeline.`
      });
    },
    [activePipelineStep, state.tables, transformPipelineSteps.length]
  );

  const onSavePivotStep = useCallback(
    async (input: {
      indexColumns: string[];
      pivotColumn: string;
      valueColumn: string;
      aggregate: PivotStep["params"]["aggregate"];
    }) => {
      const pivotColumn = input.pivotColumn.trim();
      const valueColumn = input.valueColumn.trim();
      if (!pivotColumn || !valueColumn) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Choose pivot and value columns before saving a pivot step."
        });
        return;
      }
      if (!transformExecutionTarget) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select a transform table before creating a pivot step."
        });
        return;
      }

      const indexColumns = Array.from(
        new Set(
          input.indexColumns
            .map((column) => column.trim())
            .filter((column): column is string => column.length > 0)
        )
      );

      dispatch({
        type: "SET_STATUS",
        statusText: `Loading pivot values for ${pivotColumn}...`
      });

      try {
        const pivotColumnRef = quoteIdentifier(pivotColumn);
        const pivotValuesSql = `
          SELECT DISTINCT CAST(${pivotColumnRef} AS VARCHAR) AS _sf_pivot_value
          FROM source
          WHERE ${pivotColumnRef} IS NOT NULL
          ORDER BY 1
          LIMIT 500
        `;
        const runtimeSql = buildRuntimeSqlForTarget(
          pivotValuesSql,
          transformExecutionTarget
        );
        const response = await worker.sendLatest("load_pivot_values", {
          type: "RUN_SQL",
          payload: {
            sql: runtimeSql,
            limit: 600
          }
        });
        const payload = asPayload<{
          columns: string[];
          rows: Array<Array<string | number | boolean | null>>;
          rowCount: number;
        }>(response);
        const pivotValues = Array.from(
          new Set(
            payload.rows
              .map((row) => row[0])
              .filter((value): value is string | number | boolean => value !== null)
              .map((value) => String(value))
          )
        );
        if (!pivotValues.length) {
          dispatch({
            type: "SET_STATUS",
            statusText: `No non-null pivot values found in ${pivotColumn}.`
          });
          return;
        }

        const params = {
          indexColumns,
          pivotColumn,
          valueColumn,
          aggregate: input.aggregate,
          pivotValues
        };

        if (activePipelineStep?.type === "PivotStep") {
          const updatedStep: PivotStep = {
            ...activePipelineStep,
            params
          };
          dispatch({
            type: "UPDATE_PIPELINE_STEP",
            step: updatedStep
          });
          dispatch({
            type: "SET_STATUS",
            statusText: `${updatedStep.name} updated with ${pivotValues.length} value columns.`
          });
          return;
        }

        const nextStep: PivotStep = {
          id: crypto.randomUUID(),
          name: `Pivot_${sanitizeIdentifier(pivotColumn)}_${transformPipelineSteps.length + 1}`,
          enabled: true,
          type: "PivotStep",
          params
        };
        dispatch({
          type: "ADD_PIPELINE_STEP",
          step: nextStep
        });
        dispatch({
          type: "SET_ACTIVE_PIPELINE_STEP",
          stepId: nextStep.id
        });
        dispatch({
          type: "SET_DATA_TAB",
          tab: "transforms"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${nextStep.name} added (${pivotValues.length} value columns).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Unable to build pivot step: ${String(error)}`
        });
      }
    },
    [
      activePipelineStep,
      buildRuntimeSqlForTarget,
      transformExecutionTarget,
      transformPipelineSteps.length,
      worker
    ]
  );

  const onUpdatePipelineSqlStep = useCallback(() => {
    if (!activePipelineStep) {
      dispatch({
        type: "SET_STATUS",
        statusText: "Select a pipeline step first."
      });
      return;
    }
    if (activePipelineStep.type !== "SQLTransformStep") {
      dispatch({
        type: "SET_STATUS",
        statusText: "Only SQL transform steps can be updated from the editor."
      });
      return;
    }
    const trimmed = state.sqlEditorText.trim();
    if (!trimmed) {
      dispatch({
        type: "SET_STATUS",
        statusText: "Step SQL cannot be empty."
      });
      return;
    }
    if (!isSelectLikeSql(trimmed)) {
      dispatch({
        type: "SET_STATUS",
        statusText: "SQL transform steps must be SELECT/CTE statements."
      });
      return;
    }

    const updatedStep: SQLTransformStep = {
      ...activePipelineStep,
      params: {
        ...activePipelineStep.params,
        sql: trimmed
      }
    };
    dispatch({
      type: "UPDATE_PIPELINE_STEP",
      step: updatedStep
    });
    dispatch({
      type: "SET_STATUS",
      statusText: `${updatedStep.name} updated.`
    });
  }, [activePipelineStep, state.sqlEditorText]);

  const onTogglePipelineStep = useCallback(
    (stepId: string) => {
      const step = transformPipelineSteps.find((entry) => entry.id === stepId);
      if (!step) {
        return;
      }
      dispatch({
        type: "TOGGLE_PIPELINE_STEP_ENABLED",
        stepId
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${step.name} ${step.enabled ? "disabled" : "enabled"}.`
      });
    },
    [transformPipelineSteps]
  );

  const onMovePipelineStep = useCallback(
    (stepId: string, direction: "up" | "down") => {
      const index = transformPipelineSteps.findIndex((step) => step.id === stepId);
      if (index < 0) {
        return;
      }
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= transformPipelineSteps.length) {
        return;
      }
      const step = transformPipelineSteps[index];
      dispatch({
        type: "MOVE_PIPELINE_STEP",
        stepId,
        direction
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${step.name} moved ${direction}.`
      });
    },
    [transformPipelineSteps]
  );

  const onRemovePipelineStep = useCallback(
    (stepId: string) => {
      const step = transformPipelineSteps.find((entry) => entry.id === stepId);
      if (!step) {
        return;
      }
      dispatch({
        type: "REMOVE_PIPELINE_STEP",
        stepId
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${step.name} removed from pipeline.`
      });
    },
    [transformPipelineSteps]
  );

  const onRunPipeline = useCallback(async () => {
    if (!state.selectedTransformTableName) {
      dispatch({
        type: "SET_STATUS",
        statusText: "Select a base table before running the pipeline."
      });
      return;
    }
    // Mark the current signature as already handled so debounced auto-run does not
    // immediately duplicate a manual run.
    lastAutoRunPipelineSignatureRef.current = pipelineAutoRunSignature || null;
    dispatch({
      type: "SET_STATUS",
      statusText: "Running pipeline..."
    });
    try {
      const response = await worker.sendLatest("run_pipeline", {
        type: "RUN_PIPELINE",
        payload: {
          baseTableName: state.selectedTransformTableName,
          steps: transformPipelineSteps,
          limit: 250
        }
      });
      const payload = asPayload<{
        columns: string[];
        rows: Array<Array<string | number | boolean | null>>;
        rowCount: number;
      }>(response);
      const finalStepIndex = transformPipelineSteps.length - 1;
      const pipelineResultTarget: QueryTargetRef =
        finalStepIndex >= 0
        ? buildPipelineStepTarget(
            state.selectedTransformTableName,
            transformPipelineSteps,
            finalStepIndex
          )
        : {
            kind: "table",
            tableName: state.selectedTransformTableName
          };
      dispatch({
        type: "SET_QUERY_RESULT",
        result: {
          ...payload,
          querySql: "SELECT * FROM source",
          queryTarget: pipelineResultTarget
        }
      });
      dispatch({
        type: "SET_RESULTS_TAB",
        tab: "notebook"
      });
      dispatch({
        type: "SET_QUERY_TARGET",
        target: pipelineResultTarget
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `Pipeline completed (${payload.rowCount.toLocaleString()} rows returned).`
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
        return;
      }
      dispatch({
        type: "SET_STATUS",
        statusText: `Pipeline failed: ${String(error)}`
      });
    }
  }, [
    pipelineAutoRunSignature,
    state.selectedTransformTableName,
    transformPipelineSteps,
    worker
  ]);

  useEffect(() => {
    if (
      !state.ready ||
      state.dataTab !== "transforms" ||
      !state.selectedTransformTableName ||
      transformPipelineSteps.length === 0 ||
      !pipelineAutoRunSignature
    ) {
      return;
    }
    if (lastAutoRunPipelineSignatureRef.current === pipelineAutoRunSignature) {
      return;
    }
    const timeout = window.setTimeout(() => {
      lastAutoRunPipelineSignatureRef.current = pipelineAutoRunSignature;
      void onRunPipeline();
    }, PIPELINE_AUTO_RUN_DELAY_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    onRunPipeline,
    pipelineAutoRunSignature,
    state.dataTab,
    state.ready,
    state.selectedTransformTableName,
    transformPipelineSteps.length
  ]);

  const onSaveQuery = useCallback(() => {
    if (!state.activeQueryTarget) {
      dispatch({
        type: "SET_STATUS",
        statusText: "Select a query target before saving."
      });
      return;
    }
    const queryText = state.sqlEditorText.trim();
    if (queryText && !isSelectLikeSql(queryText)) {
      dispatch({
        type: "SET_STATUS",
        statusText: "Saved queries must be SELECT/CTE statements."
      });
      return;
    }
    const queryName =
      activeQuery?.name ?? `Query_${state.savedQueries.length + 1}`;

    try {
      const result = saveQueryVersion({
        savedQueries: state.savedQueries,
        activeQueryId: state.activeQueryId,
        queryName,
        sql: state.sqlEditorText,
        target: state.activeQueryTarget
      });

      dispatch({
        type: "SET_SAVED_QUERIES",
        savedQueries: result.savedQueries
      });
      dispatch({
        type: "SET_ACTIVE_QUERY",
        queryId: result.activeQueryId
      });
      dispatch({
        type: "SET_PENDING_IMPACT",
        pendingImpact: result.pendingImpact
      });

      if (state.queryResult) {
        const blockQuerySql = state.queryResult.querySql ?? state.sqlEditorText;
        const blockQueryTarget =
          state.queryResult.queryTarget ?? state.activeQueryTarget ?? null;
        const createdAt = new Date().toISOString();
        const block: NotebookBlock = {
          id: crypto.randomUUID(),
          title: queryName,
          type: "table",
          createdAt,
          upstreamVersionId: getUpstreamVersionId(
            blockQueryTarget ?? state.activeQueryTarget
          ),
          pipelineStateHash: buildPipelineStateHash(blockQuerySql, blockQueryTarget),
          querySql: blockQuerySql,
          queryTarget: blockQueryTarget ?? undefined,
          payload: state.queryResult
        };
        dispatch({
          type: "ADD_NOTEBOOK_BLOCK",
          block
        });
      }

      dispatch({
        type: "SET_STATUS",
        statusText: result.pendingImpact
          ? `${queryName} saved as new version. Review dependent query impact.`
          : `${queryName} saved.`
      });
    } catch (error) {
      dispatch({
        type: "SET_STATUS",
        statusText: `Save failed: ${String(error)}`
      });
    }
  }, [
    activeQuery,
    state.activeQueryId,
    state.activeQueryTarget,
    buildPipelineStateHash,
    state.queryResult,
    state.savedQueries,
    state.sqlEditorText
  ]);

  const onRunWelchTTest = useCallback(
    async (input: {
      valueColumn: string;
      groupColumn: string;
      groupA: string;
      groupB: string;
      confidenceLevel?: number;
    }) => {
      if (!executionTarget) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select a table or query target before running tests."
        });
        return;
      }
      dispatch({
        type: "SET_STATUS",
        statusText: "Running Welch t-test..."
      });

      try {
        const querySql = "SELECT * FROM source";
        const runtimeSql = buildRuntimeSqlForTarget(querySql, executionTarget);
        const response = await worker.sendLatest("run_welch_t_test", {
          type: "RUN_WELCH_T_TEST",
          payload: {
            sql: runtimeSql,
            ...input
          }
        });
        const payload = asPayload<WelchTTestResult>(response);
        const analysisRequest: StatisticalTestRequest = {
          kind: "welch_t_test",
          ...input
        };
        const block: NotebookBlock = {
          id: crypto.randomUUID(),
          title: `Welch t-test: ${input.valueColumn}`,
          type: "test",
          createdAt: new Date().toISOString(),
          upstreamVersionId: getUpstreamVersionId(executionTarget),
          pipelineStateHash: hashRuntimeSql(runtimeSql),
          querySql,
          queryTarget: executionTarget,
          analysisRequest,
          payload
        };
        dispatch({
          type: "ADD_NOTEBOOK_BLOCK",
          block
        });
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "notebook"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `Welch t-test complete (p=${payload.pValue.toPrecision(4)}).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Welch t-test failed: ${String(error)}`
        });
      }
    },
    [
      buildRuntimeSqlForTarget,
      executionTarget,
      worker
    ]
  );

  const onRunPearsonCorrelation = useCallback(
    async (input: {
      xColumn: string;
      yColumn: string;
      method?: CorrelationMethod;
      confidenceLevel?: number;
    }) => {
      if (!executionTarget) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select a table or query target before running tests."
        });
        return;
      }
      const method = input.method ?? "pearson";
      const methodLabel = method[0].toUpperCase() + method.slice(1);
      dispatch({
        type: "SET_STATUS",
        statusText: `Running ${methodLabel} correlation...`
      });

      try {
        const querySql = "SELECT * FROM source";
        const runtimeSql = buildRuntimeSqlForTarget(querySql, executionTarget);
        const response = await worker.sendLatest("run_pearson_correlation", {
          type: "RUN_PEARSON_CORRELATION",
          payload: {
            sql: runtimeSql,
            xColumn: input.xColumn,
            yColumn: input.yColumn,
            method,
            confidenceLevel: input.confidenceLevel
          }
        });
        const payload = asPayload<PearsonCorrelationResult>(response);
        const analysisRequest: StatisticalTestRequest = {
          kind: "pearson_correlation",
          xColumn: input.xColumn,
          yColumn: input.yColumn,
          method,
          confidenceLevel: input.confidenceLevel
        };
        const block: NotebookBlock = {
          id: crypto.randomUUID(),
          title: `${methodLabel}: ${input.xColumn} vs ${input.yColumn}`,
          type: "test",
          createdAt: new Date().toISOString(),
          upstreamVersionId: getUpstreamVersionId(executionTarget),
          pipelineStateHash: hashRuntimeSql(runtimeSql),
          querySql,
          queryTarget: executionTarget,
          analysisRequest,
          payload
        };
        dispatch({
          type: "ADD_NOTEBOOK_BLOCK",
          block
        });
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "notebook"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${methodLabel} correlation complete (r=${payload.correlation.toPrecision(
            4
          )}, p=${payload.pValue.toPrecision(4)}).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `${methodLabel} correlation failed: ${String(error)}`
        });
      }
    },
    [
      buildRuntimeSqlForTarget,
      executionTarget,
      worker
    ]
  );

  const onRunChiSquareTest = useCallback(
    async (input: { rowColumn: string; columnColumn: string }) => {
      if (!executionTarget) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select a table or query target before running tests."
        });
        return;
      }
      dispatch({
        type: "SET_STATUS",
        statusText: "Running chi-square test..."
      });

      try {
        const querySql = "SELECT * FROM source";
        const runtimeSql = buildRuntimeSqlForTarget(querySql, executionTarget);
        const response = await worker.sendLatest("run_chi_square_test", {
          type: "RUN_CHI_SQUARE_TEST",
          payload: {
            sql: runtimeSql,
            ...input
          }
        });
        const payload = asPayload<ChiSquareTestResult>(response);
        const analysisRequest: StatisticalTestRequest = {
          kind: "chi_square_test",
          ...input
        };
        const block: NotebookBlock = {
          id: crypto.randomUUID(),
          title: `Chi-square: ${input.rowColumn} x ${input.columnColumn}`,
          type: "test",
          createdAt: new Date().toISOString(),
          upstreamVersionId: getUpstreamVersionId(executionTarget),
          pipelineStateHash: hashRuntimeSql(runtimeSql),
          querySql,
          queryTarget: executionTarget,
          analysisRequest,
          payload
        };
        dispatch({
          type: "ADD_NOTEBOOK_BLOCK",
          block
        });
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "notebook"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `Chi-square complete (p=${payload.pValue.toPrecision(4)}).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Chi-square test failed: ${String(error)}`
        });
      }
    },
    [
      buildRuntimeSqlForTarget,
      executionTarget,
      worker
    ]
  );

  const onRunOLSRegression = useCallback(
    async (input: {
      dependentColumn: string;
      independentColumns: string[];
      includeIntercept: boolean;
      oneHotEncodeCategorical: boolean;
    }) => {
      if (!executionTarget) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select a table or query target before running OLS regression."
        });
        return;
      }
      const independentColumns = Array.from(
        new Set(
          input.independentColumns
            .map((column) => column.trim())
            .filter((column) => column.length > 0 && column !== input.dependentColumn)
        )
      );
      if (!input.dependentColumn.trim() || independentColumns.length === 0) {
        dispatch({
          type: "SET_STATUS",
          statusText:
            "OLS regression requires one dependent column and at least one independent column."
        });
        return;
      }
      const availableStatsColumns = new Set(statisticsAvailableColumns);
      const missingColumns = [
        input.dependentColumn,
        ...independentColumns
      ].filter((column) => !availableStatsColumns.has(column));
      if (missingColumns.length > 0) {
        dispatch({
          type: "SET_STATUS",
          statusText: `OLS regression columns are not in the selected target: ${missingColumns.join(
            ", "
          )}.`
        });
        return;
      }

      dispatch({
        type: "SET_STATUS",
        statusText: "Running OLS regression..."
      });
      try {
        const querySql = "SELECT * FROM source";
        const runtimeSql = buildRuntimeSqlForTarget(querySql, executionTarget);
        const response = await worker.sendLatest("run_ols_regression", {
          type: "RUN_OLS_REGRESSION",
          payload: {
            sql: runtimeSql,
            dependentColumn: input.dependentColumn,
            independentColumns,
            includeIntercept: input.includeIntercept,
            oneHotEncodeCategorical: input.oneHotEncodeCategorical,
            maxDiagnosticPoints: OLS_DIAGNOSTIC_MAX_POINTS
          }
        });
        const payload = asPayload<OLSRegressionResult>(response);
        const analysisRequest: StatisticalTestRequest = {
          kind: "ols_regression",
          dependentColumn: input.dependentColumn,
          independentColumns,
          includeIntercept: input.includeIntercept,
          oneHotEncodeCategorical: input.oneHotEncodeCategorical
        };
        const predictorsLabel = independentColumns.join(" + ");
        const block: NotebookBlock = {
          id: crypto.randomUUID(),
          title: `OLS: ${input.dependentColumn} ~ ${predictorsLabel}`,
          type: "model",
          createdAt: new Date().toISOString(),
          upstreamVersionId: getUpstreamVersionId(executionTarget),
          pipelineStateHash: hashRuntimeSql(runtimeSql),
          querySql,
          queryTarget: executionTarget,
          analysisRequest,
          payload
        };
        dispatch({
          type: "ADD_NOTEBOOK_BLOCK",
          block
        });
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "notebook"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `OLS regression complete (R²=${payload.r2.toPrecision(4)}, n=${payload.n}).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `OLS regression failed: ${String(error)}`
        });
      }
    },
    [
      buildRuntimeSqlForTarget,
      executionTarget,
      statisticsAvailableColumns,
      worker
    ]
  );

  const onDescribeTarget = useCallback(
    async (target: QueryTargetRef) => {
      const profileLabel = formatProfileLabel(target);
      dispatch({
        type: "SET_STATUS",
        statusText: `Describing ${profileLabel}...`
      });
      try {
        const runtimeSql = buildRuntimeSqlForTarget("SELECT * FROM source", target);
        const response = await worker.sendLatest("describe_sql", {
          type: "PROFILE_SQL",
          payload: {
            sql: runtimeSql,
            label: `Describe: ${profileLabel}`,
            limitColumns: 120
          }
        });
        const payload = asPayload<TableProfile>(response);
        dispatch({
          type: "SET_PROFILE",
          profile: payload
        });
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "describe"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `Describe complete for ${payload.tableName}.`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Describe failed: ${String(error)}`
        });
      }
    },
    [buildRuntimeSqlForTarget, worker]
  );

  const onExportRecipe = useCallback(() => {
    const recipe = buildRecipe({
      sources: state.sources,
      pipeline: transformPipelineSteps,
      pipelinesByTable: state.pipelinesByTable,
      activePipelineStepIdByTable: state.activePipelineStepIdByTable,
      selectedTransformTableName: state.selectedTransformTableName,
      savedQueries: state.savedQueries,
      notebookBlocks: state.notebookBlocks,
      columnEditsByTable: state.columnEditsByTable
    });
    const blob = new Blob([JSON.stringify(recipe, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `statsfish-recipe-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    dispatch({
      type: "SET_STATUS",
      statusText: "Recipe exported."
    });
  }, [
    state.activePipelineStepIdByTable,
    state.columnEditsByTable,
    state.notebookBlocks,
    state.pipelinesByTable,
    state.savedQueries,
    state.selectedTransformTableName,
    state.sources,
    transformPipelineSteps
  ]);

  const onPickRecipeFile = useCallback(() => {
    recipeInputRef.current?.click();
  }, []);

  const onImportRecipeFile = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) {
        return;
      }
      try {
        const raw = await file.text();
        const recipe = parseRecipe(raw);
        const normalizedSavedQueries = normalizeSavedQueries(recipe.savedQueries);
        const normalizedPipelineSteps = normalizePipelineSteps(recipe.pipeline);
        const normalizedRecipePipelinesByTableRaw = normalizePipelinesByTable(
          recipe.pipelinesByTable
        );
        const normalizedRecipePipelinesByTable: Record<
          string,
          ReturnType<typeof normalizePipelineSteps>
        > = {};
        const normalizedColumnEditsByTable = normalizeColumnEditsByTable(
          recipe.columnEditsByTable
        );
        let safeSavedQueries = normalizedSavedQueries;
        let warning: string | null = null;
        for (const [tableName, steps] of Object.entries(normalizedRecipePipelinesByTableRaw)) {
          const normalizedSteps = normalizePipelineSteps(steps);
          normalizedRecipePipelinesByTable[tableName] = normalizedSteps;
          if (normalizedSteps.length !== steps.length) {
            warning = warning
              ? `${warning} Some invalid pipeline steps were skipped for ${tableName}.`
              : `Some invalid pipeline steps were skipped for ${tableName}.`;
          }
        }
        try {
          validateSavedQueries(normalizedSavedQueries);
        } catch (error) {
          safeSavedQueries = [];
          warning = `Imported saved queries were skipped: ${String(error)}`;
        }
        if (normalizedPipelineSteps.length !== recipe.pipeline.length) {
          warning = warning
            ? `${warning} Some invalid pipeline steps were skipped.`
            : "Some invalid pipeline steps were skipped.";
        }
        const recipeSelectedTransformTableName =
          typeof recipe.selectedTransformTableName === "string"
            ? recipe.selectedTransformTableName
            : null;
        const fallbackRecipePipelineTableName =
          recipeSelectedTransformTableName ??
          state.selectedTransformTableName ??
          state.activeTableName ??
          firstTableName ??
          Object.keys(normalizedRecipePipelinesByTable)[0] ??
          "source";

        if (
          Object.keys(normalizedRecipePipelinesByTable).length === 0 &&
          fallbackRecipePipelineTableName
        ) {
          normalizedRecipePipelinesByTable[fallbackRecipePipelineTableName] =
            normalizedPipelineSteps;
        }

        const normalizedRecipeActiveStepByTableRaw = normalizeActivePipelineStepIdByTable(
          recipe.activePipelineStepIdByTable
        );
        const normalizedRecipeActiveStepByTable: Record<string, string | null> = {};
        for (const [tableName, steps] of Object.entries(normalizedRecipePipelinesByTable)) {
          const requestedStepId = normalizedRecipeActiveStepByTableRaw[tableName] ?? null;
          normalizedRecipeActiveStepByTable[tableName] =
            steps.find((step) => step.id === requestedStepId)?.id ?? steps[0]?.id ?? null;
        }

        if (
          recipeSelectedTransformTableName &&
          !(recipeSelectedTransformTableName in normalizedRecipePipelinesByTable)
        ) {
          warning = warning
            ? `${warning} Saved transform-table selection "${recipeSelectedTransformTableName}" was unavailable; using fallback selection.`
            : `Saved transform-table selection "${recipeSelectedTransformTableName}" was unavailable; using fallback selection.`;
        }

        const selectedTransformTableName =
          recipeSelectedTransformTableName &&
          recipeSelectedTransformTableName in normalizedRecipePipelinesByTable
            ? recipeSelectedTransformTableName
            : fallbackRecipePipelineTableName;
        const selectedPipelineSteps = selectedTransformTableName
          ? normalizedRecipePipelinesByTable[selectedTransformTableName] ?? []
          : [];
        const selectedActivePipelineStepId = selectedTransformTableName
          ? normalizedRecipeActiveStepByTable[selectedTransformTableName] ??
            selectedPipelineSteps[0]?.id ??
            null
          : null;
        dispatch({
          type: "HYDRATE",
          patch: {
            sources: recipe.sources,
            selectedTransformTableName,
            pipelinesByTable: normalizedRecipePipelinesByTable,
            activePipelineStepIdByTable: normalizedRecipeActiveStepByTable,
            pipelineSteps: selectedPipelineSteps,
            activePipelineStepId: selectedActivePipelineStepId,
            columnEditsByTable: normalizedColumnEditsByTable,
            savedQueries: safeSavedQueries,
            notebookBlocks: recipe.notebookBlocks,
            sqlEditorText:
              safeSavedQueries.length > 0
                ? getActiveVersion(safeSavedQueries[0]).sql
                : state.sqlEditorText,
            activeQueryId: safeSavedQueries[0]?.id ?? null,
            activeQueryTarget:
              safeSavedQueries.length > 0
                ? getActiveVersion(safeSavedQueries[0]).target
                : state.activeQueryTarget
          }
        });
        dispatch({
          type: "SET_STATUS",
          statusText: warning
            ? `${warning} Re-select original CSV files to fully restore table data.`
            : "Recipe imported. Re-select original CSV files to fully restore table data."
        });
      } catch (error) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Recipe import failed: ${String(error)}`
        });
      }
    },
    [
      firstTableName,
      state.activeQueryTarget,
      state.activeTableName,
      state.selectedTransformTableName,
      state.sqlEditorText
    ]
  );

  const onTargetChange = useCallback(
    (targetOptionKey: string) => {
      const target = targetLookup.get(targetOptionKey);
      if (!target) {
        return;
      }
      dispatch({
        type: "SET_QUERY_TARGET",
        target
      });
    },
    [targetLookup]
  );

  const onNewQuery = useCallback(() => {
    dispatch({
      type: "SET_ACTIVE_QUERY",
      queryId: null
    });
    dispatch({
      type: "SET_ACTIVE_PIPELINE_STEP",
      stepId: null
    });
    dispatch({
      type: "SET_SQL",
      sql: ""
    });
    if (!state.activeQueryTarget && firstTableName) {
      dispatch({
        type: "SET_QUERY_TARGET",
        target: { kind: "table", tableName: firstTableName }
      });
    }
  }, [firstTableName, state.activeQueryTarget]);

  const onCreateQueryFromDataWindow = useCallback(() => {
    onNewQuery();
    setOpenNewQuerySignal((value) => value + 1);
    dispatch({
      type: "SET_DATA_TAB",
      tab: "queries"
    });
  }, [onNewQuery]);

  const onCreateTransformFromDataWindow = useCallback((tableName: string | null) => {
    const resolvedTableName =
      tableName ?? state.selectedTransformTableName ?? state.activeTableName ?? firstTableName;
    if (resolvedTableName) {
      dispatch({
        type: "SET_SELECTED_TRANSFORM_TABLE",
        tableName: resolvedTableName
      });
    }
    dispatch({
      type: "SET_ACTIVE_QUERY",
      queryId: null
    });
    dispatch({
      type: "SET_ACTIVE_PIPELINE_STEP",
      stepId: null
    });
    dispatch({
      type: "SET_SQL",
      sql: ""
    });
    setOpenNewTransformSignal((value) => value + 1);
    dispatch({
      type: "SET_DATA_TAB",
      tab: "transforms"
    });
  }, [firstTableName, state.activeTableName, state.selectedTransformTableName]);

  const onRenamePipelineStep = useCallback(
    (stepId: string, nextNameRaw: string) => {
      if (!state.selectedTransformTableName) {
        return;
      }
      const step = transformPipelineSteps.find((entry) => entry.id === stepId);
      if (!step) {
        return;
      }
      const nextName = sanitizeIdentifier(nextNameRaw);
      if (!nextName) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Transform name cannot be empty."
        });
        return;
      }
      const duplicate = transformPipelineSteps.find(
        (entry) =>
          entry.id !== stepId && entry.name.toLowerCase() === nextName.toLowerCase()
      );
      if (duplicate) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Transform name "${nextName}" is already in use.`
        });
        return;
      }
      if (nextName === step.name) {
        return;
      }

      const renamedStep = {
        ...step,
        name: nextName
      };
      const renamedSavedQueries = state.savedQueries.map((query) => ({
        ...query,
        versions: query.versions.map((version) => ({
          ...version,
          target: renamePipelineStepTarget(
            version.target,
            stepId,
            nextName,
            state.selectedTransformTableName ?? undefined
          )
        }))
      }));
      const renamedNotebookBlocks = state.notebookBlocks.map((block) => ({
        ...block,
        queryTarget: block.queryTarget
          ? renamePipelineStepTarget(
              block.queryTarget,
              stepId,
              nextName,
              state.selectedTransformTableName ?? undefined
            )
          : block.queryTarget
      }));
      const renamedActiveTarget = state.activeQueryTarget
        ? renamePipelineStepTarget(
            state.activeQueryTarget,
            stepId,
            nextName,
            state.selectedTransformTableName ?? undefined
          )
        : null;

      dispatch({
        type: "UPDATE_PIPELINE_STEP",
        step: renamedStep
      });
      dispatch({
        type: "HYDRATE",
        patch: {
          savedQueries: renamedSavedQueries,
          notebookBlocks: renamedNotebookBlocks,
          activeQueryTarget: renamedActiveTarget
        }
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `Transform renamed to ${nextName}.`
      });
    },
    [
      state.activeQueryTarget,
      state.notebookBlocks,
      state.savedQueries,
      state.selectedTransformTableName,
      transformPipelineSteps
    ]
  );

  const onRenameSavedQuery = useCallback(
    (queryId: string, nextNameRaw: string) => {
      const query = state.savedQueries.find((entry) => entry.id === queryId);
      if (!query) {
        return;
      }
      const nextName = sanitizeIdentifier(nextNameRaw);
      if (!nextName) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Query name cannot be empty."
        });
        return;
      }
      const duplicate = state.savedQueries.find(
        (entry) => entry.id !== queryId && entry.name.toLowerCase() === nextName.toLowerCase()
      );
      if (duplicate) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Query name "${nextName}" is already in use.`
        });
        return;
      }
      if (nextName === query.name) {
        return;
      }

      const renamedSavedQueries = state.savedQueries.map((entry) => ({
        ...entry,
        name: entry.id === queryId ? nextName : entry.name,
        versions: entry.versions.map((version) => ({
          ...version,
          target: renameQueryTarget(version.target, queryId, nextName)
        }))
      }));
      const renamedNotebookBlocks = state.notebookBlocks.map((block) => ({
        ...block,
        queryTarget: block.queryTarget
          ? renameQueryTarget(block.queryTarget, queryId, nextName)
          : block.queryTarget,
        title:
          block.type === "table" && block.title === query.name ? nextName : block.title
      }));
      const renamedActiveTarget = state.activeQueryTarget
        ? renameQueryTarget(state.activeQueryTarget, queryId, nextName)
        : null;
      const renamedPendingImpact = state.pendingImpact
        ? {
            ...state.pendingImpact,
            editedQueryName:
              state.pendingImpact.editedQueryId === queryId
                ? nextName
                : state.pendingImpact.editedQueryName,
            items: state.pendingImpact.items.map((item) =>
              item.queryId === queryId ? { ...item, queryName: nextName } : item
            )
          }
        : null;

      dispatch({
        type: "HYDRATE",
        patch: {
          savedQueries: renamedSavedQueries,
          notebookBlocks: renamedNotebookBlocks,
          activeQueryTarget: renamedActiveTarget,
          pendingImpact: renamedPendingImpact
        }
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `Query renamed to ${nextName}.`
      });
    },
    [state.activeQueryTarget, state.notebookBlocks, state.pendingImpact, state.savedQueries]
  );

  const onRequestPruneQueryVersions = useCallback(
    (queryId: string) => {
      const query = state.savedQueries.find((entry) => entry.id === queryId);
      if (!query) {
        return;
      }
      const removableVersions = query.versions
        .map((version, index) => ({
          versionId: version.versionId,
          versionLabel: `v${index + 1}`,
          createdAt: version.createdAt,
          targetLabel: formatQueryTarget(version.target),
          sql: version.sql
        }))
        .filter((version) => version.versionId !== query.activeVersionId);
      if (removableVersions.length <= 0) {
        dispatch({
          type: "SET_STATUS",
          statusText: `${query.name} has no old versions to prune.`
        });
        return;
      }
      setPruneQueryDialog({
        queryId,
        queryName: query.name,
        removableVersions,
        selectedVersionIds: removableVersions.map((version) => version.versionId)
      });
    },
    [state.savedQueries]
  );

  const onTogglePruneVersionSelection = useCallback((versionId: string) => {
    setPruneQueryDialog((current) => {
      if (!current) {
        return current;
      }
      const hasVersionId = current.selectedVersionIds.includes(versionId);
      return {
        ...current,
        selectedVersionIds: hasVersionId
          ? current.selectedVersionIds.filter((id) => id !== versionId)
          : [...current.selectedVersionIds, versionId]
      };
    });
  }, []);

  const onCancelPruneQueryDialog = useCallback(() => {
    setPruneQueryDialog(null);
  }, []);

  const onConfirmPruneQueryDialog = useCallback(() => {
    if (!pruneQueryDialog) {
      return;
    }
    if (state.pendingImpact) {
      setPruneQueryDialog(null);
      dispatch({
        type: "SET_STATUS",
        statusText:
          "Resolve pending dependency impact decisions before pruning query versions."
      });
      return;
    }

    try {
      if (pruneQueryDialog.selectedVersionIds.length === 0) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select at least one old version to prune."
        });
        return;
      }
      const query = state.savedQueries.find((entry) => entry.id === pruneQueryDialog.queryId);
      if (!query) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Query no longer exists."
        });
        setPruneQueryDialog(null);
        return;
      }
      const protectedVersionIds = new Set<string>();
      if (state.activeQueryTarget?.kind === "query_version") {
        protectedVersionIds.add(state.activeQueryTarget.versionId);
      }
      for (const block of state.notebookBlocks) {
        if (block.queryTarget?.kind === "query_version") {
          protectedVersionIds.add(block.queryTarget.versionId);
        }
      }
      const selectedVersionSet = new Set(pruneQueryDialog.selectedVersionIds);
      const keepVersionIds = query.versions
        .map((version) => version.versionId)
        .filter((versionId) => !selectedVersionSet.has(versionId));

      const result = pruneQueryVersions({
        savedQueries: state.savedQueries,
        queryId: pruneQueryDialog.queryId,
        keepVersionIds,
        protectedVersionIds: Array.from(protectedVersionIds)
      });
      dispatch({
        type: "SET_SAVED_QUERIES",
        savedQueries: result.savedQueries
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `${pruneQueryDialog.queryName}: pruned ${result.removedVersionIds.length.toLocaleString()} old version(s).`
      });
    } catch (error) {
      dispatch({
        type: "SET_STATUS",
        statusText: `Prune failed: ${toErrorMessage(error)}`
      });
    } finally {
      setPruneQueryDialog(null);
    }
  }, [
    pruneQueryDialog,
    state.activeQueryTarget,
    state.notebookBlocks,
    state.pendingImpact,
    state.savedQueries
  ]);

  const onApplyImpact = useCallback(() => {
    if (!state.pendingImpact) {
      return;
    }
    try {
      const updatedQueries = applyImpactDecisions(
        state.savedQueries,
        state.pendingImpact
      );
      dispatch({
        type: "SET_SAVED_QUERIES",
        savedQueries: updatedQueries
      });
      dispatch({
        type: "SET_PENDING_IMPACT",
        pendingImpact: null
      });
      dispatch({
        type: "SET_STATUS",
        statusText: "Dependent query decisions applied."
      });
    } catch (error) {
      dispatch({
        type: "SET_STATUS",
        statusText: `Impact update failed: ${String(error)}`
      });
    }
  }, [state.pendingImpact, state.savedQueries]);

  const onDismissImpact = useCallback(() => {
    dispatch({
      type: "SET_PENDING_IMPACT",
      pendingImpact: null
    });
    dispatch({
      type: "SET_STATUS",
      statusText: "Impact review closed. Dependents stay pinned to previous versions."
    });
  }, []);

  const onDeleteNotebookBlock = useCallback((blockId: string) => {
    dispatch({
      type: "REMOVE_NOTEBOOK_BLOCK",
      blockId
    });
    dispatch({
      type: "SET_STATUS",
      statusText: "Notebook block deleted."
    });
  }, []);

  const onCreateChart = useCallback(
    async (input: {
      chartType: NotebookChartType;
      xColumn: string;
      yColumn: string;
      seriesColumn?: string;
      facetColumn?: string;
      title?: string;
      xAxisLabel?: string;
      yAxisLabel?: string;
      autoRange?: boolean;
      xMin?: number;
      xMax?: number;
      yMin?: number;
      yMax?: number;
      showBestFitLine?: boolean;
      histogramBins?: number;
    }) => {
      if (!executionTarget) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Select a target before creating a visualization."
        });
        return;
      }
      const isHistogram = input.chartType === "histogram";
      const xColumn = input.xColumn.trim();
      const yColumn = isHistogram ? "count" : input.yColumn.trim();
      const seriesColumn = input.seriesColumn?.trim() ?? "";
      const facetColumn = input.facetColumn?.trim() ?? "";
      if (!xColumn || (!isHistogram && !yColumn)) {
        dispatch({
          type: "SET_STATUS",
          statusText: isHistogram
            ? "Select a value column before creating a histogram."
            : "Select both X and Y columns before creating a visualization."
        });
        return;
      }
      if (input.chartType === "bar" && seriesColumn) {
        dispatch({
          type: "SET_STATUS",
          statusText: "Bar charts currently support a single series. Clear the Series field."
        });
        return;
      }
      dispatch({
        type: "SET_STATUS",
        statusText: "Building visualization..."
      });
      try {
        const autoRange = input.autoRange !== false;
        const selectSeriesClause = seriesColumn
          ? `, CAST(${quoteIdentifier(seriesColumn)} AS VARCHAR) AS _sf_series`
          : "";
        const selectFacetClause = facetColumn
          ? `, CAST(${quoteIdentifier(facetColumn)} AS VARCHAR) AS _sf_facet`
          : "";
        const chartDataSql = isHistogram
          ? `
              SELECT
                TRY_CAST(${quoteIdentifier(xColumn)} AS DOUBLE) AS _sf_x
                ${selectSeriesClause}
                ${selectFacetClause}
              FROM source
              WHERE TRY_CAST(${quoteIdentifier(xColumn)} AS DOUBLE) IS NOT NULL
              LIMIT ${CHART_QUERY_MAX_ROWS}
            `
          : `
              SELECT
                ${quoteIdentifier(xColumn)} AS _sf_x,
                ${quoteIdentifier(yColumn)} AS _sf_y
                ${selectSeriesClause}
                ${selectFacetClause}
              FROM source
              WHERE ${quoteIdentifier(xColumn)} IS NOT NULL
                AND ${quoteIdentifier(yColumn)} IS NOT NULL
              LIMIT ${CHART_QUERY_MAX_ROWS}
            `;
        const runtimeSql = buildRuntimeSqlForTarget(chartDataSql, executionTarget);
        const response = await worker.sendLatest("create_chart_data", {
          type: "RUN_SQL",
          payload: {
            sql: runtimeSql,
            limit: CHART_QUERY_MAX_ROWS,
            includeTotalRowCount: false
          }
        });
        const queryPayload = asPayload<{
          columns: string[];
          rows: Array<Array<string | number | boolean | null>>;
          rowCount: number;
        }>(response);
        const xIndex = queryPayload.columns.indexOf("_sf_x");
        const yIndex = queryPayload.columns.indexOf("_sf_y");
        const seriesIndex = queryPayload.columns.indexOf("_sf_series");
        const facetIndex = queryPayload.columns.indexOf("_sf_facet");
        const toCategory = (value: string | number | boolean | null): string => {
          if (value === null) {
            return "null";
          }
          return String(value);
        };
        type ChartPoint = {
          x: string | number;
          y: number;
          series?: string;
          facet?: string;
        };
        const sampleEvenly = <T,>(values: T[], maxCount: number): T[] => {
          if (values.length <= maxCount) {
            return values;
          }
          return Array.from({ length: maxCount }, (_, index) => {
            const sourceIndex = Math.floor((index * values.length) / maxCount);
            return values[sourceIndex];
          });
        };
        let rawPoints: ChartPoint[] = [];
        if (isHistogram) {
          type HistogramGroup = {
            series?: string;
            facet?: string;
            values: number[];
          };
          const groups = new Map<string, HistogramGroup>();
          const allValues: number[] = [];
          for (const row of queryPayload.rows) {
            const value = toFiniteNumber(row[xIndex] ?? null);
            if (value === null) {
              continue;
            }
            allValues.push(value);
            const seriesValue =
              seriesIndex >= 0 ? toCategory((row[seriesIndex] as PrimitiveValue) ?? null) : undefined;
            const facetValue =
              facetIndex >= 0 ? toCategory((row[facetIndex] as PrimitiveValue) ?? null) : undefined;
            const groupKey = `${facetValue ?? ""}\u0000${seriesValue ?? ""}`;
            const existing = groups.get(groupKey);
            if (existing) {
              existing.values.push(value);
              continue;
            }
            groups.set(groupKey, {
              series: seriesValue,
              facet: facetValue,
              values: [value]
            });
          }
          if (allValues.length === 0 || groups.size === 0) {
            dispatch({
              type: "SET_STATUS",
              statusText: "No numeric values are available for the selected histogram column."
            });
            return;
          }
          const requestedBins =
            typeof input.histogramBins === "number" && Number.isFinite(input.histogramBins)
              ? Math.floor(input.histogramBins)
              : 20;
          const binCount = Math.max(1, Math.min(200, requestedBins));
          const minValue = Math.min(...allValues);
          const maxValue = Math.max(...allValues);
          if (!(maxValue > minValue)) {
            rawPoints = Array.from(groups.values()).map((group) => ({
              x: minValue,
              y: group.values.length,
              series: group.series,
              facet: group.facet
            }));
          } else {
            const binWidth = (maxValue - minValue) / binCount;
            rawPoints = [];
            for (const group of groups.values()) {
              const counts = Array.from({ length: binCount }, () => 0);
              for (const value of group.values) {
                let binIndex = Math.floor((value - minValue) / binWidth);
                if (binIndex >= binCount) {
                  binIndex = binCount - 1;
                }
                if (binIndex < 0) {
                  binIndex = 0;
                }
                counts[binIndex] += 1;
              }
              rawPoints.push(
                ...counts.map((count, index) => ({
                  x: minValue + (index + 0.5) * binWidth,
                  y: count,
                  series: group.series,
                  facet: group.facet
                }))
              );
            }
          }
        } else {
          rawPoints = [];
          for (const row of queryPayload.rows) {
            const y = toFiniteNumber(row[yIndex] ?? null);
            if (y === null) {
              continue;
            }
            const rawX = row[xIndex];
            const x =
              typeof rawX === "number" || typeof rawX === "string"
                ? rawX
                : rawX === null
                  ? "null"
                  : String(rawX);
            const seriesValue =
              seriesIndex >= 0
                ? toCategory((row[seriesIndex] as PrimitiveValue) ?? null)
                : undefined;
            const facetValue =
              facetIndex >= 0
                ? toCategory((row[facetIndex] as PrimitiveValue) ?? null)
                : undefined;
            const point: ChartPoint = {
              x,
              y
            };
            if (seriesValue !== undefined) {
              point.series = seriesValue;
            }
            if (facetValue !== undefined) {
              point.facet = facetValue;
            }
            rawPoints.push(point);
          }
        }
        if (rawPoints.length === 0) {
          dispatch({
            type: "SET_STATUS",
            statusText: "No numeric points available for the selected columns."
          });
          return;
        }
        const pointGroups = facetColumn
          ? Array.from(
              rawPoints.reduce((accumulator, point) => {
                const key = point.facet ?? "null";
                const existing = accumulator.get(key) ?? [];
                existing.push(point);
                accumulator.set(key, existing);
                return accumulator;
              }, new Map<string, ChartPoint[]>())
            )
          : [["__all__", rawPoints] as [string, ChartPoint[]]];
        if (facetColumn && pointGroups.length > 12) {
          dispatch({
            type: "SET_STATUS",
            statusText:
              "Facet column produced too many groups. Limit to 12 or fewer unique values."
          });
          return;
        }

        const buildChartPayload = (groupPoints: ChartPoint[]): {
          payload: NotebookChartPayload;
          sampledPoints: number;
          totalPoints: number;
        } | null => {
          const maxPoints = isHistogram ? groupPoints.length : 2000;
          const points = sampleEvenly(groupPoints, maxPoints);
          const numericXPoints = points
            .map((point) => ({
              x: toFiniteNumber(point.x),
              y: point.y
            }))
            .filter((point): point is { x: number; y: number } => point.x !== null);
          const xIsNumericForAllPoints = numericXPoints.length === points.length;

          if (!autoRange) {
            if (
              input.xMin !== undefined &&
              input.xMax !== undefined &&
              input.xMin >= input.xMax
            ) {
              dispatch({
                type: "SET_STATUS",
                statusText: "X-axis minimum must be lower than maximum."
              });
              return null;
            }
            if (
              input.yMin !== undefined &&
              input.yMax !== undefined &&
              input.yMin >= input.yMax
            ) {
              dispatch({
                type: "SET_STATUS",
                statusText: "Y-axis minimum must be lower than maximum."
              });
              return null;
            }
            if (
              input.chartType !== "bar" &&
              (input.xMin !== undefined || input.xMax !== undefined) &&
              !xIsNumericForAllPoints
            ) {
              dispatch({
                type: "SET_STATUS",
                statusText: "Manual X-axis ranges require a numeric X column."
              });
              return null;
            }
          }

          let bestFitLine: NotebookChartPayload["bestFitLine"] | undefined;
          if (
            input.showBestFitLine &&
            (input.chartType === "line" || input.chartType === "scatter")
          ) {
            if (!xIsNumericForAllPoints) {
              dispatch({
                type: "SET_STATUS",
                statusText: "Best-fit line requires a numeric X column."
              });
              return null;
            }
            const fit = computeLinearBestFit(numericXPoints);
            if (!fit) {
              dispatch({
                type: "SET_STATUS",
                statusText:
                  "Best-fit line needs at least two points with varying X values."
              });
              return null;
            }
            bestFitLine = {
              slope: fit.slope,
              intercept: fit.intercept,
              r2: fit.r2
            };
          }

          return {
            payload: {
              kind: "chart_v1",
              chartType: input.chartType,
              title: input.title,
              xColumn,
              yColumn,
              seriesColumn: seriesColumn || undefined,
              facetColumn: facetColumn || undefined,
              xAxisLabel: input.xAxisLabel,
              yAxisLabel: input.yAxisLabel,
              autoRange,
              xRange:
                autoRange || input.chartType === "bar"
                  ? undefined
                  : {
                      min: input.xMin,
                      max: input.xMax
                    },
              yRange: autoRange
                ? undefined
                : {
                    min: input.yMin,
                    max: input.yMax
                  },
              bestFitLine,
              points
            },
            sampledPoints: points.length,
            totalPoints: groupPoints.length
          };
        };

        const baseBlockTitle =
          input.title?.trim() ||
          (isHistogram
            ? `HISTOGRAM: ${xColumn}`
            : `${input.chartType.toUpperCase()}: ${yColumn} by ${xColumn}`);
        let totalSampledPoints = 0;
        let totalRawPoints = 0;
        let createdBlocks = 0;
        for (const [facetValue, groupPoints] of pointGroups) {
          const built = buildChartPayload(groupPoints);
          if (!built) {
            return;
          }
          totalSampledPoints += built.sampledPoints;
          totalRawPoints += built.totalPoints;
          const blockTitle =
            facetColumn && facetValue !== "__all__"
              ? `${baseBlockTitle} | ${facetColumn}=${facetValue}`
              : baseBlockTitle;
          const block: NotebookBlock = {
            id: crypto.randomUUID(),
            title: blockTitle,
            type: "chart",
            createdAt: new Date().toISOString(),
            upstreamVersionId: getUpstreamVersionId(executionTarget),
            pipelineStateHash: hashRuntimeSql(runtimeSql),
            querySql: chartDataSql,
            queryTarget: executionTarget,
            payload: built.payload
          };
          dispatch({
            type: "ADD_NOTEBOOK_BLOCK",
            block
          });
          createdBlocks += 1;
        }
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "notebook"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: facetColumn
            ? `Created ${createdBlocks.toLocaleString()} faceted visualization block(s) (${totalSampledPoints.toLocaleString()} of ${totalRawPoints.toLocaleString()} points).`
            : totalSampledPoints < totalRawPoints
              ? `Visualization created (${totalSampledPoints.toLocaleString()} of ${totalRawPoints.toLocaleString()} points).`
              : `Visualization created (${totalSampledPoints.toLocaleString()} ${
                  isHistogram ? "bins" : "points"
                }).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Visualization failed: ${String(error)}`
        });
      }
    },
    [buildRuntimeSqlForTarget, executionTarget, worker]
  );

  const onRerunNotebookBlock = useCallback(
    async (blockId: string) => {
      const block = state.notebookBlocks.find((entry) => entry.id === blockId);
      if (!block) {
        return;
      }
      if (!block.querySql || !block.queryTarget) {
        dispatch({
          type: "SET_STATUS",
          statusText: "This notebook block cannot be rerun yet."
        });
        return;
      }
      dispatch({
        type: "SET_STATUS",
        statusText: `Rerunning notebook block "${block.title}"...`
      });
      try {
        const runtimeSql = buildRuntimeSqlForTarget(block.querySql, block.queryTarget);

        let payload: unknown;
        if (block.type === "table") {
          const response = await worker.sendLatest(`rerun_block_${block.id}`, {
            type: "RUN_SQL",
            payload: {
              sql: runtimeSql,
              limit: 250
            }
          });
          const tablePayload = asPayload<{
            columns: string[];
            rows: Array<Array<string | number | boolean | null>>;
            rowCount: number;
          }>(response);
          payload = tablePayload;
          dispatch({
            type: "SET_QUERY_RESULT",
            result: {
              ...tablePayload,
              querySql: block.querySql,
              queryTarget: block.queryTarget
            }
          });
        } else if (block.type === "chart" && isChartPayload(block.payload)) {
          const chartPayload = block.payload;
          const response = await worker.sendLatest(`rerun_block_${block.id}`, {
            type: "RUN_SQL",
            payload: {
              sql: runtimeSql,
              limit: CHART_QUERY_MAX_ROWS,
              includeTotalRowCount: false
            }
          });
          const queryPayload = asPayload<{
            columns: string[];
            rows: Array<Array<string | number | boolean | null>>;
            rowCount: number;
          }>(response);
          const xIndex = queryPayload.columns.indexOf("_sf_x");
          const yIndex = queryPayload.columns.indexOf("_sf_y");
          const seriesIndex = queryPayload.columns.indexOf("_sf_series");
          const facetIndex = queryPayload.columns.indexOf("_sf_facet");
          const resolvedXIndex = xIndex >= 0 ? xIndex : 0;
          const resolvedYIndex = yIndex >= 0 ? yIndex : 1;
          const toCategory = (value: PrimitiveValue): string =>
            value === null ? "null" : String(value);
          const existingFacetValues = Array.from(
            new Set(
              chartPayload.points
                .map((point) => point.facet)
                .filter((value): value is string => !!value)
            )
          );
          const facetFilter =
            chartPayload.facetColumn && existingFacetValues.length === 1
              ? existingFacetValues[0]
              : undefined;
          type ChartPoint = {
            x: string | number;
            y: number;
            series?: string;
            facet?: string;
          };
          const sampleEvenly = <T,>(values: T[], maxCount: number): T[] => {
            if (values.length <= maxCount) {
              return values;
            }
            return Array.from({ length: maxCount }, (_, index) => {
              const sourceIndex = Math.floor((index * values.length) / maxCount);
              return values[sourceIndex];
            });
          };

          let rawPoints: ChartPoint[] = [];
          if (chartPayload.chartType === "histogram") {
            type HistogramGroup = {
              series?: string;
              facet?: string;
              values: number[];
            };
            const groups = new Map<string, HistogramGroup>();
            const allValues: number[] = [];
            for (const row of queryPayload.rows) {
              const value = toFiniteNumber(row[resolvedXIndex] ?? null);
              if (value === null) {
                continue;
              }
              const seriesValue =
                seriesIndex >= 0
                  ? toCategory((row[seriesIndex] as PrimitiveValue) ?? null)
                  : undefined;
              const facetValue =
                facetIndex >= 0
                  ? toCategory((row[facetIndex] as PrimitiveValue) ?? null)
                  : undefined;
              if (facetFilter && facetValue !== facetFilter) {
                continue;
              }
              allValues.push(value);
              const groupKey = `${facetValue ?? ""}\u0000${seriesValue ?? ""}`;
              const existing = groups.get(groupKey);
              if (existing) {
                existing.values.push(value);
              } else {
                groups.set(groupKey, {
                  series: seriesValue,
                  facet: facetValue,
                  values: [value]
                });
              }
            }
            if (allValues.length === 0 || groups.size === 0) {
              throw new Error("No numeric rows are available for this chart rerun.");
            }
            const requestedBins = Math.max(
              1,
              Math.min(200, Math.round(chartPayload.points.length || 20))
            );
            const minValue = Math.min(...allValues);
            const maxValue = Math.max(...allValues);
            if (!(maxValue > minValue)) {
              rawPoints = Array.from(groups.values()).map((group) => ({
                x: minValue,
                y: group.values.length,
                series: group.series,
                facet: group.facet
              }));
            } else {
              const binWidth = (maxValue - minValue) / requestedBins;
              for (const group of groups.values()) {
                const counts = Array.from({ length: requestedBins }, () => 0);
                for (const value of group.values) {
                  let binIndex = Math.floor((value - minValue) / binWidth);
                  if (binIndex >= requestedBins) {
                    binIndex = requestedBins - 1;
                  }
                  if (binIndex < 0) {
                    binIndex = 0;
                  }
                  counts[binIndex] += 1;
                }
                rawPoints.push(
                  ...counts.map((count, index) => ({
                    x: minValue + (index + 0.5) * binWidth,
                    y: count,
                    series: group.series,
                    facet: group.facet
                  }))
                );
              }
            }
          } else {
            for (const row of queryPayload.rows) {
              const y = toFiniteNumber(row[resolvedYIndex] ?? null);
              if (y === null) {
                continue;
              }
              const rawX = row[resolvedXIndex];
              const x =
                typeof rawX === "number" || typeof rawX === "string"
                  ? rawX
                  : rawX === null
                    ? "null"
                    : String(rawX);
              const seriesValue =
                seriesIndex >= 0
                  ? toCategory((row[seriesIndex] as PrimitiveValue) ?? null)
                  : undefined;
              const facetValue =
                facetIndex >= 0
                  ? toCategory((row[facetIndex] as PrimitiveValue) ?? null)
                  : undefined;
              if (facetFilter && facetValue !== facetFilter) {
                continue;
              }
              const point: ChartPoint = {
                x,
                y
              };
              if (seriesValue !== undefined) {
                point.series = seriesValue;
              }
              if (facetValue !== undefined) {
                point.facet = facetValue;
              }
              rawPoints.push(point);
            }
          }
          if (rawPoints.length === 0) {
            throw new Error("No rows were returned while rerunning this chart.");
          }

          const points = sampleEvenly(
            rawPoints,
            chartPayload.chartType === "histogram" ? rawPoints.length : 2000
          );
          const numericXPoints = points
            .map((point) => ({
              x: toFiniteNumber(point.x),
              y: point.y
            }))
            .filter((point): point is { x: number; y: number } => point.x !== null);
          const xIsNumericForAllPoints = numericXPoints.length === points.length;
          const bestFitLine =
            chartPayload.bestFitLine &&
            (chartPayload.chartType === "line" || chartPayload.chartType === "scatter")
              ? xIsNumericForAllPoints
                ? computeLinearBestFit(numericXPoints) ?? chartPayload.bestFitLine
                : chartPayload.bestFitLine
              : chartPayload.bestFitLine;
          payload = {
            ...chartPayload,
            bestFitLine:
              bestFitLine && "slope" in bestFitLine
                ? {
                    slope: bestFitLine.slope,
                    intercept: bestFitLine.intercept,
                    r2: bestFitLine.r2
                  }
                : bestFitLine,
            points
          };
        } else if (
          (block.type === "test" || block.type === "model") &&
          block.analysisRequest
        ) {
          if (block.analysisRequest.kind === "welch_t_test") {
            const response = await worker.sendLatest(`rerun_block_${block.id}`, {
              type: "RUN_WELCH_T_TEST",
              payload: {
                sql: runtimeSql,
                valueColumn: block.analysisRequest.valueColumn,
                groupColumn: block.analysisRequest.groupColumn,
                groupA: block.analysisRequest.groupA,
                groupB: block.analysisRequest.groupB,
                confidenceLevel: block.analysisRequest.confidenceLevel
              }
            });
            payload = asPayload<WelchTTestResult>(response);
          } else if (block.analysisRequest.kind === "pearson_correlation") {
            const response = await worker.sendLatest(`rerun_block_${block.id}`, {
              type: "RUN_PEARSON_CORRELATION",
              payload: {
                sql: runtimeSql,
                xColumn: block.analysisRequest.xColumn,
                yColumn: block.analysisRequest.yColumn,
                method: block.analysisRequest.method,
                confidenceLevel: block.analysisRequest.confidenceLevel
              }
            });
            payload = asPayload<PearsonCorrelationResult>(response);
          } else if (block.analysisRequest.kind === "chi_square_test") {
            const response = await worker.sendLatest(`rerun_block_${block.id}`, {
              type: "RUN_CHI_SQUARE_TEST",
              payload: {
                sql: runtimeSql,
                rowColumn: block.analysisRequest.rowColumn,
                columnColumn: block.analysisRequest.columnColumn
              }
            });
            payload = asPayload<ChiSquareTestResult>(response);
          } else {
            const response = await worker.sendLatest(`rerun_block_${block.id}`, {
              type: "RUN_OLS_REGRESSION",
              payload: {
                sql: runtimeSql,
                dependentColumn: block.analysisRequest.dependentColumn,
                independentColumns: block.analysisRequest.independentColumns,
                includeIntercept: block.analysisRequest.includeIntercept,
                oneHotEncodeCategorical:
                  block.analysisRequest.oneHotEncodeCategorical,
                maxDiagnosticPoints: OLS_DIAGNOSTIC_MAX_POINTS
              }
            });
            payload = asPayload<OLSRegressionResult>(response);
          }
        } else {
          dispatch({
            type: "SET_STATUS",
            statusText: "This notebook block cannot be rerun yet."
          });
          return;
        }

        dispatch({
          type: "UPDATE_NOTEBOOK_BLOCK",
          block: {
            ...block,
            createdAt: new Date().toISOString(),
            pipelineStateHash: hashRuntimeSql(runtimeSql),
            payload
          }
        });
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "notebook"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `Notebook block "${block.title}" rerun complete.`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Notebook rerun failed: ${String(error)}`
        });
      }
    },
    [
      buildRuntimeSqlForTarget,
      state.notebookBlocks,
      worker
    ]
  );

  const onTableChange = useCallback(
    (tableName: string) => {
      setActiveTablePreviewLimit(TABLE_PREVIEW_INITIAL_LIMIT);
      void refreshTables({
        activeTableName: tableName,
        activeLimit: TABLE_PREVIEW_INITIAL_LIMIT
      });
    },
    [refreshTables]
  );

  const onLoadMoreRows = useCallback(() => {
    if (!state.activeTableName) {
      return;
    }
    const nextLimit = activeTablePreviewLimit + TABLE_PREVIEW_INCREMENT;
    setActiveTablePreviewLimit(nextLimit);
    void refreshTables({
      activeTableName: state.activeTableName,
      activeLimit: nextLimit
    });
  }, [activeTablePreviewLimit, refreshTables, state.activeTableName]);

  const onSelectPipelineStep = useCallback(
    async (stepId: string) => {
      let baseTableName = state.selectedTransformTableName;
      let step = transformPipelineSteps.find((entry) => entry.id === stepId);
      let stepsForTable = transformPipelineSteps;
      if (!step) {
        for (const [tableName, steps] of Object.entries(state.pipelinesByTable)) {
          const candidate = steps.find((entry) => entry.id === stepId);
          if (candidate) {
            baseTableName = tableName;
            step = candidate;
            stepsForTable = steps;
            break;
          }
        }
      }
      if (!step || !baseTableName) {
        return;
      }
      if (baseTableName !== state.selectedTransformTableName) {
        dispatch({
          type: "SET_SELECTED_TRANSFORM_TABLE",
          tableName: baseTableName
        });
      }

      dispatch({ type: "SET_ACTIVE_PIPELINE_STEP", stepId });
      dispatch({ type: "SET_ACTIVE_QUERY", queryId: null });
      dispatch({ type: "SET_DATA_TAB", tab: "transforms" });
      dispatch({
        type: "SET_SQL",
        sql: step.type === "SQLTransformStep" ? step.params.sql : ""
      });

      const stepIndex = stepsForTable.findIndex((entry) => entry.id === step.id);
      if (stepIndex < 0) {
        dispatch({
          type: "SET_STATUS",
          statusText: `Unable to locate transform snapshot for ${step.name}.`
        });
        return;
      }
      const stepTarget = buildPipelineStepTarget(
        baseTableName,
        stepsForTable,
        stepIndex
      );
      dispatch({
        type: "SET_QUERY_TARGET",
        target: stepTarget
      });
      dispatch({
        type: "SET_STATUS",
        statusText: `Loading preview for ${step.name}...`
      });

      try {
        const runtimeSql = buildRuntimeSqlForTarget("SELECT * FROM source", stepTarget);
        const response = await worker.sendLatest(`select_step_${step.id}`, {
          type: "RUN_SQL",
          payload: {
            sql: runtimeSql,
            limit: 250
          }
        });
        const payload = asPayload<{
          columns: string[];
          rows: Array<Array<string | number | boolean | null>>;
          rowCount: number;
        }>(response);
        dispatch({
          type: "SET_QUERY_RESULT",
          result: {
            ...payload,
            querySql: "SELECT * FROM source",
            queryTarget: stepTarget
          }
        });
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "notebook"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `${step.name} preview loaded (${payload.rowCount.toLocaleString()} rows).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Unable to preview pipeline step: ${String(error)}`
        });
      }
    },
    [
      buildRuntimeSqlForTarget,
      state.pipelinesByTable,
      state.selectedTransformTableName,
      transformPipelineSteps,
      worker
    ]
  );

  const onSelectSavedQuery = useCallback(
    async (queryId: string) => {
      const query = state.savedQueries.find((entry) => entry.id === queryId);
      if (!query) {
        return;
      }
      const version = getActiveVersion(query);
      dispatch({ type: "SET_ACTIVE_PIPELINE_STEP", stepId: null });
      dispatch({ type: "SET_ACTIVE_QUERY", queryId });
      dispatch({ type: "SET_SQL", sql: version.sql });
      dispatch({ type: "SET_QUERY_TARGET", target: version.target });
      dispatch({ type: "SET_DATA_TAB", tab: "queries" });
      dispatch({
        type: "SET_STATUS",
        statusText: `Running query ${query.name}...`
      });

      try {
        const runtimeSql = buildRuntimeSqlForTarget(version.sql, version.target);
        const response = await worker.sendLatest(`select_query_${queryId}`, {
          type: "RUN_SQL",
          payload: {
            sql: runtimeSql,
            limit: 250
          }
        });
        const payload = asPayload<{
          columns: string[];
          rows: Array<Array<string | number | boolean | null>>;
          rowCount: number;
        }>(response);
        dispatch({
          type: "SET_QUERY_RESULT",
          result: {
            ...payload,
            querySql: version.sql,
            queryTarget: version.target
          }
        });
        dispatch({
          type: "SET_RESULTS_TAB",
          tab: "notebook"
        });
        dispatch({
          type: "SET_STATUS",
          statusText: `Query ${query.name} loaded (${payload.rowCount.toLocaleString()} rows).`
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cancelled by newer request")) {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          statusText: `Unable to run saved query: ${String(error)}`
        });
      }
    },
    [
      buildRuntimeSqlForTarget,
      state.savedQueries,
      worker
    ]
  );

  const onLoadMoreTableRows = useCallback(
    async (input: {
      querySql: string;
      queryTarget: QueryTargetRef;
      offset: number;
      limit: number;
    }) => {
      const runtimeSql = buildRuntimeSqlForTarget(input.querySql, input.queryTarget);
      const response = await worker.send({
        type: "RUN_SQL",
        payload: {
          sql: runtimeSql,
          offset: input.offset,
          limit: input.limit
        }
      });
      return asPayload<{
        columns: string[];
        rows: Array<Array<string | number | boolean | null>>;
        rowCount: number;
      }>(response);
    },
    [buildRuntimeSqlForTarget, worker]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void persistState(state);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [
    state.dataTab,
    state.resultsTab,
    state.storageMode,
    state.mergeMode,
    state.hasHeader,
    state.delimiter,
    state.sources,
    state.selectedTransformTableName,
    state.pipelinesByTable,
    state.activePipelineStepIdByTable,
    state.pipelineSteps,
    state.activePipelineStepId,
    state.activeQueryTarget,
    state.pendingImpact,
    state.sqlEditorText,
    state.savedQueries,
    state.activeQueryId,
    state.notebookBlocks,
    state.columnEditsByTable
  ]);

  return (
    <div className="app-shell">
      <div className="top-stack">
        <header className="top-bar">
          <div>
            <h1>StatsFish</h1>
            <p className="subheading">Local-first statistical analysis in the browser</p>
          </div>
          <div className="toolbar">
            <button type="button" className="btn btn-secondary" onClick={onLoadExample}>
              Load Example
            </button>
            <button type="button" className="btn btn-secondary" onClick={onExportRecipe}>
              Export Recipe
            </button>
            <button type="button" className="btn btn-secondary" onClick={onPickRecipeFile}>
              Import Recipe
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                void refreshTables();
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-ghost danger"
              onClick={onRequestDeleteAllData}
            >
              Delete All Data
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden-input"
              onChange={(event) => {
                void onFileInput(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={recipeInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden-input"
              onChange={(event) => {
                void onImportRecipeFile(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </header>

        {state.storageMode === "idb_only_fallback" && (
          <section className="storage-mode-banner">
            OPFS is not available in this browser. Using IndexedDB-only storage mode.
          </section>
        )}
      </div>

      <main className="panes">
        <DataWindow
          dataTab={state.dataTab}
          onDataTabChange={(tab) => dispatch({ type: "SET_DATA_TAB", tab })}
          tables={state.tables}
          activeTableName={state.activeTableName}
          onTableChange={onTableChange}
          onImportCsv={onPickFiles}
          onRenameTable={(nextName) => {
            void onRenameTable(nextName);
          }}
          onDeleteTable={onRequestDeleteDataset}
          onUpdateColumn={(input) => {
            void onUpdateColumn(input);
          }}
          onLoadMoreRows={onLoadMoreRows}
          canLoadMoreRows={
            !!previewTable && previewTable.rows.length < previewTable.rowCount
          }
          loadedRowCount={previewTable?.rows.length ?? 0}
          transformTableName={state.selectedTransformTableName}
          onTransformTableChange={(tableName) =>
            dispatch({
              type: "SET_SELECTED_TRANSFORM_TABLE",
              tableName
            })
          }
          pipelineSteps={transformPipelineSteps}
          activePipelineStepId={
            state.selectedTransformTableName
              ? state.activePipelineStepIdByTable[state.selectedTransformTableName] ?? null
              : null
          }
          onCreateTransform={onCreateTransformFromDataWindow}
          onRenamePipelineStep={onRenamePipelineStep}
          onSelectPipelineStep={(stepId) => {
            void onSelectPipelineStep(stepId);
          }}
          onTogglePipelineStep={onTogglePipelineStep}
          onMovePipelineStep={onMovePipelineStep}
          onRemovePipelineStep={onRemovePipelineStep}
          savedQueries={state.savedQueries}
          activeQueryId={state.activeQueryId}
          onCreateQuery={onCreateQueryFromDataWindow}
          onRenameQuery={onRenameSavedQuery}
          onPruneQueryVersions={onRequestPruneQueryVersions}
          onSelectQuery={(queryId) => {
            void onSelectSavedQuery(queryId);
          }}
        />
        <WorkWindow
          sql={state.sqlEditorText}
          onSqlChange={onSqlChange}
          transformTableName={state.selectedTransformTableName}
          queryTarget={state.activeQueryTarget}
          targetOptions={targetOptions}
          openNewQuerySignal={openNewQuerySignal}
          openNewTransformSignal={openNewTransformSignal}
          onTargetChange={onTargetChange}
          onNewQuery={onNewQuery}
          availableColumns={availableColumns}
          statisticsAvailableColumns={statisticsAvailableColumns}
          tableColumnOptions={tableColumnOptions}
          onSaveFilterStep={onSaveFilterStep}
          onSaveSelectColumnsStep={onSaveSelectColumnsStep}
          onSaveMutateColumnStep={onSaveMutateColumnStep}
          onSaveRemoveDuplicatesStep={onSaveRemoveDuplicatesStep}
          onSaveMissingValuesStep={onSaveMissingValuesStep}
          onSaveSortRowsStep={onSaveSortRowsStep}
          onSaveCastColumnStep={onSaveCastColumnStep}
          onSaveScaleNumericStep={onSaveScaleNumericStep}
          onSaveDummyVariablesStep={onSaveDummyVariablesStep}
          onSaveGroupAggregateStep={onSaveGroupAggregateStep}
          onSaveJoinStep={onSaveJoinStep}
          onSavePivotStep={(input) => {
            void onSavePivotStep(input);
          }}
          onAddSqlStep={onAddSqlStep}
          onUpdatePipelineSqlStep={onUpdatePipelineSqlStep}
          onRunPipeline={onRunPipeline}
          onRunWelchTTest={onRunWelchTTest}
          onRunPearsonCorrelation={onRunPearsonCorrelation}
          onRunChiSquareTest={onRunChiSquareTest}
          onRunOLSRegression={onRunOLSRegression}
          onCreateChart={(input) => {
            void onCreateChart(input);
          }}
          activePipelineStep={activePipelineStep}
          savedQueries={state.savedQueries}
          activeQueryId={state.activeQueryId}
          statusText={state.statusText}
          onRunSQL={onRunSQL}
          onSaveQuery={onSaveQuery}
        />
        <ResultsWindow
          tab={state.resultsTab}
          onTabChange={(tab) => dispatch({ type: "SET_RESULTS_TAB", tab })}
          queryResult={state.queryResult}
          notebookBlocks={state.notebookBlocks}
          onRerunNotebookBlock={onRerunNotebookBlock}
          onDeleteNotebookBlock={onDeleteNotebookBlock}
          onLoadMoreTableRows={(input) => onLoadMoreTableRows(input)}
          profile={state.profile}
          describeOptions={describeTargetOptions}
          onDescribe={(target) => {
            void onDescribeTarget(target);
          }}
        />
      </main>

      <footer className="app-footer">
        <span className="hint-line">{state.statusText}</span>
        <span className="hint-line">
          Data preview: {previewTable?.tableName ?? "none"} | Rows:{" "}
          {previewTable?.rowCount.toLocaleString() ?? "0"}
        </span>
        <span className="hint-line">
          Storage mode:{" "}
          {state.storageMode === "idb_plus_opfs"
            ? "IndexedDB + OPFS"
            : "IndexedDB fallback"}
        </span>
      </footer>
      {state.pendingImpact && (
        <DependencyImpactModal
          pendingImpact={state.pendingImpact}
          onDecisionChange={(queryId, decision) =>
            dispatch({ type: "SET_IMPACT_DECISION", queryId, decision })
          }
          onApply={onApplyImpact}
          onDismiss={onDismissImpact}
        />
      )}
      <ImportCsvModal
        open={isImportDialogOpen}
        files={importDialogFiles}
        existingTableNames={state.tables.map((table) => table.tableName)}
        initialMergeMode={state.mergeMode}
        initialDelimiter={state.delimiter}
        initialHasHeader={state.hasHeader}
        onCancel={onCancelImportDialog}
        onConfirm={(input) => {
          void onConfirmImportDialog(input);
        }}
      />
      <ConfirmActionModal
        open={!!importCapFallback}
        title="Import Limit Reached"
        message={
          importCapFallback
            ? `${importCapFallback.message} Import a sampled table instead (${IMPORT_SAMPLE_ROW_FALLBACK.toLocaleString()} rows per file max)?`
            : ""
        }
        confirmLabel={`Import ${IMPORT_SAMPLE_ROW_FALLBACK.toLocaleString()}-Row Sample`}
        onCancel={onCancelImportCapFallback}
        onConfirm={onConfirmImportCapFallback}
      />
      {pruneQueryDialog && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="impact-modal confirm-modal prune-query-modal">
            <h3>Prune Query Versions</h3>
            <div className="hint-line">
              Select old versions of "{pruneQueryDialog.queryName}" to delete.
            </div>
            <div className="prune-version-list">
              {pruneQueryDialog.removableVersions.map((version) => {
                const isSelected = pruneQueryDialog.selectedVersionIds.includes(
                  version.versionId
                );
                return (
                  <label
                    key={version.versionId}
                    className={
                      isSelected
                        ? "prune-version-item selected"
                        : "prune-version-item"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onTogglePruneVersionSelection(version.versionId)}
                    />
                    <span>
                      <strong>{version.versionLabel}</strong> |{" "}
                      {new Date(version.createdAt).toLocaleString()} | {version.targetLabel}
                      <br />
                      <span className="hint-line prune-sql-preview">
                        {version.sql.length > 180
                          ? `${version.sql.slice(0, 177)}...`
                          : version.sql}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="hint-line">
              Selected: {pruneQueryDialog.selectedVersionIds.length.toLocaleString()} of{" "}
              {pruneQueryDialog.removableVersions.length.toLocaleString()} old versions.
            </div>
            <div className="inline-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onCancelPruneQueryDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-ghost danger"
                onClick={onConfirmPruneQueryDialog}
              >
                Prune Selected
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmActionModal
        open={!!deleteDialog}
        title={
          deleteDialog?.kind === "dataset"
            ? "Delete Dataset"
            : "Delete All Project Data"
        }
        message={
          deleteDialog?.kind === "dataset"
            ? `Delete dataset "${deleteDialog.tableName}"? This cannot be undone.`
            : "Delete all datasets, queries, transforms, and notebook blocks? This cannot be undone."
        }
        confirmLabel={deleteDialog?.kind === "dataset" ? "Delete Dataset" : "Delete All"}
        onCancel={onCancelDeleteDialog}
        onConfirm={() => {
          void onConfirmDeleteDialog();
        }}
      />
    </div>
  );
}
