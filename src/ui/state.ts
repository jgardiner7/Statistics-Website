import type {
  ColumnSchemaEdit,
  ImpactDecision,
  MergeMode,
  NotebookBlock,
  PendingImpactUpdate,
  PipelineStep,
  PrimitiveValue,
  QueryTargetRef,
  SavedQuery,
  SourceFileMetadata,
  TablePreview,
  TableProfile
} from "../shared/types";

export type DataTab = "data" | "transforms" | "queries";
export type ResultsTab = "notebook" | "describe";
export type StorageMode = "idb_plus_opfs" | "idb_only_fallback";

export interface QueryResult {
  columns: string[];
  rows: PrimitiveValue[][];
  rowCount: number;
  querySql?: string;
  queryTarget?: QueryTargetRef;
}

export interface UIState {
  ready: boolean;
  statusText: string;
  dataTab: DataTab;
  resultsTab: ResultsTab;
  storageMode: StorageMode;
  tables: TablePreview[];
  activeTableName: string | null;
  selectedTransformTableName: string | null;
  mergeMode: MergeMode;
  hasHeader: boolean;
  delimiter: string;
  sources: SourceFileMetadata[];
  pipelinesByTable: Record<string, PipelineStep[]>;
  activePipelineStepIdByTable: Record<string, string | null>;
  pipelineSteps: PipelineStep[];
  activePipelineStepId: string | null;
  activeQueryTarget: QueryTargetRef | null;
  pendingImpact: PendingImpactUpdate | null;
  sqlEditorText: string;
  savedQueries: SavedQuery[];
  activeQueryId: string | null;
  queryResult: QueryResult | null;
  notebookBlocks: NotebookBlock[];
  profile: TableProfile | null;
  columnEditsByTable: Record<string, ColumnSchemaEdit[]>;
}

export const initialState: UIState = {
  ready: false,
  statusText: "Initializing worker...",
  dataTab: "data",
  resultsTab: "notebook",
  storageMode: "idb_only_fallback",
  tables: [],
  activeTableName: null,
  selectedTransformTableName: null,
  mergeMode: "same_table_union_by_name",
  hasHeader: true,
  delimiter: ",",
  sources: [],
  pipelinesByTable: {},
  activePipelineStepIdByTable: {},
  pipelineSteps: [],
  activePipelineStepId: null,
  activeQueryTarget: null,
  pendingImpact: null,
  sqlEditorText: "",
  savedQueries: [],
  activeQueryId: null,
  queryResult: null,
  notebookBlocks: [],
  profile: null,
  columnEditsByTable: {}
};

export type UIAction =
  | { type: "HYDRATE"; patch: Partial<UIState> }
  | { type: "SET_READY"; ready: boolean; statusText?: string }
  | { type: "SET_STATUS"; statusText: string }
  | { type: "SET_DATA_TAB"; tab: DataTab }
  | { type: "SET_RESULTS_TAB"; tab: ResultsTab }
  | { type: "SET_STORAGE_MODE"; storageMode: StorageMode }
  | { type: "SET_TABLES"; tables: TablePreview[]; activeTableName?: string | null }
  | { type: "SET_ACTIVE_TABLE"; tableName: string | null }
  | { type: "SET_SELECTED_TRANSFORM_TABLE"; tableName: string | null }
  | { type: "SET_IMPORT_OPTIONS"; mergeMode: MergeMode; hasHeader: boolean; delimiter: string }
  | { type: "ADD_SOURCES"; sources: SourceFileMetadata[] }
  | { type: "SET_PIPELINE_STEPS"; steps: PipelineStep[] }
  | {
      type: "ADD_PIPELINE_STEP";
      step: PipelineStep;
    }
  | { type: "UPDATE_PIPELINE_STEP"; step: PipelineStep }
  | { type: "TOGGLE_PIPELINE_STEP_ENABLED"; stepId: string }
  | { type: "MOVE_PIPELINE_STEP"; stepId: string; direction: "up" | "down" }
  | { type: "REMOVE_PIPELINE_STEP"; stepId: string }
  | { type: "SET_ACTIVE_PIPELINE_STEP"; stepId: string | null }
  | { type: "SET_SQL"; sql: string }
  | { type: "SET_QUERY_TARGET"; target: QueryTargetRef | null }
  | { type: "SET_PENDING_IMPACT"; pendingImpact: PendingImpactUpdate | null }
  | {
      type: "SET_IMPACT_DECISION";
      queryId: string;
      decision: ImpactDecision;
    }
  | { type: "SET_QUERY_RESULT"; result: QueryResult | null }
  | { type: "SET_PROFILE"; profile: TableProfile | null }
  | { type: "SET_SAVED_QUERIES"; savedQueries: SavedQuery[] }
  | { type: "SET_ACTIVE_QUERY"; queryId: string | null }
  | { type: "ADD_NOTEBOOK_BLOCK"; block: NotebookBlock }
  | { type: "UPDATE_NOTEBOOK_BLOCK"; block: NotebookBlock }
  | { type: "REMOVE_NOTEBOOK_BLOCK"; blockId: string };

function resolveActivePipelineStepId(
  steps: PipelineStep[],
  activeStepId: string | null
): string | null {
  if (!steps.length) {
    return null;
  }
  if (activeStepId && steps.some((step) => step.id === activeStepId)) {
    return activeStepId;
  }
  return steps[0].id;
}

function resolveSelectedTable(
  tables: TablePreview[],
  requestedTableName: string | null | undefined
): string | null {
  if (tables.length === 0) {
    return typeof requestedTableName === "string" ? requestedTableName : null;
  }
  if (
    requestedTableName &&
    tables.some((table) => table.tableName === requestedTableName)
  ) {
    return requestedTableName;
  }
  return tables[0]?.tableName ?? null;
}

function normalizePipelineState(input: UIState): UIState {
  const activeTableName = resolveSelectedTable(input.tables, input.activeTableName);
  const selectedTransformTableName = resolveSelectedTable(
    input.tables,
    input.selectedTransformTableName ?? activeTableName
  );
  const tableNames = new Set(input.tables.map((table) => table.tableName));
  const legacySteps = Array.isArray(input.pipelineSteps) ? input.pipelineSteps : [];
  const hasPerTablePipelineState =
    Object.keys(input.pipelinesByTable ?? {}).length > 0 ||
    Object.keys(input.activePipelineStepIdByTable ?? {}).length > 0;
  const pipelinesByTable: Record<string, PipelineStep[]> = {
    ...(input.pipelinesByTable ?? {})
  };

  for (const tableName of tableNames) {
    if (!Array.isArray(pipelinesByTable[tableName])) {
      pipelinesByTable[tableName] = [];
    }
  }
  if (
    !hasPerTablePipelineState &&
    selectedTransformTableName &&
    legacySteps.length > 0 &&
    (pipelinesByTable[selectedTransformTableName] ?? []).length === 0
  ) {
    pipelinesByTable[selectedTransformTableName] = legacySteps;
  }

  const activePipelineStepIdByTable: Record<string, string | null> = {
    ...(input.activePipelineStepIdByTable ?? {})
  };
  for (const [tableName, steps] of Object.entries(pipelinesByTable)) {
    const requestedActiveStepId =
      input.activePipelineStepIdByTable?.[tableName] ??
      (selectedTransformTableName && tableName === selectedTransformTableName
        ? input.activePipelineStepId
        : null);
    activePipelineStepIdByTable[tableName] = resolveActivePipelineStepId(
      steps,
      requestedActiveStepId ?? null
    );
  }

  const pipelineSteps = selectedTransformTableName
    ? pipelinesByTable[selectedTransformTableName] ?? []
    : [];
  const activePipelineStepId = selectedTransformTableName
    ? activePipelineStepIdByTable[selectedTransformTableName] ?? null
    : null;

  return {
    ...input,
    activeTableName,
    selectedTransformTableName,
    pipelinesByTable,
    activePipelineStepIdByTable,
    pipelineSteps,
    activePipelineStepId
  };
}

function updateSelectedTransformPipeline(
  state: UIState,
  updater: (steps: PipelineStep[]) => PipelineStep[],
  nextActiveStepId?: string | null
): UIState {
  const tableName = state.selectedTransformTableName;
  if (!tableName) {
    return state;
  }
  const currentSteps = state.pipelinesByTable[tableName] ?? [];
  const nextSteps = updater(currentSteps);
  const resolvedActiveStepId = resolveActivePipelineStepId(
    nextSteps,
    nextActiveStepId ?? state.activePipelineStepIdByTable[tableName] ?? null
  );
  return {
    ...state,
    pipelinesByTable: {
      ...state.pipelinesByTable,
      [tableName]: nextSteps
    },
    activePipelineStepIdByTable: {
      ...state.activePipelineStepIdByTable,
      [tableName]: resolvedActiveStepId
    },
    pipelineSteps: nextSteps,
    activePipelineStepId: resolvedActiveStepId
  };
}

export function reducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "HYDRATE":
      return normalizePipelineState({
        ...state,
        ...action.patch
      });
    case "SET_READY":
      return {
        ...state,
        ready: action.ready,
        statusText: action.statusText ?? state.statusText
      };
    case "SET_STATUS":
      return {
        ...state,
        statusText: action.statusText
      };
    case "SET_DATA_TAB":
      return {
        ...state,
        dataTab: action.tab
      };
    case "SET_RESULTS_TAB":
      return {
        ...state,
        resultsTab: action.tab
      };
    case "SET_STORAGE_MODE":
      return {
        ...state,
        storageMode: action.storageMode
      };
    case "SET_TABLES":
      {
        return normalizePipelineState({
          ...state,
          tables: action.tables,
          activeTableName: action.activeTableName ?? state.activeTableName
        });
      }
    case "SET_ACTIVE_TABLE":
      return normalizePipelineState({
        ...state,
        activeTableName: action.tableName
      });
    case "SET_SELECTED_TRANSFORM_TABLE":
      return normalizePipelineState({
        ...state,
        selectedTransformTableName: action.tableName
      });
    case "SET_IMPORT_OPTIONS":
      return {
        ...state,
        mergeMode: action.mergeMode,
        hasHeader: action.hasHeader,
        delimiter: action.delimiter
      };
    case "ADD_SOURCES":
      return {
        ...state,
        sources: [...state.sources, ...action.sources]
      };
    case "SET_PIPELINE_STEPS":
      return updateSelectedTransformPipeline(
        state,
        () => action.steps,
        state.activePipelineStepId
      );
    case "ADD_PIPELINE_STEP":
      return updateSelectedTransformPipeline(
        state,
        (steps) => [...steps, action.step],
        action.step.id
      );
    case "UPDATE_PIPELINE_STEP":
      return updateSelectedTransformPipeline(state, (steps) =>
        steps.map((step) => (step.id === action.step.id ? action.step : step))
      );
    case "TOGGLE_PIPELINE_STEP_ENABLED":
      return updateSelectedTransformPipeline(state, (steps) =>
        steps.map((step) =>
          step.id === action.stepId ? { ...step, enabled: !step.enabled } : step
        )
      );
    case "MOVE_PIPELINE_STEP": {
      const currentIndex = state.pipelineSteps.findIndex(
        (step) => step.id === action.stepId
      );
      if (currentIndex < 0) {
        return state;
      }
      const offset = action.direction === "up" ? -1 : 1;
      const nextIndex = currentIndex + offset;
      if (nextIndex < 0 || nextIndex >= state.pipelineSteps.length) {
        return state;
      }
      return updateSelectedTransformPipeline(state, (steps) => {
        const reordered = [...steps];
        const currentStep = reordered[currentIndex];
        reordered[currentIndex] = reordered[nextIndex];
        reordered[nextIndex] = currentStep;
        return reordered;
      });
    }
    case "REMOVE_PIPELINE_STEP": {
      const nextSteps = state.pipelineSteps.filter((step) => step.id !== action.stepId);
      if (nextSteps.length === state.pipelineSteps.length) {
        return state;
      }
      return updateSelectedTransformPipeline(
        state,
        () => nextSteps,
        state.activePipelineStepId === action.stepId ? null : state.activePipelineStepId
      );
    }
    case "SET_ACTIVE_PIPELINE_STEP": {
      const tableName = state.selectedTransformTableName;
      if (!tableName) {
        return state;
      }
      return {
        ...state,
        activePipelineStepId: action.stepId,
        activePipelineStepIdByTable: {
          ...state.activePipelineStepIdByTable,
          [tableName]: action.stepId
        }
      };
    }
    case "SET_SQL":
      return {
        ...state,
        sqlEditorText: action.sql
      };
    case "SET_QUERY_TARGET":
      return {
        ...state,
        activeQueryTarget: action.target
      };
    case "SET_PENDING_IMPACT":
      return {
        ...state,
        pendingImpact: action.pendingImpact
      };
    case "SET_IMPACT_DECISION": {
      if (!state.pendingImpact) {
        return state;
      }
      return {
        ...state,
        pendingImpact: {
          ...state.pendingImpact,
          items: state.pendingImpact.items.map((item) =>
            item.queryId === action.queryId
              ? { ...item, decision: action.decision }
              : item
          )
        }
      };
    }
    case "SET_QUERY_RESULT":
      return {
        ...state,
        queryResult: action.result
      };
    case "SET_PROFILE":
      return {
        ...state,
        profile: action.profile
      };
    case "SET_SAVED_QUERIES":
      return {
        ...state,
        savedQueries: action.savedQueries
      };
    case "SET_ACTIVE_QUERY":
      return {
        ...state,
        activeQueryId: action.queryId
      };
    case "ADD_NOTEBOOK_BLOCK":
      return {
        ...state,
        notebookBlocks: [action.block, ...state.notebookBlocks]
      };
    case "UPDATE_NOTEBOOK_BLOCK":
      return {
        ...state,
        notebookBlocks: state.notebookBlocks.map((block) =>
          block.id === action.block.id ? action.block : block
        )
      };
    case "REMOVE_NOTEBOOK_BLOCK":
      return {
        ...state,
        notebookBlocks: state.notebookBlocks.filter(
          (block) => block.id !== action.blockId
        )
      };
    default: {
      return state;
    }
  }
}
