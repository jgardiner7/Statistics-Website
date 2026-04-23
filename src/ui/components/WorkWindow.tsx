import { type ReactNode, useEffect, useState } from "react";
import type {
  CastColumnStep,
  CorrelationMethod,
  FilterStep,
  GroupAggregateStep,
  JoinStep,
  MissingValuesStep,
  NotebookChartType,
  PipelineStep,
  PivotStep,
  QueryTargetRef,
  RemoveDuplicatesStep,
  ScaleNumericStep,
  SavedQuery,
  SortRowsStep
} from "../../shared/types";
import { formatQueryTarget, getActiveVersion } from "../../queries/lineage";
import { TabBar } from "./TabBar";

type WorkTab = "query" | "transform" | "statistics";
type TransformPanel =
  | "filter"
  | "select"
  | "mutate"
  | "dedupe"
  | "missing"
  | "sort"
  | "cast"
  | "scale"
  | "dummy"
  | "group"
  | "join"
  | "pivot"
  | "sql";
type StatisticsPanel =
  | "visualization"
  | "welch"
  | "correlation"
  | "chi"
  | "ols";

interface WorkWindowProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  transformTableName: string | null;
  queryTarget: QueryTargetRef | null;
  targetOptions: Array<{
    key: string;
    label: string;
    target: QueryTargetRef;
  }>;
  openNewQuerySignal: number;
  openNewTransformSignal: number;
  onTargetChange: (targetKey: string) => void;
  onNewQuery: () => void;
  availableColumns: string[];
  statisticsAvailableColumns: string[];
  tableColumnOptions: Array<{
    tableName: string;
    columns: string[];
  }>;
  onSaveFilterStep: (input: {
    column: string;
    operator: FilterStep["params"]["operator"];
    value: string;
  }) => void;
  onSaveSelectColumnsStep: (input: {
    columns: string[];
  }) => void;
  onSaveMutateColumnStep: (input: {
    outputColumn: string;
    expression: string;
  }) => void;
  onSaveRemoveDuplicatesStep: (input: {
    columns: RemoveDuplicatesStep["params"]["columns"];
  }) => void;
  onSaveMissingValuesStep: (input: {
    mode: MissingValuesStep["params"]["mode"];
    columns: string[];
    fillValue?: string;
  }) => void;
  onSaveSortRowsStep: (input: {
    column: string;
    direction: SortRowsStep["params"]["direction"];
    nulls: SortRowsStep["params"]["nulls"];
  }) => void;
  onSaveCastColumnStep: (input: {
    column: string;
    targetType: CastColumnStep["params"]["targetType"];
    outputColumn?: CastColumnStep["params"]["outputColumn"];
    dateFormat?: CastColumnStep["params"]["dateFormat"];
  }) => void;
  onSaveScaleNumericStep: (input: {
    column: string;
    method: ScaleNumericStep["params"]["method"];
    outputColumn: string;
  }) => void;
  onSaveDummyVariablesStep: (input: {
    sourceColumn: string;
    prefix?: string;
    dropOne: boolean;
    dropCategory?: string;
  }) => void;
  onSaveGroupAggregateStep: (input: {
    groupBy: string[];
    aggregates: Array<{
      expression: string;
      alias: string;
    }>;
  }) => void;
  onSaveJoinStep: (input: {
    rightTable: string;
    joinType: JoinStep["params"]["joinType"];
    conditions: Array<{
      leftColumn: string;
      operator: JoinStep["params"]["conditions"][number]["operator"];
      rightColumn: string;
    }>;
  }) => void;
  onSavePivotStep: (input: {
    indexColumns: string[];
    pivotColumn: string;
    valueColumn: string;
    aggregate: PivotStep["params"]["aggregate"];
  }) => void;
  onAddSqlStep: () => void;
  onUpdatePipelineSqlStep: () => void;
  onRunPipeline: () => void;
  onRunWelchTTest: (input: {
    valueColumn: string;
    groupColumn: string;
    groupA: string;
    groupB: string;
    confidenceLevel?: number;
  }) => void;
  onRunPearsonCorrelation: (input: {
    xColumn: string;
    yColumn: string;
    method?: CorrelationMethod;
    confidenceLevel?: number;
  }) => void;
  onRunChiSquareTest: (input: {
    rowColumn: string;
    columnColumn: string;
  }) => void;
  onRunOLSRegression: (input: {
    dependentColumn: string;
    independentColumns: string[];
    includeIntercept: boolean;
    oneHotEncodeCategorical: boolean;
  }) => void;
  onCreateChart: (input: {
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
  }) => void;
  activePipelineStep: PipelineStep | null;
  savedQueries: SavedQuery[];
  activeQueryId: string | null;
  statusText: string;
  onRunSQL: () => void;
  onSaveQuery: () => void;
}

interface AccordionCardProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  subtitle?: string;
  children: ReactNode;
}

function AccordionCard({
  title,
  open,
  onToggle,
  subtitle,
  children
}: AccordionCardProps) {
  return (
    <div className="active-query-card">
      <button
        type="button"
        className="accordion-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="accordion-title-wrap">
          <span className="accordion-arrow">{open ? "▼" : "▶"}</span>
          <strong>{title}</strong>
        </span>
        {subtitle ? <span className="hint-line">{subtitle}</span> : null}
      </button>
      {open ? <div className="accordion-body">{children}</div> : null}
    </div>
  );
}

function panelForStep(step: PipelineStep): TransformPanel {
  switch (step.type) {
    case "FilterStep":
      return "filter";
    case "SelectColumnsStep":
      return "select";
    case "MutateColumnStep":
      return "mutate";
    case "RemoveDuplicatesStep":
      return "dedupe";
    case "MissingValuesStep":
      return "missing";
    case "SortRowsStep":
      return "sort";
    case "CastColumnStep":
      return "cast";
    case "ScaleNumericStep":
      return "scale";
    case "DummyVariablesStep":
      return "dummy";
    case "GroupAggregateStep":
      return "group";
    case "JoinStep":
      return "join";
    case "PivotStep":
      return "pivot";
    default:
      return "sql";
  }
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function WorkWindow({
  sql,
  onSqlChange,
  transformTableName,
  queryTarget,
  targetOptions,
  openNewQuerySignal,
  openNewTransformSignal,
  onTargetChange,
  onNewQuery,
  availableColumns,
  statisticsAvailableColumns,
  tableColumnOptions,
  onSaveFilterStep,
  onSaveSelectColumnsStep,
  onSaveMutateColumnStep,
  onSaveRemoveDuplicatesStep,
  onSaveMissingValuesStep,
  onSaveSortRowsStep,
  onSaveCastColumnStep,
  onSaveScaleNumericStep,
  onSaveDummyVariablesStep,
  onSaveGroupAggregateStep,
  onSaveJoinStep,
  onSavePivotStep,
  onAddSqlStep,
  onUpdatePipelineSqlStep,
  onRunPipeline,
  onRunWelchTTest,
  onRunPearsonCorrelation,
  onRunChiSquareTest,
  onRunOLSRegression,
  onCreateChart,
  activePipelineStep,
  savedQueries,
  activeQueryId,
  statusText,
  onRunSQL,
  onSaveQuery
}: WorkWindowProps) {
  const activeQuery =
    savedQueries.find((query) => query.id === activeQueryId) ?? null;
  const activeVersion = activeQuery ? getActiveVersion(activeQuery) : null;
  const selectedTargetKey = queryTarget
    ? queryTarget.kind === "table"
      ? `table:${queryTarget.tableName}`
      : queryTarget.kind === "pipeline_step"
        ? `pipeline:${queryTarget.baseTableName}:${queryTarget.stepId}`
        : `query:${queryTarget.versionId}`
    : "";

  const [workTab, setWorkTab] = useState<WorkTab>("query");
  const [queryEditorVisible, setQueryEditorVisible] = useState(false);
  const [transformBuilderVisible, setTransformBuilderVisible] = useState(false);
  const [queryEditorExpanded, setQueryEditorExpanded] = useState(false);
  const [expandedTransformPanel, setExpandedTransformPanel] =
    useState<TransformPanel | null>(null);
  const [expandedStatisticsPanel, setExpandedStatisticsPanel] =
    useState<StatisticsPanel | null>(null);

  const [filterColumn, setFilterColumn] = useState("");
  const [filterOperator, setFilterOperator] =
    useState<FilterStep["params"]["operator"]>("=");
  const [filterValue, setFilterValue] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [mutateOutputColumn, setMutateOutputColumn] = useState("");
  const [mutateExpression, setMutateExpression] = useState("");
  const [dedupeColumns, setDedupeColumns] = useState<string[]>([]);
  const [missingMode, setMissingMode] =
    useState<MissingValuesStep["params"]["mode"]>("drop");
  const [missingColumns, setMissingColumns] = useState<string[]>([]);
  const [missingFillValue, setMissingFillValue] = useState("");
  const [sortColumn, setSortColumn] = useState("");
  const [sortDirection, setSortDirection] =
    useState<SortRowsStep["params"]["direction"]>("asc");
  const [sortNulls, setSortNulls] = useState<SortRowsStep["params"]["nulls"]>("last");
  const [castColumn, setCastColumn] = useState("");
  const [castTargetType, setCastTargetType] = useState("DOUBLE");
  const [castOutputColumn, setCastOutputColumn] = useState("");
  const [castDateFormat, setCastDateFormat] = useState("");
  const [scaleColumn, setScaleColumn] = useState("");
  const [scaleMethod, setScaleMethod] =
    useState<ScaleNumericStep["params"]["method"]>("zscore");
  const [scaleOutputColumn, setScaleOutputColumn] = useState("");
  const [dummySourceColumn, setDummySourceColumn] = useState("");
  const [dummyPrefix, setDummyPrefix] = useState("");
  const [dummyDropOne, setDummyDropOne] = useState(false);
  const [dummyDropCategory, setDummyDropCategory] = useState("");
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [groupAggregates, setGroupAggregates] = useState<
    GroupAggregateStep["params"]["aggregates"]
  >([
    {
      expression: "COUNT(*)",
      alias: "row_count"
    }
  ]);
  const [joinRightTable, setJoinRightTable] = useState("");
  const [joinType, setJoinType] = useState<JoinStep["params"]["joinType"]>("inner");
  const [joinConditions, setJoinConditions] = useState<JoinStep["params"]["conditions"]>(
    []
  );
  const [pivotIndexColumns, setPivotIndexColumns] = useState<string[]>([]);
  const [pivotColumn, setPivotColumn] = useState("");
  const [pivotValueColumn, setPivotValueColumn] = useState("");
  const [pivotAggregate, setPivotAggregate] =
    useState<PivotStep["params"]["aggregate"]>("sum");
  const [welchValueColumn, setWelchValueColumn] = useState("");
  const [welchGroupColumn, setWelchGroupColumn] = useState("");
  const [welchGroupA, setWelchGroupA] = useState("");
  const [welchGroupB, setWelchGroupB] = useState("");
  const [correlationMethod, setCorrelationMethod] =
    useState<CorrelationMethod>("pearson");
  const [pearsonXColumn, setPearsonXColumn] = useState("");
  const [pearsonYColumn, setPearsonYColumn] = useState("");
  const [chartType, setChartType] = useState<NotebookChartType>("line");
  const [chartXColumn, setChartXColumn] = useState("");
  const [chartYColumn, setChartYColumn] = useState("");
  const [chartSeriesColumn, setChartSeriesColumn] = useState("");
  const [chartFacetColumn, setChartFacetColumn] = useState("");
  const [chartTitle, setChartTitle] = useState("");
  const [chartXAxisLabel, setChartXAxisLabel] = useState("");
  const [chartYAxisLabel, setChartYAxisLabel] = useState("");
  const [chartAutoRange, setChartAutoRange] = useState(true);
  const [chartXMin, setChartXMin] = useState("");
  const [chartXMax, setChartXMax] = useState("");
  const [chartYMin, setChartYMin] = useState("");
  const [chartYMax, setChartYMax] = useState("");
  const [chartShowBestFitLine, setChartShowBestFitLine] = useState(false);
  const [chartHistogramBins, setChartHistogramBins] = useState("20");
  const [chiRowColumn, setChiRowColumn] = useState("");
  const [chiColumnColumn, setChiColumnColumn] = useState("");
  const [olsDependentColumn, setOlsDependentColumn] = useState("");
  const [olsIndependentColumns, setOlsIndependentColumns] = useState<string[]>([]);
  const [olsIncludeIntercept, setOlsIncludeIntercept] = useState(true);
  const [olsOneHotEncodeCategorical, setOlsOneHotEncodeCategorical] = useState(true);
  const rightTableColumns =
    tableColumnOptions.find((entry) => entry.tableName === joinRightTable)?.columns ?? [];
  const parseOptionalNumber = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const parsedChartXMin = parseOptionalNumber(chartXMin);
  const parsedChartXMax = parseOptionalNumber(chartXMax);
  const parsedChartYMin = parseOptionalNumber(chartYMin);
  const parsedChartYMax = parseOptionalNumber(chartYMax);
  const parsedHistogramBins = Number.parseInt(chartHistogramBins.trim(), 10);
  const chartHistogramBinsInvalid =
    chartType === "histogram" &&
    (chartHistogramBins.trim().length === 0 ||
      !Number.isFinite(parsedHistogramBins) ||
      parsedHistogramBins <= 0);
  const chartRangeInputInvalid =
    (!chartAutoRange &&
      ((chartXMin.trim().length > 0 && parsedChartXMin === undefined) ||
        (chartXMax.trim().length > 0 && parsedChartXMax === undefined) ||
        (chartYMin.trim().length > 0 && parsedChartYMin === undefined) ||
        (chartYMax.trim().length > 0 && parsedChartYMax === undefined))) ||
    false;
  const chartRangeOrderInvalid =
    !chartAutoRange &&
    ((parsedChartXMin !== undefined &&
      parsedChartXMax !== undefined &&
      parsedChartXMin >= parsedChartXMax) ||
      (parsedChartYMin !== undefined &&
        parsedChartYMax !== undefined &&
        parsedChartYMin >= parsedChartYMax));

  const resetTransformBuilder = () => {
    const firstColumn = availableColumns[0] ?? "";
    const initialJoinTable = tableColumnOptions[0];
    const initialRightColumn = initialJoinTable?.columns[0] ?? "";
    setFilterColumn(firstColumn);
    setFilterOperator("=");
    setFilterValue("");
    setSelectedColumns([]);
    setMutateOutputColumn("");
    setMutateExpression("");
    setDedupeColumns([]);
    setMissingMode("drop");
    setMissingColumns(firstColumn ? [firstColumn] : []);
    setMissingFillValue("");
    setSortColumn(firstColumn);
    setSortDirection("asc");
    setSortNulls("last");
    setCastColumn(firstColumn);
    setCastTargetType("DOUBLE");
    setCastOutputColumn("");
    setCastDateFormat("");
    setScaleColumn(firstColumn);
    setScaleMethod("zscore");
    setScaleOutputColumn(firstColumn ? `${firstColumn}_zscore` : "");
    setDummySourceColumn(firstColumn);
    setDummyPrefix("");
    setDummyDropOne(false);
    setDummyDropCategory("");
    setGroupByColumns([]);
    setGroupAggregates([
      {
        expression: "COUNT(*)",
        alias: "row_count"
      }
    ]);
    setJoinRightTable(initialJoinTable?.tableName ?? "");
    setJoinType("inner");
    setJoinConditions([
      {
        leftColumn: firstColumn,
        operator: "=",
        rightColumn: initialRightColumn
      }
    ]);
    setPivotIndexColumns(firstColumn ? [firstColumn] : []);
    setPivotColumn(firstColumn);
    setPivotValueColumn(availableColumns[1] ?? firstColumn);
    setPivotAggregate("sum");
    onSqlChange("");
  };

  useEffect(() => {
    if (!availableColumns.length) {
      setFilterColumn("");
      setDummySourceColumn("");
      setDedupeColumns([]);
      setMissingColumns([]);
      setSortColumn("");
      setCastColumn("");
      setScaleColumn("");
      setScaleOutputColumn("");
      setGroupByColumns([]);
      setJoinConditions([]);
      setPivotIndexColumns([]);
      setPivotColumn("");
      setPivotValueColumn("");
      return;
    }

    if (!availableColumns.includes(filterColumn)) {
      setFilterColumn(availableColumns[0]);
    }
    if (!availableColumns.includes(dummySourceColumn)) {
      setDummySourceColumn(availableColumns[0]);
    }
    setDedupeColumns((current) =>
      current.filter((column) => availableColumns.includes(column))
    );
    setMissingColumns((current) => {
      const filtered = current.filter((column) => availableColumns.includes(column));
      if (filtered.length > 0) {
        return filtered;
      }
      return [availableColumns[0]];
    });
    if (!availableColumns.includes(sortColumn)) {
      setSortColumn(availableColumns[0]);
    }
    if (!availableColumns.includes(castColumn)) {
      setCastColumn(availableColumns[0]);
    }
    if (!availableColumns.includes(scaleColumn)) {
      const nextScaleColumn = availableColumns[0];
      setScaleColumn(nextScaleColumn);
      setScaleOutputColumn(`${nextScaleColumn}_${scaleMethod}`);
    }
    setGroupByColumns((current) =>
      current.filter((column) => availableColumns.includes(column))
    );
    setPivotIndexColumns((current) =>
      current.filter((column) => availableColumns.includes(column))
    );
    if (!availableColumns.includes(pivotColumn)) {
      setPivotColumn(availableColumns[0]);
    }
    if (!availableColumns.includes(pivotValueColumn)) {
      const fallbackValueColumn =
        availableColumns.find((column) => column !== (availableColumns[0] ?? "")) ??
        availableColumns[0];
      setPivotValueColumn(fallbackValueColumn);
    }
    setJoinConditions((current) => {
      if (current.length === 0) {
        return current;
      }
      let changed = false;
      const next = current.map((condition) => {
        if (availableColumns.includes(condition.leftColumn)) {
          return condition;
        }
        changed = true;
        return {
          ...condition,
          leftColumn: availableColumns[0]
        };
      });
      return changed ? next : current;
    });
  }, [
    availableColumns,
    castColumn,
    dummySourceColumn,
    filterColumn,
    pivotColumn,
    pivotValueColumn,
    scaleColumn,
    scaleMethod,
    sortColumn
  ]);

  useEffect(() => {
    if (!statisticsAvailableColumns.length) {
      setWelchValueColumn("");
      setWelchGroupColumn("");
      setPearsonXColumn("");
      setPearsonYColumn("");
      setChartXColumn("");
      setChartYColumn("");
      setChartSeriesColumn("");
      setChartFacetColumn("");
      setChiRowColumn("");
      setChiColumnColumn("");
      setOlsDependentColumn("");
      setOlsIndependentColumns([]);
      return;
    }

    const resolvedOlsDependent = statisticsAvailableColumns.includes(olsDependentColumn)
      ? olsDependentColumn
      : statisticsAvailableColumns[0];
    if (resolvedOlsDependent !== olsDependentColumn) {
      setOlsDependentColumn(resolvedOlsDependent);
    }
    setOlsIndependentColumns((current) => {
      const filtered = current.filter(
        (column) =>
          statisticsAvailableColumns.includes(column) &&
          column !== resolvedOlsDependent
      );
      if (filtered.length > 0) {
        return areStringArraysEqual(current, filtered) ? current : filtered;
      }
      const fallbackPredictor = statisticsAvailableColumns.find(
        (column) => column !== resolvedOlsDependent
      );
      const next = fallbackPredictor ? [fallbackPredictor] : [];
      return areStringArraysEqual(current, next) ? current : next;
    });

    if (!statisticsAvailableColumns.includes(welchValueColumn)) {
      setWelchValueColumn(statisticsAvailableColumns[0]);
    }
    if (!statisticsAvailableColumns.includes(welchGroupColumn)) {
      setWelchGroupColumn(
        statisticsAvailableColumns[
          Math.min(1, statisticsAvailableColumns.length - 1)
        ]
      );
    }
    if (!statisticsAvailableColumns.includes(pearsonXColumn)) {
      setPearsonXColumn(statisticsAvailableColumns[0]);
    }
    if (!statisticsAvailableColumns.includes(pearsonYColumn)) {
      setPearsonYColumn(
        statisticsAvailableColumns[
          Math.min(1, statisticsAvailableColumns.length - 1)
        ]
      );
    }
    if (!statisticsAvailableColumns.includes(chartXColumn)) {
      setChartXColumn(statisticsAvailableColumns[0]);
    }
    if (!statisticsAvailableColumns.includes(chartYColumn)) {
      setChartYColumn(
        statisticsAvailableColumns[
          Math.min(1, statisticsAvailableColumns.length - 1)
        ]
      );
    }
    if (chartSeriesColumn && !statisticsAvailableColumns.includes(chartSeriesColumn)) {
      setChartSeriesColumn("");
    }
    if (chartFacetColumn && !statisticsAvailableColumns.includes(chartFacetColumn)) {
      setChartFacetColumn("");
    }
    if (!statisticsAvailableColumns.includes(chiRowColumn)) {
      setChiRowColumn(statisticsAvailableColumns[0]);
    }
    if (!statisticsAvailableColumns.includes(chiColumnColumn)) {
      setChiColumnColumn(
        statisticsAvailableColumns[
          Math.min(1, statisticsAvailableColumns.length - 1)
        ]
      );
    }
  }, [
    chartFacetColumn,
    chartSeriesColumn,
    chartXColumn,
    chartYColumn,
    chiColumnColumn,
    chiRowColumn,
    olsDependentColumn,
    pearsonXColumn,
    pearsonYColumn,
    statisticsAvailableColumns,
    welchGroupColumn,
    welchValueColumn
  ]);

  useEffect(() => {
    if (!chartXAxisLabel.trim() && chartXColumn) {
      setChartXAxisLabel(chartXColumn);
    }
  }, [chartXAxisLabel, chartXColumn]);

  useEffect(() => {
    if (!chartYAxisLabel.trim() && chartYColumn) {
      setChartYAxisLabel(chartType === "histogram" ? "count" : chartYColumn);
    }
  }, [chartType, chartYAxisLabel, chartYColumn]);

  useEffect(() => {
    if ((chartType === "bar" || chartType === "histogram") && chartShowBestFitLine) {
      setChartShowBestFitLine(false);
    }
    if (chartType === "bar" && chartSeriesColumn) {
      setChartSeriesColumn("");
    }
  }, [chartSeriesColumn, chartShowBestFitLine, chartType]);

  useEffect(() => {
    if (tableColumnOptions.length === 0) {
      setJoinRightTable("");
      setJoinConditions((current) => {
        if (current.length === 0) {
          return current;
        }
        let changed = false;
        const next = current.map((condition) => {
          if (condition.rightColumn === "") {
            return condition;
          }
          changed = true;
          return {
            ...condition,
            rightColumn: ""
          };
        });
        return changed ? next : current;
      });
      return;
    }

    const resolvedJoinTable = tableColumnOptions.some(
      (entry) => entry.tableName === joinRightTable
    )
      ? joinRightTable
      : tableColumnOptions[0].tableName;
    if (resolvedJoinTable !== joinRightTable) {
      setJoinRightTable(resolvedJoinTable);
    }
    const resolvedRightColumns =
      tableColumnOptions.find((entry) => entry.tableName === resolvedJoinTable)?.columns ??
      [];
    const defaultRightColumn = resolvedRightColumns[0] ?? "";

    setJoinConditions((current) => {
      if (current.length === 0) {
        return [
          {
            leftColumn: availableColumns[0] ?? "",
            operator: "=",
            rightColumn: defaultRightColumn
          }
        ];
      }
      let changed = false;
      const next = current.map((condition) => {
        if (resolvedRightColumns.includes(condition.rightColumn)) {
          return condition;
        }
        changed = true;
        return {
          ...condition,
          rightColumn: defaultRightColumn
        };
      });
      return changed ? next : current;
    });
  }, [availableColumns, joinRightTable, tableColumnOptions]);

  useEffect(() => {
    setSelectedColumns((current) =>
      current.filter((column) => availableColumns.includes(column))
    );
  }, [availableColumns]);

  useEffect(() => {
    if (openNewQuerySignal === 0) {
      return;
    }
    setWorkTab("query");
    setQueryEditorVisible(true);
    setQueryEditorExpanded(true);
  }, [openNewQuerySignal]);

  useEffect(() => {
    if (openNewTransformSignal === 0) {
      return;
    }
    setWorkTab("transform");
    setTransformBuilderVisible(true);
    setExpandedTransformPanel(null);
    resetTransformBuilder();
  }, [openNewTransformSignal]);

  useEffect(() => {
    if (!activePipelineStep) {
      return;
    }

    if (activePipelineStep.type === "FilterStep") {
      setFilterColumn(activePipelineStep.params.column);
      setFilterOperator(activePipelineStep.params.operator);
      setFilterValue(activePipelineStep.params.value);
    } else if (activePipelineStep.type === "SelectColumnsStep") {
      setSelectedColumns(activePipelineStep.params.columns);
    } else if (activePipelineStep.type === "MutateColumnStep") {
      setMutateOutputColumn(activePipelineStep.params.outputColumn);
      setMutateExpression(activePipelineStep.params.expression);
    } else if (activePipelineStep.type === "RemoveDuplicatesStep") {
      setDedupeColumns(activePipelineStep.params.columns);
    } else if (activePipelineStep.type === "MissingValuesStep") {
      setMissingMode(activePipelineStep.params.mode);
      setMissingColumns(activePipelineStep.params.columns);
      setMissingFillValue(activePipelineStep.params.fillValue ?? "");
    } else if (activePipelineStep.type === "SortRowsStep") {
      setSortColumn(activePipelineStep.params.column);
      setSortDirection(activePipelineStep.params.direction);
      setSortNulls(activePipelineStep.params.nulls);
    } else if (activePipelineStep.type === "CastColumnStep") {
      setCastColumn(activePipelineStep.params.column);
      setCastTargetType(activePipelineStep.params.targetType || "DOUBLE");
      setCastOutputColumn(activePipelineStep.params.outputColumn ?? "");
      setCastDateFormat(activePipelineStep.params.dateFormat ?? "");
    } else if (activePipelineStep.type === "ScaleNumericStep") {
      setScaleColumn(activePipelineStep.params.column);
      setScaleMethod(activePipelineStep.params.method);
      setScaleOutputColumn(activePipelineStep.params.outputColumn);
    } else if (activePipelineStep.type === "DummyVariablesStep") {
      setDummySourceColumn(activePipelineStep.params.sourceColumn);
      setDummyPrefix(activePipelineStep.params.prefix ?? "");
      const dropCategory = activePipelineStep.params.dropCategory?.trim() ?? "";
      setDummyDropOne(Boolean(dropCategory));
      setDummyDropCategory(dropCategory);
    } else if (activePipelineStep.type === "GroupAggregateStep") {
      setGroupByColumns(activePipelineStep.params.groupBy);
      setGroupAggregates(
        activePipelineStep.params.aggregates.length > 0
          ? activePipelineStep.params.aggregates
          : [
              {
                expression: "COUNT(*)",
                alias: "row_count"
              }
            ]
      );
    } else if (activePipelineStep.type === "JoinStep") {
      setJoinRightTable(activePipelineStep.params.rightTable);
      setJoinType(activePipelineStep.params.joinType);
      setJoinConditions(
        activePipelineStep.params.conditions.length > 0
          ? activePipelineStep.params.conditions
          : [
              {
                leftColumn: availableColumns[0] ?? "",
                operator: "=",
                rightColumn:
                  tableColumnOptions[0]?.columns[0] ?? ""
              }
            ]
      );
    } else if (activePipelineStep.type === "PivotStep") {
      setPivotIndexColumns(activePipelineStep.params.indexColumns);
      setPivotColumn(activePipelineStep.params.pivotColumn);
      setPivotValueColumn(activePipelineStep.params.valueColumn);
      setPivotAggregate(activePipelineStep.params.aggregate);
    }

    setWorkTab("transform");
    setTransformBuilderVisible(true);
    setExpandedTransformPanel(panelForStep(activePipelineStep));
  }, [activePipelineStep, availableColumns, tableColumnOptions]);

  useEffect(() => {
    if (!activeQueryId) {
      return;
    }
    setWorkTab("query");
    setQueryEditorVisible(true);
    setQueryEditorExpanded(true);
  }, [activeQueryId]);

  const isFilterActive = activePipelineStep?.type === "FilterStep";
  const isSelectColumnsActive = activePipelineStep?.type === "SelectColumnsStep";
  const isMutateActive = activePipelineStep?.type === "MutateColumnStep";
  const isRemoveDuplicatesActive = activePipelineStep?.type === "RemoveDuplicatesStep";
  const isMissingValuesActive = activePipelineStep?.type === "MissingValuesStep";
  const isSortRowsActive = activePipelineStep?.type === "SortRowsStep";
  const isCastColumnActive = activePipelineStep?.type === "CastColumnStep";
  const isScaleNumericActive = activePipelineStep?.type === "ScaleNumericStep";
  const isDummyVariablesActive = activePipelineStep?.type === "DummyVariablesStep";
  const isGroupAggregateActive = activePipelineStep?.type === "GroupAggregateStep";
  const isJoinActive = activePipelineStep?.type === "JoinStep";
  const isPivotActive = activePipelineStep?.type === "PivotStep";

  return (
    <section className="window work-window">
      <div className="pane-header">
        <h2>Work Window</h2>
        <div className="hint-line">Transform table: {transformTableName ?? "none"}</div>
      </div>

      <TabBar
        value={workTab}
        onChange={setWorkTab}
        tabs={[
          { id: "query", label: "Query" },
          { id: "transform", label: "Transform" },
          { id: "statistics", label: "Statistics" }
        ]}
      />
      {workTab === "transform" && (
        <div className="hint-line work-target-line">
          Creating transform for table: {transformTableName ?? "none selected"}
        </div>
      )}

      {workTab === "query" && (
        <div className="pane-body scroll-pane">
          {!queryEditorVisible ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setQueryEditorVisible(true);
                setQueryEditorExpanded(false);
                onNewQuery();
              }}
            >
              Create Query
            </button>
          ) : (
            <>
              {activeQuery ? (
                <div className="active-query-card">
                  <div className="inline-row spread">
                    <strong>{activeQuery.name}</strong>
                    <span className="hint-line">
                      Saved query | v{activeQuery.versions.length}
                    </span>
                  </div>
                  <div className="query-preview">{activeVersion?.sql}</div>
                </div>
              ) : null}

              <AccordionCard
                title="SQL Query"
                subtitle="Query editor"
                open={queryEditorExpanded}
                onToggle={() => setQueryEditorExpanded((value) => !value)}
              >
                <div className="inline-row">
                  <label htmlFor="query-target">Run against:</label>
                  <select
                    id="query-target"
                    value={selectedTargetKey}
                    disabled={targetOptions.length === 0}
                    onChange={(event) => onTargetChange(event.target.value)}
                  >
                    {targetOptions.length === 0 ? (
                      <option value="">No targets available</option>
                    ) : (
                      targetOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="hint-line">
                  Target: {queryTarget ? formatQueryTarget(queryTarget) : "None selected"}
                </div>

                <label htmlFor="query-sql-editor" className="field-label inline-label">
                  SQL Query
                </label>
                <textarea
                  id="query-sql-editor"
                  className="sql-editor work-sql-editor"
                  spellCheck={false}
                  value={sql}
                  onChange={(event) => onSqlChange(event.target.value)}
                  placeholder={`SELECT * FROM ${transformTableName ?? "source"} LIMIT 100`}
                />

                <div className="inline-row">
                  <button type="button" className="btn btn-primary" onClick={onRunSQL}>
                    Run SQL
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={onSaveQuery}>
                    {activeQueryId ? "Save New Version" : "Save Query"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      onNewQuery();
                      setQueryEditorExpanded(true);
                    }}
                  >
                    New Query
                  </button>
                </div>
              </AccordionCard>
            </>
          )}
        </div>
      )}

      {workTab === "transform" && (
        <div className="pane-body scroll-pane">
          {!transformBuilderVisible ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setTransformBuilderVisible(true);
                setExpandedTransformPanel(null);
                resetTransformBuilder();
              }}
            >
              Create Transform
            </button>
          ) : (
            <>
              {activePipelineStep ? (
                <div className="active-query-card">
                  <div className="inline-row spread">
                    <strong>{activePipelineStep.name}</strong>
                    <span className="hint-line">{activePipelineStep.type}</span>
                  </div>
                </div>
              ) : null}

              <AccordionCard
                title="Filter by Column Value"
                subtitle="GUI transform"
                open={expandedTransformPanel === "filter"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "filter" ? null : "filter"
                  )
                }
              >
                <div className="inline-row filter-builder-row">
                  <label htmlFor="filter-column">Filter Column</label>
                  <select
                    id="filter-column"
                    value={filterColumn}
                    disabled={availableColumns.length === 0}
                    onChange={(event) => setFilterColumn(event.target.value)}
                  >
                    {availableColumns.length === 0 ? (
                      <option value="">No columns</option>
                    ) : (
                      availableColumns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))
                    )}
                  </select>

                  <label htmlFor="filter-operator">Filter Operator</label>
                  <select
                    id="filter-operator"
                    value={filterOperator}
                    onChange={(event) =>
                      setFilterOperator(event.target.value as FilterStep["params"]["operator"])
                    }
                  >
                    <option value="=">=</option>
                    <option value="!=">!=</option>
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<=">&lt;=</option>
                    <option value="contains">contains</option>
                  </select>

                  <label htmlFor="filter-value">Filter Value</label>
                  <input
                    id="filter-value"
                    type="text"
                    value={filterValue}
                    onChange={(event) => setFilterValue(event.target.value)}
                    placeholder="100"
                  />

                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={!filterColumn}
                    onClick={() =>
                      onSaveFilterStep({
                        column: filterColumn,
                        operator: filterOperator,
                        value: filterValue
                      })
                    }
                  >
                    {isFilterActive ? "Update Filter Step" : "Add Filter Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Select Columns"
                subtitle="GUI transform"
                open={expandedTransformPanel === "select"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "select" ? null : "select"
                  )
                }
              >
                <div className="columns-checklist">
                  {availableColumns.length === 0 ? (
                    <span className="hint-line">No columns available.</span>
                  ) : (
                    availableColumns.map((column) => (
                      <label key={column} className="checkbox-label compact">
                        <input
                          type="checkbox"
                          checked={selectedColumns.includes(column)}
                          onChange={(event) => {
                            setSelectedColumns((current) => {
                              if (event.target.checked) {
                                return [...current, column];
                              }
                              return current.filter((value) => value !== column);
                            });
                          }}
                        />
                        {column}
                      </label>
                    ))
                  )}
                </div>
                <div className="inline-row">
                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={selectedColumns.length === 0}
                    onClick={() =>
                      onSaveSelectColumnsStep({
                        columns: selectedColumns
                      })
                    }
                  >
                    {isSelectColumnsActive ? "Update Select Step" : "Add Select Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Calculate New Column"
                subtitle="GUI transform"
                open={expandedTransformPanel === "mutate"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "mutate" ? null : "mutate"
                  )
                }
              >
                <div className="inline-row filter-builder-row">
                  <label htmlFor="mutate-output-column">Output Column</label>
                  <input
                    id="mutate-output-column"
                    type="text"
                    value={mutateOutputColumn}
                    onChange={(event) => setMutateOutputColumn(event.target.value)}
                    placeholder="amount_scaled"
                  />

                  <label htmlFor="mutate-expression">Expression</label>
                  <input
                    id="mutate-expression"
                    type="text"
                    value={mutateExpression}
                    onChange={(event) => setMutateExpression(event.target.value)}
                    placeholder="amount / 100"
                  />

                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={!mutateOutputColumn.trim() || !mutateExpression.trim()}
                    onClick={() =>
                      onSaveMutateColumnStep({
                        outputColumn: mutateOutputColumn,
                        expression: mutateExpression
                      })
                    }
                  >
                    {isMutateActive ? "Update Mutate Step" : "Add Mutate Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Remove Duplicates"
                subtitle="Drop duplicate rows using selected key columns"
                open={expandedTransformPanel === "dedupe"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "dedupe" ? null : "dedupe"
                  )
                }
              >
                <div className="columns-checklist">
                  {availableColumns.length === 0 ? (
                    <span className="hint-line">No columns available.</span>
                  ) : (
                    availableColumns.map((column) => (
                      <label key={`dedupe-${column}`} className="checkbox-label compact">
                        <input
                          type="checkbox"
                          checked={dedupeColumns.includes(column)}
                          onChange={(event) =>
                            setDedupeColumns((current) => {
                              if (event.target.checked) {
                                return [...current, column];
                              }
                              return current.filter((value) => value !== column);
                            })
                          }
                        />
                        Key: {column}
                      </label>
                    ))
                  )}
                </div>
                <div className="inline-row">
                  <span className="hint-line">
                    If no key columns are selected, full-row distinct is used.
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    onClick={() => onSaveRemoveDuplicatesStep({ columns: dedupeColumns })}
                  >
                    {isRemoveDuplicatesActive
                      ? "Update Remove Duplicates Step"
                      : "Add Remove Duplicates Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Fill or Drop Missing Values"
                subtitle="Apply null handling to selected columns"
                open={expandedTransformPanel === "missing"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "missing" ? null : "missing"
                  )
                }
              >
                <div className="inline-row filter-builder-row">
                  <label htmlFor="missing-mode">Mode</label>
                  <select
                    id="missing-mode"
                    value={missingMode}
                    onChange={(event) =>
                      setMissingMode(
                        event.target.value as MissingValuesStep["params"]["mode"]
                      )
                    }
                  >
                    <option value="drop">Drop rows with nulls</option>
                    <option value="fill">Fill nulls</option>
                  </select>

                  {missingMode === "fill" ? (
                    <>
                      <label htmlFor="missing-fill-value">Fill Value</label>
                      <input
                        id="missing-fill-value"
                        type="text"
                        value={missingFillValue}
                        onChange={(event) => setMissingFillValue(event.target.value)}
                        placeholder="0"
                      />
                    </>
                  ) : null}
                </div>

                <div className="columns-checklist">
                  {availableColumns.length === 0 ? (
                    <span className="hint-line">No columns available.</span>
                  ) : (
                    availableColumns.map((column) => (
                      <label key={`missing-${column}`} className="checkbox-label compact">
                        <input
                          type="checkbox"
                          checked={missingColumns.includes(column)}
                          onChange={(event) =>
                            setMissingColumns((current) => {
                              if (event.target.checked) {
                                return [...current, column];
                              }
                              return current.filter((value) => value !== column);
                            })
                          }
                        />
                        Column: {column}
                      </label>
                    ))
                  )}
                </div>

                <div className="inline-row">
                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={
                      missingColumns.length === 0 ||
                      (missingMode === "fill" && missingFillValue.trim().length === 0)
                    }
                    onClick={() =>
                      onSaveMissingValuesStep({
                        mode: missingMode,
                        columns: missingColumns,
                        fillValue: missingFillValue
                      })
                    }
                  >
                    {isMissingValuesActive
                      ? "Update Missing Values Step"
                      : "Add Missing Values Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Sort Rows"
                subtitle="Apply deterministic row ordering"
                open={expandedTransformPanel === "sort"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "sort" ? null : "sort"
                  )
                }
              >
                <div className="inline-row filter-builder-row">
                  <label htmlFor="sort-column">Sort Column</label>
                  <select
                    id="sort-column"
                    value={sortColumn}
                    disabled={availableColumns.length === 0}
                    onChange={(event) => setSortColumn(event.target.value)}
                  >
                    {availableColumns.length === 0 ? (
                      <option value="">No columns</option>
                    ) : (
                      availableColumns.map((column) => (
                        <option key={`sort-${column}`} value={column}>
                          {column}
                        </option>
                      ))
                    )}
                  </select>

                  <label htmlFor="sort-direction">Direction</label>
                  <select
                    id="sort-direction"
                    value={sortDirection}
                    onChange={(event) =>
                      setSortDirection(
                        event.target.value as SortRowsStep["params"]["direction"]
                      )
                    }
                  >
                    <option value="asc">ASC</option>
                    <option value="desc">DESC</option>
                  </select>

                  <label htmlFor="sort-nulls">Nulls</label>
                  <select
                    id="sort-nulls"
                    value={sortNulls}
                    onChange={(event) =>
                      setSortNulls(event.target.value as SortRowsStep["params"]["nulls"])
                    }
                  >
                    <option value="last">LAST</option>
                    <option value="first">FIRST</option>
                  </select>

                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={!sortColumn}
                    onClick={() =>
                      onSaveSortRowsStep({
                        column: sortColumn,
                        direction: sortDirection,
                        nulls: sortNulls
                      })
                    }
                  >
                    {isSortRowsActive ? "Update Sort Step" : "Add Sort Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Type Cast and Date Parsing"
                subtitle="Convert column types with optional date format parsing"
                open={expandedTransformPanel === "cast"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "cast" ? null : "cast"
                  )
                }
              >
                <div className="inline-row filter-builder-row">
                  <label htmlFor="cast-column">Column</label>
                  <select
                    id="cast-column"
                    value={castColumn}
                    disabled={availableColumns.length === 0}
                    onChange={(event) => setCastColumn(event.target.value)}
                  >
                    {availableColumns.length === 0 ? (
                      <option value="">No columns</option>
                    ) : (
                      availableColumns.map((column) => (
                        <option key={`cast-${column}`} value={column}>
                          {column}
                        </option>
                      ))
                    )}
                  </select>

                  <label htmlFor="cast-target-type">Target Type</label>
                  <input
                    id="cast-target-type"
                    type="text"
                    value={castTargetType}
                    onChange={(event) => setCastTargetType(event.target.value)}
                    placeholder="DOUBLE"
                    list="cast-type-options"
                  />
                  <datalist id="cast-type-options">
                    <option value="BOOLEAN" />
                    <option value="TINYINT" />
                    <option value="SMALLINT" />
                    <option value="INTEGER" />
                    <option value="BIGINT" />
                    <option value="DOUBLE" />
                    <option value="DECIMAL(18,4)" />
                    <option value="VARCHAR" />
                    <option value="DATE" />
                    <option value="TIMESTAMP" />
                  </datalist>

                  <label htmlFor="cast-output-column">Output Column</label>
                  <input
                    id="cast-output-column"
                    type="text"
                    value={castOutputColumn}
                    onChange={(event) => setCastOutputColumn(event.target.value)}
                    placeholder="(blank = replace source)"
                  />

                  <label htmlFor="cast-date-format">Date Format</label>
                  <input
                    id="cast-date-format"
                    type="text"
                    value={castDateFormat}
                    onChange={(event) => setCastDateFormat(event.target.value)}
                    placeholder="%Y-%m-%d (optional)"
                  />

                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={!castColumn || !castTargetType.trim()}
                    onClick={() =>
                      onSaveCastColumnStep({
                        column: castColumn,
                        targetType: castTargetType,
                        outputColumn: castOutputColumn,
                        dateFormat: castDateFormat
                      })
                    }
                  >
                    {isCastColumnActive ? "Update Cast Step" : "Add Cast Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Scale Numeric Column"
                subtitle="Create z-score or min-max scaled columns"
                open={expandedTransformPanel === "scale"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "scale" ? null : "scale"
                  )
                }
              >
                <div className="inline-row filter-builder-row">
                  <label htmlFor="scale-column">Source Column</label>
                  <select
                    id="scale-column"
                    value={scaleColumn}
                    disabled={availableColumns.length === 0}
                    onChange={(event) => {
                      const nextColumn = event.target.value;
                      setScaleColumn(nextColumn);
                      setScaleOutputColumn(`${nextColumn}_${scaleMethod}`);
                    }}
                  >
                    {availableColumns.length === 0 ? (
                      <option value="">No columns</option>
                    ) : (
                      availableColumns.map((column) => (
                        <option key={`scale-${column}`} value={column}>
                          {column}
                        </option>
                      ))
                    )}
                  </select>

                  <label htmlFor="scale-method">Method</label>
                  <select
                    id="scale-method"
                    value={scaleMethod}
                    onChange={(event) => {
                      const nextMethod =
                        event.target.value as ScaleNumericStep["params"]["method"];
                      setScaleMethod(nextMethod);
                      if (scaleColumn) {
                        setScaleOutputColumn(`${scaleColumn}_${nextMethod}`);
                      }
                    }}
                  >
                    <option value="zscore">Z-score</option>
                    <option value="minmax">Min-max [0, 1]</option>
                  </select>

                  <label htmlFor="scale-output-column">Output Column</label>
                  <input
                    id="scale-output-column"
                    type="text"
                    value={scaleOutputColumn}
                    onChange={(event) => setScaleOutputColumn(event.target.value)}
                    placeholder={scaleColumn ? `${scaleColumn}_${scaleMethod}` : "scaled_value"}
                  />

                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={!scaleColumn || !scaleOutputColumn.trim()}
                    onClick={() =>
                      onSaveScaleNumericStep({
                        column: scaleColumn,
                        method: scaleMethod,
                        outputColumn: scaleOutputColumn
                      })
                    }
                  >
                    {isScaleNumericActive ? "Update Scale Step" : "Add Scale Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Create Dummy Variables"
                subtitle="One-hot categorical columns"
                open={expandedTransformPanel === "dummy"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "dummy" ? null : "dummy"
                  )
                }
              >
                <div className="inline-row filter-builder-row">
                  <label htmlFor="dummy-source-column">Source Column</label>
                  <select
                    id="dummy-source-column"
                    value={dummySourceColumn}
                    disabled={availableColumns.length === 0}
                    onChange={(event) => setDummySourceColumn(event.target.value)}
                  >
                    {availableColumns.length === 0 ? (
                      <option value="">No columns</option>
                    ) : (
                      availableColumns.map((column) => (
                        <option key={`dummy-${column}`} value={column}>
                          {column}
                        </option>
                      ))
                    )}
                  </select>

                  <label htmlFor="dummy-prefix">Prefix</label>
                  <input
                    id="dummy-prefix"
                    type="text"
                    value={dummyPrefix}
                    onChange={(event) => setDummyPrefix(event.target.value)}
                    placeholder={dummySourceColumn || "dummy"}
                  />

                  <label className="checkbox-label compact" htmlFor="dummy-drop-one">
                    <input
                      id="dummy-drop-one"
                      type="checkbox"
                      checked={dummyDropOne}
                      onChange={(event) => setDummyDropOne(event.target.checked)}
                    />
                    Drop one category
                  </label>

                  {dummyDropOne ? (
                    <>
                      <label htmlFor="dummy-drop-category">Drop Category</label>
                      <input
                        id="dummy-drop-category"
                        type="text"
                        value={dummyDropCategory}
                        onChange={(event) => setDummyDropCategory(event.target.value)}
                        placeholder="Optional (defaults to first category)"
                      />
                    </>
                  ) : null}

                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={!dummySourceColumn}
                    onClick={() =>
                      onSaveDummyVariablesStep({
                        sourceColumn: dummySourceColumn,
                        prefix: dummyPrefix,
                        dropOne: dummyDropOne,
                        dropCategory: dummyDropCategory
                      })
                    }
                  >
                    {isDummyVariablesActive
                      ? "Update Dummy Variable Step"
                      : "Add Dummy Variable Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Group and Aggregate"
                subtitle="Group-by columns with aggregate expressions"
                open={expandedTransformPanel === "group"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "group" ? null : "group"
                  )
                }
              >
                <div className="columns-checklist">
                  {availableColumns.length === 0 ? (
                    <span className="hint-line">No columns available.</span>
                  ) : (
                    availableColumns.map((column) => (
                      <label key={`group-by-${column}`} className="checkbox-label compact">
                        <input
                          type="checkbox"
                          checked={groupByColumns.includes(column)}
                          onChange={(event) => {
                            setGroupByColumns((current) => {
                              if (event.target.checked) {
                                return [...current, column];
                              }
                              return current.filter((value) => value !== column);
                            });
                          }}
                        />
                        Group by {column}
                      </label>
                    ))
                  )}
                </div>
                {groupAggregates.map((aggregate, index) => (
                  <div key={`aggregate-${index}`} className="inline-row filter-builder-row">
                    <label htmlFor={`aggregate-expression-${index}`}>
                      Aggregate Expression {index + 1}
                    </label>
                    <input
                      id={`aggregate-expression-${index}`}
                      type="text"
                      value={aggregate.expression}
                      onChange={(event) =>
                        setGroupAggregates((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, expression: event.target.value }
                              : entry
                          )
                        )
                      }
                      placeholder="SUM(amount)"
                    />
                    <label htmlFor={`aggregate-alias-${index}`}>Alias {index + 1}</label>
                    <input
                      id={`aggregate-alias-${index}`}
                      type="text"
                      value={aggregate.alias}
                      onChange={(event) =>
                        setGroupAggregates((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, alias: event.target.value }
                              : entry
                          )
                        )
                      }
                      placeholder="sum_amount"
                    />
                    {groupAggregates.length > 1 ? (
                      <button
                        type="button"
                        className="btn btn-ghost compact"
                        onClick={() =>
                          setGroupAggregates((current) =>
                            current.filter((_, entryIndex) => entryIndex !== index)
                          )
                        }
                      >
                        Remove Aggregate
                      </button>
                    ) : null}
                  </div>
                ))}
                <div className="inline-row">
                  <button
                    type="button"
                    className="btn btn-ghost compact"
                    onClick={() =>
                      setGroupAggregates((current) => [
                        ...current,
                        {
                          expression: "",
                          alias: ""
                        }
                      ])
                    }
                  >
                    Add Aggregate
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={
                      groupAggregates.filter(
                        (aggregate) =>
                          aggregate.expression.trim().length > 0 &&
                          aggregate.alias.trim().length > 0
                      ).length === 0
                    }
                    onClick={() =>
                      onSaveGroupAggregateStep({
                        groupBy: groupByColumns,
                        aggregates: groupAggregates
                          .map((aggregate) => ({
                            expression: aggregate.expression.trim(),
                            alias: aggregate.alias.trim()
                          }))
                          .filter(
                            (aggregate) =>
                              aggregate.expression.length > 0 &&
                              aggregate.alias.length > 0
                          )
                      })
                    }
                  >
                    {isGroupAggregateActive
                      ? "Update Group Aggregate Step"
                      : "Add Group Aggregate Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Join Tables"
                subtitle="Join current results to another table"
                open={expandedTransformPanel === "join"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "join" ? null : "join"
                  )
                }
              >
                <div className="inline-row filter-builder-row">
                  <label htmlFor="join-right-table">Right Table</label>
                  <select
                    id="join-right-table"
                    value={joinRightTable}
                    disabled={tableColumnOptions.length === 0}
                    onChange={(event) => setJoinRightTable(event.target.value)}
                  >
                    {tableColumnOptions.length === 0 ? (
                      <option value="">No tables</option>
                    ) : (
                      tableColumnOptions.map((table) => (
                        <option key={`join-table-${table.tableName}`} value={table.tableName}>
                          {table.tableName}
                        </option>
                      ))
                    )}
                  </select>

                  <label htmlFor="join-type">Join Type</label>
                  <select
                    id="join-type"
                    value={joinType}
                    onChange={(event) =>
                      setJoinType(event.target.value as JoinStep["params"]["joinType"])
                    }
                  >
                    <option value="inner">INNER</option>
                    <option value="left">LEFT</option>
                    <option value="right">RIGHT</option>
                    <option value="full">FULL</option>
                  </select>
                </div>

                {joinConditions.map((condition, index) => (
                  <div key={`join-condition-${index}`} className="inline-row filter-builder-row">
                    <label htmlFor={`join-left-column-${index}`}>Left Column</label>
                    <select
                      id={`join-left-column-${index}`}
                      value={condition.leftColumn}
                      disabled={availableColumns.length === 0}
                      onChange={(event) =>
                        setJoinConditions((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  leftColumn: event.target.value
                                }
                              : entry
                          )
                        )
                      }
                    >
                      {availableColumns.length === 0 ? (
                        <option value="">No columns</option>
                      ) : (
                        availableColumns.map((column) => (
                          <option key={`join-left-${index}-${column}`} value={column}>
                            {column}
                          </option>
                        ))
                      )}
                    </select>

                    <label htmlFor={`join-operator-${index}`}>Operator</label>
                    <select
                      id={`join-operator-${index}`}
                      value={condition.operator}
                      onChange={(event) =>
                        setJoinConditions((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  operator:
                                    event.target.value as JoinStep["params"]["conditions"][number]["operator"]
                                }
                              : entry
                          )
                        )
                      }
                    >
                      <option value="=">=</option>
                      <option value="!=">!=</option>
                      <option value=">">&gt;</option>
                      <option value="<">&lt;</option>
                      <option value=">=">&gt;=</option>
                      <option value="<=">&lt;=</option>
                    </select>

                    <label htmlFor={`join-right-column-${index}`}>Right Column</label>
                    <select
                      id={`join-right-column-${index}`}
                      value={condition.rightColumn}
                      disabled={rightTableColumns.length === 0}
                      onChange={(event) =>
                        setJoinConditions((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  rightColumn: event.target.value
                                }
                              : entry
                          )
                        )
                      }
                    >
                      {rightTableColumns.length === 0 ? (
                        <option value="">No columns</option>
                      ) : (
                        rightTableColumns.map((column) => (
                          <option key={`join-right-${index}-${column}`} value={column}>
                            {column}
                          </option>
                        ))
                      )}
                    </select>

                    {joinConditions.length > 1 ? (
                      <button
                        type="button"
                        className="btn btn-ghost compact"
                        onClick={() =>
                          setJoinConditions((current) =>
                            current.filter((_, entryIndex) => entryIndex !== index)
                          )
                        }
                      >
                        Remove Condition
                      </button>
                    ) : null}
                  </div>
                ))}

                <div className="inline-row">
                  <button
                    type="button"
                    className="btn btn-ghost compact"
                    onClick={() =>
                      setJoinConditions((current) => [
                        ...current,
                        {
                          leftColumn: availableColumns[0] ?? "",
                          operator: "=",
                          rightColumn: rightTableColumns[0] ?? ""
                        }
                      ])
                    }
                  >
                    Add Condition
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={
                      !joinRightTable ||
                      joinConditions.length === 0 ||
                      joinConditions.some(
                        (condition) => !condition.leftColumn || !condition.rightColumn
                      )
                    }
                    onClick={() =>
                      onSaveJoinStep({
                        rightTable: joinRightTable,
                        joinType,
                        conditions: joinConditions
                          .map((condition) => ({
                            leftColumn: condition.leftColumn.trim(),
                            operator: condition.operator,
                            rightColumn: condition.rightColumn.trim()
                          }))
                          .filter(
                            (condition) =>
                              condition.leftColumn.length > 0 &&
                              condition.rightColumn.length > 0
                          )
                      })
                    }
                  >
                    {isJoinActive ? "Update Join Step" : "Add Join Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="Pivot Table"
                subtitle="Pivot one column into deterministic output columns"
                open={expandedTransformPanel === "pivot"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "pivot" ? null : "pivot"
                  )
                }
              >
                <div className="columns-checklist">
                  {availableColumns.length === 0 ? (
                    <span className="hint-line">No columns available.</span>
                  ) : (
                    availableColumns.map((column) => (
                      <label key={`pivot-index-${column}`} className="checkbox-label compact">
                        <input
                          type="checkbox"
                          checked={pivotIndexColumns.includes(column)}
                          onChange={(event) =>
                            setPivotIndexColumns((current) => {
                              if (event.target.checked) {
                                return [...current, column];
                              }
                              return current.filter((value) => value !== column);
                            })
                          }
                        />
                        Index: {column}
                      </label>
                    ))
                  )}
                </div>

                <div className="inline-row filter-builder-row">
                  <label htmlFor="pivot-column">Pivot Column</label>
                  <select
                    id="pivot-column"
                    value={pivotColumn}
                    disabled={availableColumns.length === 0}
                    onChange={(event) => setPivotColumn(event.target.value)}
                  >
                    {availableColumns.length === 0 ? (
                      <option value="">No columns</option>
                    ) : (
                      availableColumns.map((column) => (
                        <option key={`pivot-column-${column}`} value={column}>
                          {column}
                        </option>
                      ))
                    )}
                  </select>

                  <label htmlFor="pivot-value-column">Value Column</label>
                  <select
                    id="pivot-value-column"
                    value={pivotValueColumn}
                    disabled={availableColumns.length === 0}
                    onChange={(event) => setPivotValueColumn(event.target.value)}
                  >
                    {availableColumns.length === 0 ? (
                      <option value="">No columns</option>
                    ) : (
                      availableColumns.map((column) => (
                        <option key={`pivot-value-column-${column}`} value={column}>
                          {column}
                        </option>
                      ))
                    )}
                  </select>

                  <label htmlFor="pivot-aggregate">Aggregate</label>
                  <select
                    id="pivot-aggregate"
                    value={pivotAggregate}
                    onChange={(event) =>
                      setPivotAggregate(
                        event.target.value as PivotStep["params"]["aggregate"]
                      )
                    }
                  >
                    <option value="sum">SUM</option>
                    <option value="avg">AVG</option>
                    <option value="min">MIN</option>
                    <option value="max">MAX</option>
                    <option value="count">COUNT</option>
                  </select>

                  <button
                    type="button"
                    className="btn btn-secondary compact"
                    disabled={!pivotColumn || !pivotValueColumn}
                    onClick={() =>
                      onSavePivotStep({
                        indexColumns: pivotIndexColumns,
                        pivotColumn,
                        valueColumn: pivotValueColumn,
                        aggregate: pivotAggregate
                      })
                    }
                  >
                    {isPivotActive ? "Update Pivot Step" : "Add Pivot Step"}
                  </button>
                </div>
              </AccordionCard>

              <AccordionCard
                title="SQL Transform"
                subtitle="SQL transform step"
                open={expandedTransformPanel === "sql"}
                onToggle={() =>
                  setExpandedTransformPanel((current) =>
                    current === "sql" ? null : "sql"
                  )
                }
              >
                <label htmlFor="transform-sql-editor" className="field-label inline-label">
                  SQL Transform
                </label>
                <textarea
                  id="transform-sql-editor"
                  className="sql-editor work-sql-editor"
                  spellCheck={false}
                  value={sql}
                  onChange={(event) => onSqlChange(event.target.value)}
                  placeholder={`SELECT * FROM ${transformTableName ?? "source"} LIMIT 100`}
                />

                <div className="inline-row">
                  <button type="button" className="btn btn-secondary" onClick={onAddSqlStep}>
                    Add SQL Step
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onUpdatePipelineSqlStep}
                    disabled={!activePipelineStep || activePipelineStep.type !== "SQLTransformStep"}
                  >
                    Update Step SQL
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={onRunPipeline}>
                    Run Pipeline
                  </button>
                </div>
              </AccordionCard>
            </>
          )}
        </div>
      )}

      {workTab === "statistics" && (
        <div className="pane-body scroll-pane">
          <div className="inline-row">
            <label htmlFor="statistics-target">Run against:</label>
            <select
              id="statistics-target"
              value={selectedTargetKey}
              disabled={targetOptions.length === 0}
              onChange={(event) => onTargetChange(event.target.value)}
            >
              {targetOptions.length === 0 ? (
                <option value="">No targets available</option>
              ) : (
                targetOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="hint-line">
            Target: {queryTarget ? formatQueryTarget(queryTarget) : "None selected"}
          </div>

          <AccordionCard
            title="Visualization"
            subtitle="Interactive chart output"
            open={expandedStatisticsPanel === "visualization"}
            onToggle={() =>
              setExpandedStatisticsPanel((current) =>
                current === "visualization" ? null : "visualization"
              )
            }
          >
            <div className="inline-row filter-builder-row">
              <label htmlFor="chart-type">Chart Type</label>
              <select
                id="chart-type"
                value={chartType}
                onChange={(event) =>
                  setChartType(event.target.value as NotebookChartType)
                }
              >
                <option value="line">Line</option>
                <option value="scatter">Scatter</option>
                <option value="bar">Bar</option>
                <option value="histogram">Histogram</option>
              </select>

              <label htmlFor="chart-x-column">
                {chartType === "histogram" ? "Value Column" : "X Column"}
              </label>
              <select
                id="chart-x-column"
                value={chartXColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setChartXColumn(event.target.value)}
              >
                {statisticsAvailableColumns.length === 0 ? (
                  <option value="">No columns</option>
                ) : (
                  statisticsAvailableColumns.map((column) => (
                    <option key={`chart-x-${column}`} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>

              {chartType === "histogram" ? (
                <>
                  <label htmlFor="chart-histogram-bins">Bins</label>
                  <input
                    id="chart-histogram-bins"
                    type="number"
                    min={1}
                    step={1}
                    value={chartHistogramBins}
                    onChange={(event) => setChartHistogramBins(event.target.value)}
                    placeholder="20"
                  />
                </>
              ) : (
                <>
                  <label htmlFor="chart-y-column">Y Column</label>
                  <select
                    id="chart-y-column"
                    value={chartYColumn}
                    disabled={statisticsAvailableColumns.length === 0}
                    onChange={(event) => setChartYColumn(event.target.value)}
                  >
                    {statisticsAvailableColumns.length === 0 ? (
                      <option value="">No columns</option>
                    ) : (
                      statisticsAvailableColumns.map((column) => (
                        <option key={`chart-y-${column}`} value={column}>
                          {column}
                        </option>
                      ))
                    )}
                  </select>
                </>
              )}

              <label htmlFor="chart-series-column">Series (Optional)</label>
              <select
                id="chart-series-column"
                value={chartSeriesColumn}
                disabled={statisticsAvailableColumns.length === 0 || chartType === "bar"}
                onChange={(event) => setChartSeriesColumn(event.target.value)}
              >
                <option value="">None</option>
                {statisticsAvailableColumns.map((column) => (
                  <option key={`chart-series-${column}`} value={column}>
                    {column}
                  </option>
                ))}
              </select>

              <label htmlFor="chart-facet-column">Facet (Optional)</label>
              <select
                id="chart-facet-column"
                value={chartFacetColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setChartFacetColumn(event.target.value)}
              >
                <option value="">None</option>
                {statisticsAvailableColumns.map((column) => (
                  <option key={`chart-facet-${column}`} value={column}>
                    {column}
                  </option>
                ))}
              </select>

              <label htmlFor="chart-title">Chart Title</label>
              <input
                id="chart-title"
                type="text"
                value={chartTitle}
                onChange={(event) => setChartTitle(event.target.value)}
                placeholder="Optional"
              />

              <label htmlFor="chart-x-axis-label">X Axis Label</label>
              <input
                id="chart-x-axis-label"
                type="text"
                value={chartXAxisLabel}
                onChange={(event) => setChartXAxisLabel(event.target.value)}
                placeholder={chartXColumn || "x"}
              />

              <label htmlFor="chart-y-axis-label">Y Axis Label</label>
              <input
                id="chart-y-axis-label"
                type="text"
                value={chartYAxisLabel}
                onChange={(event) => setChartYAxisLabel(event.target.value)}
                placeholder={chartType === "histogram" ? "count" : chartYColumn || "y"}
              />

              <label className="checkbox-label">
                <input
                  id="chart-auto-range"
                  type="checkbox"
                  checked={chartAutoRange}
                  onChange={(event) => setChartAutoRange(event.target.checked)}
                />
                All data visible
              </label>

              <label htmlFor="chart-x-min">X Min</label>
              <input
                id="chart-x-min"
                type="text"
                value={chartXMin}
                disabled={chartAutoRange}
                onChange={(event) => setChartXMin(event.target.value)}
                placeholder="auto"
              />

              <label htmlFor="chart-x-max">X Max</label>
              <input
                id="chart-x-max"
                type="text"
                value={chartXMax}
                disabled={chartAutoRange}
                onChange={(event) => setChartXMax(event.target.value)}
                placeholder="auto"
              />

              <label htmlFor="chart-y-min">Y Min</label>
              <input
                id="chart-y-min"
                type="text"
                value={chartYMin}
                disabled={chartAutoRange}
                onChange={(event) => setChartYMin(event.target.value)}
                placeholder="auto"
              />

              <label htmlFor="chart-y-max">Y Max</label>
              <input
                id="chart-y-max"
                type="text"
                value={chartYMax}
                disabled={chartAutoRange}
                onChange={(event) => setChartYMax(event.target.value)}
                placeholder="auto"
              />

              <label className="checkbox-label">
                <input
                  id="chart-show-best-fit"
                  type="checkbox"
                  checked={chartShowBestFitLine}
                  disabled={chartType === "bar" || chartType === "histogram"}
                  onChange={(event) => setChartShowBestFitLine(event.target.checked)}
                />
                Show best-fit line
              </label>

              <button
                type="button"
                className="btn btn-secondary compact"
                disabled={
                  !chartXColumn ||
                  (chartType !== "histogram" && !chartYColumn) ||
                  chartHistogramBinsInvalid ||
                  chartRangeInputInvalid ||
                  chartRangeOrderInvalid
                }
                onClick={() =>
                  onCreateChart({
                    chartType,
                    xColumn: chartXColumn,
                    yColumn: chartType === "histogram" ? "count" : chartYColumn,
                    seriesColumn: chartSeriesColumn || undefined,
                    facetColumn: chartFacetColumn || undefined,
                    title: chartTitle.trim() || undefined,
                    xAxisLabel: chartXAxisLabel.trim() || undefined,
                    yAxisLabel: chartYAxisLabel.trim() || undefined,
                    autoRange: chartAutoRange,
                    xMin: parsedChartXMin,
                    xMax: parsedChartXMax,
                    yMin: parsedChartYMin,
                    yMax: parsedChartYMax,
                    showBestFitLine: chartShowBestFitLine,
                    histogramBins:
                      chartType === "histogram" ? parsedHistogramBins : undefined
                  })
                }
              >
                Create Visualization
              </button>
              {(chartHistogramBinsInvalid || chartRangeInputInvalid || chartRangeOrderInvalid) && (
                <span className="hint-line">
                  {chartHistogramBinsInvalid
                    ? "Histogram bins must be a positive integer."
                    : "Enter valid numeric axis bounds with min values lower than max values."}
                </span>
              )}
            </div>
          </AccordionCard>

          <AccordionCard
            title="Welch t-test"
            subtitle="Two-sample mean comparison"
            open={expandedStatisticsPanel === "welch"}
            onToggle={() =>
              setExpandedStatisticsPanel((current) =>
                current === "welch" ? null : "welch"
              )
            }
          >
            <div className="inline-row filter-builder-row">
              <label htmlFor="welch-value-column">Welch Value</label>
              <select
                id="welch-value-column"
                value={welchValueColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setWelchValueColumn(event.target.value)}
              >
                {statisticsAvailableColumns.length === 0 ? (
                  <option value="">No columns</option>
                ) : (
                  statisticsAvailableColumns.map((column) => (
                    <option key={`welch-value-${column}`} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>

              <label htmlFor="welch-group-column">Welch Group</label>
              <select
                id="welch-group-column"
                value={welchGroupColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setWelchGroupColumn(event.target.value)}
              >
                {statisticsAvailableColumns.length === 0 ? (
                  <option value="">No columns</option>
                ) : (
                  statisticsAvailableColumns.map((column) => (
                    <option key={`welch-group-${column}`} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>

              <label htmlFor="welch-group-a">Group A</label>
              <input
                id="welch-group-a"
                type="text"
                value={welchGroupA}
                onChange={(event) => setWelchGroupA(event.target.value)}
                placeholder="control"
              />

              <label htmlFor="welch-group-b">Group B</label>
              <input
                id="welch-group-b"
                type="text"
                value={welchGroupB}
                onChange={(event) => setWelchGroupB(event.target.value)}
                placeholder="treatment"
              />

              <button
                type="button"
                className="btn btn-secondary compact"
                disabled={
                  !welchValueColumn ||
                  !welchGroupColumn ||
                  !welchGroupA.trim() ||
                  !welchGroupB.trim()
                }
                onClick={() =>
                  onRunWelchTTest({
                    valueColumn: welchValueColumn,
                    groupColumn: welchGroupColumn,
                    groupA: welchGroupA.trim(),
                    groupB: welchGroupB.trim()
                  })
                }
              >
                Run Welch t-test
              </button>
            </div>
          </AccordionCard>

          <AccordionCard
            title="Correlation"
            subtitle="Pearson (default), Kendall, or Spearman"
            open={expandedStatisticsPanel === "correlation"}
            onToggle={() =>
              setExpandedStatisticsPanel((current) =>
                current === "correlation" ? null : "correlation"
              )
            }
          >
            <div className="inline-row filter-builder-row">
              <label htmlFor="correlation-method">Method</label>
              <select
                id="correlation-method"
                value={correlationMethod}
                onChange={(event) =>
                  setCorrelationMethod(event.target.value as CorrelationMethod)
                }
              >
                <option value="pearson">Pearson</option>
                <option value="kendall">Kendall</option>
                <option value="spearman">Spearman</option>
              </select>

              <label htmlFor="pearson-x-column">X Column</label>
              <select
                id="pearson-x-column"
                value={pearsonXColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setPearsonXColumn(event.target.value)}
              >
                {statisticsAvailableColumns.length === 0 ? (
                  <option value="">No columns</option>
                ) : (
                  statisticsAvailableColumns.map((column) => (
                    <option key={`pearson-x-${column}`} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>

              <label htmlFor="pearson-y-column">Y Column</label>
              <select
                id="pearson-y-column"
                value={pearsonYColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setPearsonYColumn(event.target.value)}
              >
                {statisticsAvailableColumns.length === 0 ? (
                  <option value="">No columns</option>
                ) : (
                  statisticsAvailableColumns.map((column) => (
                    <option key={`pearson-y-${column}`} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>

              <button
                type="button"
                className="btn btn-secondary compact"
                disabled={!pearsonXColumn || !pearsonYColumn}
                onClick={() =>
                  onRunPearsonCorrelation({
                    xColumn: pearsonXColumn,
                    yColumn: pearsonYColumn,
                    method: correlationMethod
                  })
                }
              >
                Run Correlation
              </button>
            </div>
          </AccordionCard>

          <AccordionCard
            title="Chi-square test"
            subtitle="Categorical independence"
            open={expandedStatisticsPanel === "chi"}
            onToggle={() =>
              setExpandedStatisticsPanel((current) =>
                current === "chi" ? null : "chi"
              )
            }
          >
            <div className="inline-row filter-builder-row">
              <label htmlFor="chi-row-column">Chi-square Row</label>
              <select
                id="chi-row-column"
                value={chiRowColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setChiRowColumn(event.target.value)}
              >
                {statisticsAvailableColumns.length === 0 ? (
                  <option value="">No columns</option>
                ) : (
                  statisticsAvailableColumns.map((column) => (
                    <option key={`chi-row-${column}`} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>

              <label htmlFor="chi-column-column">Chi-square Column</label>
              <select
                id="chi-column-column"
                value={chiColumnColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setChiColumnColumn(event.target.value)}
              >
                {statisticsAvailableColumns.length === 0 ? (
                  <option value="">No columns</option>
                ) : (
                  statisticsAvailableColumns.map((column) => (
                    <option key={`chi-column-${column}`} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>

              <button
                type="button"
                className="btn btn-secondary compact"
                disabled={!chiRowColumn || !chiColumnColumn}
                onClick={() =>
                  onRunChiSquareTest({
                    rowColumn: chiRowColumn,
                    columnColumn: chiColumnColumn
                  })
                }
              >
                Run Chi-square
              </button>
            </div>
          </AccordionCard>

          <AccordionCard
            title="OLS Regression"
            subtitle="Linear model with optional one-hot encoding"
            open={expandedStatisticsPanel === "ols"}
            onToggle={() =>
              setExpandedStatisticsPanel((current) => (current === "ols" ? null : "ols"))
            }
          >
            <div className="inline-row filter-builder-row">
              <label htmlFor="ols-dependent-column">Dependent (Y)</label>
              <select
                id="ols-dependent-column"
                value={olsDependentColumn}
                disabled={statisticsAvailableColumns.length === 0}
                onChange={(event) => setOlsDependentColumn(event.target.value)}
              >
                {statisticsAvailableColumns.length === 0 ? (
                  <option value="">No columns</option>
                ) : (
                  statisticsAvailableColumns.map((column) => (
                    <option key={`ols-y-${column}`} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>

              <label className="checkbox-label compact" htmlFor="ols-intercept">
                <input
                  id="ols-intercept"
                  type="checkbox"
                  checked={olsIncludeIntercept}
                  onChange={(event) => setOlsIncludeIntercept(event.target.checked)}
                />
                Include intercept
              </label>

              <label className="checkbox-label compact" htmlFor="ols-one-hot">
                <input
                  id="ols-one-hot"
                  type="checkbox"
                  checked={olsOneHotEncodeCategorical}
                  onChange={(event) => setOlsOneHotEncodeCategorical(event.target.checked)}
                />
                One-hot categorical
              </label>
            </div>

            <div className="columns-checklist">
              {statisticsAvailableColumns
                .filter((column) => column !== olsDependentColumn)
                .map((column) => (
                  <label key={`ols-x-${column}`} className="checkbox-label compact">
                    <input
                      type="checkbox"
                      checked={olsIndependentColumns.includes(column)}
                      onChange={(event) => {
                        setOlsIndependentColumns((current) => {
                          if (event.target.checked) {
                            return [...current, column];
                          }
                          return current.filter((value) => value !== column);
                        });
                      }}
                    />
                    {column}
                  </label>
                ))}
            </div>

            <div className="inline-row">
              <button
                type="button"
                className="btn btn-secondary compact"
                disabled={
                  !olsDependentColumn.trim() || olsIndependentColumns.length === 0
                }
                onClick={() =>
                  onRunOLSRegression({
                    dependentColumn: olsDependentColumn,
                    independentColumns: olsIndependentColumns,
                    includeIntercept: olsIncludeIntercept,
                    oneHotEncodeCategorical: olsOneHotEncodeCategorical
                  })
                }
              >
                Run OLS Regression
              </button>
            </div>
          </AccordionCard>
        </div>
      )}

      <div className="status-line">{statusText}</div>
    </section>
  );
}
