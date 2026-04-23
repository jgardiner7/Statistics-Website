export type MergeMode =
  | "separate_tables"
  | "same_table_union_by_name"
  | "same_table_exact_schema"
  | "same_table_by_position";

export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

export type PrimitiveValue = string | number | boolean | null;
export type CorrelationMethod = "pearson" | "kendall" | "spearman";

export interface TablePreview {
  tableName: string;
  rowCount: number;
  columns: ColumnInfo[];
  rows: PrimitiveValue[][];
}

export interface ColumnProfile {
  column: string;
  type: string;
  count: number;
  nullCount: number;
  distinctCount: number;
  topValues?: Array<{
    value: PrimitiveValue;
    count: number;
  }>;
  mean?: number;
  std?: number;
  q25?: number;
  q50?: number;
  q75?: number;
  min?: PrimitiveValue;
  max?: PrimitiveValue;
}

export interface TableProfile {
  tableName: string;
  rowCount: number;
  columns: ColumnProfile[];
}

export type StatisticalTestRequest =
  | {
      kind: "welch_t_test";
      valueColumn: string;
      groupColumn: string;
      groupA: string;
      groupB: string;
      confidenceLevel?: number;
    }
  | {
      kind: "pearson_correlation";
      xColumn: string;
      yColumn: string;
      method?: CorrelationMethod;
      confidenceLevel?: number;
    }
  | {
      kind: "chi_square_test";
      rowColumn: string;
      columnColumn: string;
    }
  | {
      kind: "ols_regression";
      dependentColumn: string;
      independentColumns: string[];
      includeIntercept?: boolean;
      oneHotEncodeCategorical?: boolean;
    };

export interface CompleteCaseSummary {
  totalRows: number;
  effectiveSampleSize: number;
  droppedRows: number;
  droppedNullRows: number;
  droppedInvalidRows: number;
  droppedOutOfGroupRows?: number;
}

export interface WelchTTestResult {
  kind: "welch_t_test";
  valueColumn: string;
  groupColumn: string;
  groupA: string;
  groupB: string;
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
  completeCases: CompleteCaseSummary;
}

export interface PearsonCorrelationResult {
  kind: "pearson_correlation";
  method: CorrelationMethod;
  xColumn: string;
  yColumn: string;
  sampleSize: number;
  correlation: number;
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  confidenceLevel: number;
  ciLower: number;
  ciUpper: number;
  completeCases: CompleteCaseSummary;
}

export interface ChiSquareTestResult {
  kind: "chi_square_test";
  rowColumn: string;
  columnColumn: string;
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
  completeCases: CompleteCaseSummary;
}

export type StatisticalTestResult =
  | WelchTTestResult
  | PearsonCorrelationResult
  | ChiSquareTestResult
  | OLSRegressionResult;

export interface OLSCoefficient {
  term: string;
  estimate: number;
  standardError: number;
  tStatistic: number;
  pValue: number;
}

export interface ResidualSummary {
  mean: number;
  std: number;
  min: number;
  q25: number;
  q50: number;
  q75: number;
  max: number;
  rmse: number;
  mae: number;
}

export interface ResidualDiagnosticPoint {
  fitted: number;
  residual: number;
}

export interface OLSRegressionResult {
  kind: "ols_regression";
  dependentColumn: string;
  independentColumns: string[];
  includeIntercept: boolean;
  oneHotEncodeCategorical: boolean;
  droppedCategoryByColumn: Record<string, string>;
  coefficients: OLSCoefficient[];
  r2: number;
  adjustedR2: number;
  n: number;
  residualSummary: ResidualSummary;
  residualsVsFitted: {
    sampled: boolean;
    totalPoints: number;
    points: ResidualDiagnosticPoint[];
  };
  qqPlot?: {
    sampled: boolean;
    totalPoints: number;
    points: Array<{
      theoreticalQuantile: number;
      standardizedResidual: number;
    }>;
  };
  leverageVsResidual?: {
    sampled: boolean;
    totalPoints: number;
    points: Array<{
      leverage: number;
      standardizedResidual: number;
      cooksDistance: number;
    }>;
  };
  topInfluencePoints?: Array<{
    rowIndex: number;
    leverage: number;
    standardizedResidual: number;
    cooksDistance: number;
  }>;
  completeCases: CompleteCaseSummary;
}

export type QueryTargetRef =
  | {
      kind: "table";
      tableName: string;
    }
  | {
      kind: "pipeline_step";
      stepId: string;
      stepName: string;
      baseTableName: string;
      pipelineSnapshot?: PipelineStep[];
    }
  | {
      kind: "query_version";
      queryId: string;
      queryName: string;
      versionId: string;
    };

export interface SavedQueryVersion {
  versionId: string;
  sql: string;
  target: QueryTargetRef;
  dependsOnVersionIds: string[];
  createdAt: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  activeVersionId: string;
  versions: SavedQueryVersion[];
  createdAt: string;
}

export type ImpactDecision = "adopt_new" | "keep_pinned" | "fork_dependent";

export interface ImpactedQueryDecision {
  queryId: string;
  queryName: string;
  fromVersionId: string;
  depth: number;
  decision: ImpactDecision;
}

export interface PendingImpactUpdate {
  editedQueryId: string;
  editedQueryName: string;
  oldVersionId: string;
  newVersionId: string;
  items: ImpactedQueryDecision[];
}

export interface NotebookBlock {
  id: string;
  title: string;
  type: "table" | "chart" | "test" | "model" | "text";
  createdAt: string;
  upstreamVersionId: string;
  pipelineStateHash?: string;
  querySql?: string;
  queryTarget?: QueryTargetRef;
  analysisRequest?: StatisticalTestRequest;
  payload: unknown;
}

export interface SourceFileMetadata {
  id: string;
  name: string;
  sizeBytes: number;
  sha256?: string;
  hasHeader: boolean;
  delimiter: string;
}

export interface ColumnSchemaEdit {
  id: string;
  tableName: string;
  fromColumnName: string;
  toColumnName: string;
  fromType: string;
  toType: string;
  fromNullable?: boolean;
  toNullable?: boolean;
  appliedAt: string;
}

export type NotebookChartType = "bar" | "line" | "scatter" | "histogram";

export interface NotebookChartDatum {
  x: string | number;
  y: number;
  series?: string;
  facet?: string;
}

export interface NotebookChartPayload {
  kind: "chart_v1";
  chartType: NotebookChartType;
  title?: string;
  xColumn: string;
  yColumn: string;
  seriesColumn?: string;
  facetColumn?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  autoRange?: boolean;
  xRange?: {
    min?: number;
    max?: number;
  } | null;
  yRange?: {
    min?: number;
    max?: number;
  } | null;
  bestFitLine?: {
    slope: number;
    intercept: number;
    r2?: number;
  } | null;
  points: NotebookChartDatum[];
}

export interface PipelineStepBase {
  id: string;
  name: string;
  enabled: boolean;
}

export interface FilterStep extends PipelineStepBase {
  type: "FilterStep";
  params: {
    column: string;
    operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains";
    value: string;
  };
}

export interface SelectColumnsStep extends PipelineStepBase {
  type: "SelectColumnsStep";
  params: {
    columns: string[];
  };
}

export interface MutateColumnStep extends PipelineStepBase {
  type: "MutateColumnStep";
  params: {
    expression: string;
    outputColumn: string;
  };
}

export interface RemoveDuplicatesStep extends PipelineStepBase {
  type: "RemoveDuplicatesStep";
  params: {
    columns: string[];
  };
}

export interface MissingValuesStep extends PipelineStepBase {
  type: "MissingValuesStep";
  params: {
    mode: "drop" | "fill";
    columns: string[];
    fillValue?: string;
  };
}

export interface SortRowsStep extends PipelineStepBase {
  type: "SortRowsStep";
  params: {
    column: string;
    direction: "asc" | "desc";
    nulls: "first" | "last";
  };
}

export interface CastColumnStep extends PipelineStepBase {
  type: "CastColumnStep";
  params: {
    column: string;
    targetType: string;
    outputColumn?: string;
    dateFormat?: string;
  };
}

export interface ScaleNumericStep extends PipelineStepBase {
  type: "ScaleNumericStep";
  params: {
    column: string;
    method: "zscore" | "minmax";
    outputColumn: string;
  };
}

export interface DummyVariablesStep extends PipelineStepBase {
  type: "DummyVariablesStep";
  params: {
    sourceColumn: string;
    categories: string[];
    dropCategory?: string | null;
    prefix?: string;
  };
}

export interface SQLTransformStep extends PipelineStepBase {
  type: "SQLTransformStep";
  params: {
    sql: string;
  };
}

export interface GroupAggregateStep extends PipelineStepBase {
  type: "GroupAggregateStep";
  params: {
    groupBy: string[];
    aggregates: Array<{
      expression: string;
      alias: string;
    }>;
  };
}

export interface JoinStep extends PipelineStepBase {
  type: "JoinStep";
  params: {
    rightTable: string;
    joinType: "inner" | "left" | "right" | "full";
    conditions: Array<{
      leftColumn: string;
      operator: "=" | "!=" | ">" | "<" | ">=" | "<=";
      rightColumn: string;
    }>;
  };
}

export interface PivotStep extends PipelineStepBase {
  type: "PivotStep";
  params: {
    indexColumns: string[];
    pivotColumn: string;
    valueColumn: string;
    aggregate: "sum" | "avg" | "min" | "max" | "count";
    pivotValues?: string[];
  };
}

export type PipelineStep =
  | FilterStep
  | SelectColumnsStep
  | MutateColumnStep
  | RemoveDuplicatesStep
  | MissingValuesStep
  | SortRowsStep
  | CastColumnStep
  | ScaleNumericStep
  | DummyVariablesStep
  | SQLTransformStep
  | GroupAggregateStep
  | JoinStep
  | PivotStep;

export interface AnalysisRecipeV1 {
  schemaVersion: "1.0";
  createdAt: string;
  sources: SourceFileMetadata[];
  pipeline: PipelineStep[];
  pipelinesByTable?: Record<string, PipelineStep[]>;
  activePipelineStepIdByTable?: Record<string, string | null>;
  selectedTransformTableName?: string | null;
  savedQueries: SavedQuery[];
  notebookBlocks: NotebookBlock[];
  columnEditsByTable?: Record<string, ColumnSchemaEdit[]>;
}
