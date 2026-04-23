import type { PipelineStep } from "../shared/types";

const FILTER_OPERATORS = new Set([
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "contains"
]);
const JOIN_TYPES = new Set(["inner", "left", "right", "full"]);
const JOIN_OPERATORS = new Set(["=", "!=", ">", "<", ">=", "<="]);
const PIVOT_AGGREGATES = new Set(["sum", "avg", "min", "max", "count"]);
const MISSING_MODES = new Set(["drop", "fill"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);
const NULLS_ORDER = new Set(["first", "last"]);
const SCALE_METHODS = new Set(["zscore", "minmax"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasBaseStepShape(value: unknown): value is {
  id: string;
  name: string;
  enabled: boolean;
  type: string;
  params: unknown;
} {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.type === "string" &&
    isRecord(value.params)
  );
}

export function isPipelineStep(value: unknown): value is PipelineStep {
  if (!hasBaseStepShape(value)) {
    return false;
  }

  const params = value.params as Record<string, unknown>;
  switch (value.type) {
    case "FilterStep":
      return (
        typeof params.column === "string" &&
        typeof params.value === "string" &&
        typeof params.operator === "string" &&
        FILTER_OPERATORS.has(params.operator)
      );
    case "SelectColumnsStep":
      return isStringArray(params.columns);
    case "MutateColumnStep":
      return (
        typeof params.expression === "string" &&
        typeof params.outputColumn === "string"
      );
    case "RemoveDuplicatesStep":
      return isStringArray(params.columns);
    case "MissingValuesStep":
      return (
        typeof params.mode === "string" &&
        MISSING_MODES.has(params.mode) &&
        isStringArray(params.columns) &&
        (params.fillValue === undefined || typeof params.fillValue === "string")
      );
    case "SortRowsStep":
      return (
        typeof params.column === "string" &&
        typeof params.direction === "string" &&
        SORT_DIRECTIONS.has(params.direction) &&
        typeof params.nulls === "string" &&
        NULLS_ORDER.has(params.nulls)
      );
    case "CastColumnStep":
      return (
        typeof params.column === "string" &&
        typeof params.targetType === "string" &&
        (params.outputColumn === undefined ||
          typeof params.outputColumn === "string") &&
        (params.dateFormat === undefined || typeof params.dateFormat === "string")
      );
    case "ScaleNumericStep":
      return (
        typeof params.column === "string" &&
        typeof params.outputColumn === "string" &&
        typeof params.method === "string" &&
        SCALE_METHODS.has(params.method)
      );
    case "DummyVariablesStep":
      return (
        typeof params.sourceColumn === "string" &&
        isStringArray(params.categories) &&
        (params.dropCategory === undefined ||
          params.dropCategory === null ||
          typeof params.dropCategory === "string") &&
        (params.prefix === undefined || typeof params.prefix === "string")
      );
    case "SQLTransformStep":
      return typeof params.sql === "string";
    case "GroupAggregateStep":
      return (
        isStringArray(params.groupBy) &&
        Array.isArray(params.aggregates) &&
        params.aggregates.every((aggregate) => {
          if (!isRecord(aggregate)) {
            return false;
          }
          return (
            typeof aggregate.expression === "string" &&
            typeof aggregate.alias === "string"
          );
        })
      );
    case "JoinStep":
      return (
        typeof params.rightTable === "string" &&
        typeof params.joinType === "string" &&
        JOIN_TYPES.has(params.joinType) &&
        Array.isArray(params.conditions) &&
        params.conditions.every((condition) => {
          if (!isRecord(condition)) {
            return false;
          }
          return (
            typeof condition.leftColumn === "string" &&
            typeof condition.rightColumn === "string" &&
            typeof condition.operator === "string" &&
            JOIN_OPERATORS.has(condition.operator)
          );
        })
      );
    case "PivotStep":
      return (
        isStringArray(params.indexColumns) &&
        typeof params.pivotColumn === "string" &&
        typeof params.valueColumn === "string" &&
        typeof params.aggregate === "string" &&
        PIVOT_AGGREGATES.has(params.aggregate) &&
        (params.pivotValues === undefined || isStringArray(params.pivotValues))
      );
    default:
      return false;
  }
}

export function normalizePipelineSteps(raw: unknown): PipelineStep[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isPipelineStep);
}
