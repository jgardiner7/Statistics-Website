import type {
  CastColumnStep,
  DummyVariablesStep,
  FilterStep,
  GroupAggregateStep,
  JoinStep,
  MissingValuesStep,
  MutateColumnStep,
  PipelineStep,
  PivotStep,
  RemoveDuplicatesStep,
  ScaleNumericStep,
  SelectColumnsStep,
  SortRowsStep,
  SQLTransformStep
} from "./types";
import { quoteIdentifier, quoteLiteral, sanitizeIdentifier } from "../shared/sql";

function stepAlias(stepId: string, index: number): string {
  const normalized = stepId.trim().replace(/[^A-Za-z0-9_]/g, "_");
  if (!normalized) {
    return `step_${index + 1}`;
  }
  return `step_${normalized}`;
}

function compileFilterStep(step: FilterStep, upstreamTable: string): string {
  const column = quoteIdentifier(step.params.column);
  const value = quoteLiteral(step.params.value);

  if (step.params.operator === "contains") {
    return `SELECT * FROM ${quoteIdentifier(upstreamTable)} WHERE ${column} ILIKE '%' || ${value} || '%'`;
  }

  return `SELECT * FROM ${quoteIdentifier(upstreamTable)} WHERE ${column} ${step.params.operator} ${value}`;
}

function compileSelectStep(
  step: SelectColumnsStep,
  upstreamTable: string
): string {
  const selected = step.params.columns.map((column) => quoteIdentifier(column));
  const projection = selected.length > 0 ? selected.join(", ") : "*";
  return `SELECT ${projection} FROM ${quoteIdentifier(upstreamTable)}`;
}

function compileMutateStep(
  step: MutateColumnStep,
  upstreamTable: string
): string {
  return `SELECT *, (${step.params.expression}) AS ${quoteIdentifier(
    step.params.outputColumn
  )} FROM ${quoteIdentifier(upstreamTable)}`;
}

function compileRemoveDuplicatesStep(
  step: RemoveDuplicatesStep,
  upstreamTable: string
): string {
  const columns = Array.from(
    new Set(
      step.params.columns
        .map((column) => column.trim())
        .filter((column) => column.length > 0)
    )
  );
  if (columns.length === 0) {
    return `SELECT DISTINCT * FROM ${quoteIdentifier(upstreamTable)}`;
  }
  const partitionBy = columns.map((column) => quoteIdentifier(column)).join(", ");
  return `SELECT * EXCLUDE ("_sf_dupe_rank") FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY ${partitionBy}) AS "_sf_dupe_rank" FROM ${quoteIdentifier(
    upstreamTable
  )}) WHERE "_sf_dupe_rank" = 1`;
}

function compileMissingValuesStep(
  step: MissingValuesStep,
  upstreamTable: string
): string {
  const columns = Array.from(
    new Set(
      step.params.columns
        .map((column) => column.trim())
        .filter((column) => column.length > 0)
    )
  );
  if (columns.length === 0) {
    throw new Error("MissingValuesStep requires at least one column.");
  }
  if (step.params.mode === "drop") {
    const predicate = columns
      .map((column) => `${quoteIdentifier(column)} IS NOT NULL`)
      .join(" AND ");
    return `SELECT * FROM ${quoteIdentifier(upstreamTable)} WHERE ${predicate}`;
  }
  const fillLiteral = quoteLiteral(step.params.fillValue ?? "");
  const replacements = columns
    .map(
      (column) =>
        `COALESCE(${quoteIdentifier(column)}, ${fillLiteral}) AS ${quoteIdentifier(column)}`
    )
    .join(", ");
  return `SELECT * REPLACE (${replacements}) FROM ${quoteIdentifier(upstreamTable)}`;
}

function compileSortRowsStep(step: SortRowsStep, upstreamTable: string): string {
  const column = step.params.column.trim();
  if (!column) {
    throw new Error("SortRowsStep requires a sort column.");
  }
  const direction = step.params.direction.toUpperCase();
  const nulls = step.params.nulls.toUpperCase();
  return `SELECT * FROM ${quoteIdentifier(upstreamTable)} ORDER BY ${quoteIdentifier(
    column
  )} ${direction} NULLS ${nulls}`;
}

function normalizeDuckDbType(targetType: string): string {
  const normalized = targetType.trim().toUpperCase();
  if (!normalized) {
    throw new Error("CastColumnStep target type cannot be empty.");
  }
  if (!/^[A-Z0-9_,()\s]+$/.test(normalized)) {
    throw new Error(`Unsupported cast target type: ${targetType}`);
  }
  return normalized;
}

function compileCastColumnStep(
  step: CastColumnStep,
  upstreamTable: string
): string {
  const column = step.params.column.trim();
  if (!column) {
    throw new Error("CastColumnStep requires a source column.");
  }
  const targetType = normalizeDuckDbType(step.params.targetType);
  const outputColumn = (step.params.outputColumn ?? column).trim() || column;
  const columnRef = quoteIdentifier(column);
  const dateFormat = step.params.dateFormat?.trim();
  let expression: string;
  if (dateFormat) {
    const parsed = `TRY_STRPTIME(CAST(${columnRef} AS VARCHAR), ${quoteLiteral(
      dateFormat
    )})`;
    expression =
      targetType === "DATE" || targetType === "TIMESTAMP"
        ? `CAST(${parsed} AS ${targetType})`
        : `TRY_CAST(${parsed} AS ${targetType})`;
  } else {
    expression = `TRY_CAST(${columnRef} AS ${targetType})`;
  }

  if (outputColumn === column) {
    return `SELECT * REPLACE (${expression} AS ${quoteIdentifier(column)}) FROM ${quoteIdentifier(
      upstreamTable
    )}`;
  }
  return `SELECT *, ${expression} AS ${quoteIdentifier(outputColumn)} FROM ${quoteIdentifier(
    upstreamTable
  )}`;
}

function compileScaleNumericStep(
  step: ScaleNumericStep,
  upstreamTable: string
): string {
  const column = step.params.column.trim();
  const outputColumn = step.params.outputColumn.trim();
  if (!column || !outputColumn) {
    throw new Error("ScaleNumericStep requires source and output columns.");
  }
  const numeric = `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)`;
  const expression =
    step.params.method === "zscore"
      ? `(${numeric} - AVG(${numeric}) OVER ()) / NULLIF(STDDEV_SAMP(${numeric}) OVER (), 0)`
      : `(${numeric} - MIN(${numeric}) OVER ()) / NULLIF(MAX(${numeric}) OVER () - MIN(${numeric}) OVER (), 0)`;

  if (outputColumn === column) {
    return `SELECT * REPLACE (${expression} AS ${quoteIdentifier(column)}) FROM ${quoteIdentifier(
      upstreamTable
    )}`;
  }
  return `SELECT *, ${expression} AS ${quoteIdentifier(outputColumn)} FROM ${quoteIdentifier(
    upstreamTable
  )}`;
}

function compileDummyVariablesStep(
  step: DummyVariablesStep,
  upstreamTable: string
): string {
  const sourceColumn = step.params.sourceColumn.trim();
  if (!sourceColumn) {
    throw new Error("DummyVariablesStep requires a source column.");
  }
  const categories = Array.from(
    new Set(
      step.params.categories
        .map((category) => category.trim())
        .filter((category) => category.length > 0)
    )
  );
  if (categories.length === 0) {
    throw new Error("DummyVariablesStep requires at least one category.");
  }

  const dropCategory = step.params.dropCategory?.trim();
  const keptCategories = dropCategory
    ? categories.filter((category) => category !== dropCategory)
    : categories;
  if (keptCategories.length === 0) {
    throw new Error("DummyVariablesStep cannot drop all categories.");
  }

  const prefixBase = sanitizeIdentifier(step.params.prefix?.trim() || sourceColumn);
  const aliasCounts = new Map<string, number>();
  const expressions = keptCategories.map((category) => {
    const normalizedCategory = sanitizeIdentifier(category);
    const baseAlias = `${prefixBase}_${normalizedCategory}`;
    const usedCount = aliasCounts.get(baseAlias) ?? 0;
    aliasCounts.set(baseAlias, usedCount + 1);
    const alias =
      usedCount === 0 ? baseAlias : `${baseAlias}_${usedCount + 1}`;
    return `CASE WHEN CAST(${quoteIdentifier(sourceColumn)} AS VARCHAR) = ${quoteLiteral(
      category
    )} THEN 1 ELSE 0 END AS ${quoteIdentifier(alias)}`;
  });

  return `SELECT *, ${expressions.join(", ")} FROM ${quoteIdentifier(upstreamTable)}`;
}

function compileSQLStep(step: SQLTransformStep): string {
  const trimmed = step.params.sql.trim();
  if (!trimmed) {
    throw new Error("SQLTransformStep SQL cannot be empty.");
  }
  if (!/^\s*(with|select)\b/i.test(trimmed)) {
    throw new Error(
      "SQLTransformStep must be a SELECT/CTE query that produces the next table."
    );
  }
  return trimmed;
}

function compileGroupAggregateStep(
  step: GroupAggregateStep,
  upstreamTable: string
): string {
  const groupBy = step.params.groupBy.map((column) => quoteIdentifier(column));
  const aggregateSql = step.params.aggregates
    .map((aggregate) => `${aggregate.expression} AS ${quoteIdentifier(aggregate.alias)}`)
    .join(", ");

  if (!aggregateSql.trim()) {
    throw new Error("GroupAggregateStep requires at least one aggregate expression.");
  }

  const selectParts = [...groupBy, aggregateSql].filter(Boolean).join(", ");
  if (groupBy.length === 0) {
    return `SELECT ${selectParts} FROM ${quoteIdentifier(upstreamTable)}`;
  }
  return `SELECT ${selectParts} FROM ${quoteIdentifier(upstreamTable)} GROUP BY ${groupBy.join(", ")}`;
}

function compileJoinStep(step: JoinStep, upstreamTable: string): string {
  if (step.params.conditions.length === 0) {
    throw new Error("JoinStep requires at least one join condition.");
  }

  const joinType = step.params.joinType.toUpperCase();
  const onClause = step.params.conditions
    .map(
      (condition) =>
        `l.${quoteIdentifier(condition.leftColumn)} ${condition.operator} r.${quoteIdentifier(
          condition.rightColumn
        )}`
    )
    .join(" AND ");

  return `SELECT l.*, r.* FROM ${quoteIdentifier(upstreamTable)} AS l ${joinType} JOIN ${quoteIdentifier(step.params.rightTable)} AS r ON ${onClause}`;
}

function compilePivotStep(step: PivotStep, upstreamTable: string): string {
  const pivotColumn = step.params.pivotColumn.trim();
  const valueColumn = step.params.valueColumn.trim();
  if (!pivotColumn || !valueColumn) {
    throw new Error("PivotStep requires both pivot and value columns.");
  }
  const pivotValues = Array.from(
    new Set(
      (step.params.pivotValues ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  if (pivotValues.length === 0) {
    throw new Error("PivotStep requires at least one pivot value.");
  }
  const indexColumns = Array.from(
    new Set(
      step.params.indexColumns
        .map((column) => column.trim())
        .filter((column) => column.length > 0)
    )
  );

  const aliasCounts = new Map<string, number>();
  const aggregate = step.params.aggregate.toUpperCase();
  const pivotSql = pivotValues.map((pivotValue) => {
    const aliasBase = sanitizeIdentifier(`${pivotColumn}_${pivotValue}`);
    const usedCount = aliasCounts.get(aliasBase) ?? 0;
    aliasCounts.set(aliasBase, usedCount + 1);
    const alias =
      usedCount === 0 ? aliasBase : `${aliasBase}_${usedCount + 1}`;
    const condition = `CAST(${quoteIdentifier(pivotColumn)} AS VARCHAR) = ${quoteLiteral(
      pivotValue
    )}`;

    if (step.params.aggregate === "count") {
      return `SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END) AS ${quoteIdentifier(alias)}`;
    }

    return `${aggregate}(CASE WHEN ${condition} THEN ${quoteIdentifier(
      valueColumn
    )} ELSE NULL END) AS ${quoteIdentifier(alias)}`;
  });

  const selectParts = [...indexColumns.map((column) => quoteIdentifier(column)), ...pivotSql];
  const fromSql = `FROM ${quoteIdentifier(upstreamTable)}`;
  if (indexColumns.length === 0) {
    return `SELECT ${selectParts.join(", ")} ${fromSql}`;
  }
  return `SELECT ${selectParts.join(", ")} ${fromSql} GROUP BY ${indexColumns
    .map((column) => quoteIdentifier(column))
    .join(", ")}`;
}

export function compileStep(step: PipelineStep, upstreamTable: string): string {
  if (!step.enabled) {
    return `SELECT * FROM ${quoteIdentifier(upstreamTable)}`;
  }

  switch (step.type) {
    case "FilterStep":
      return compileFilterStep(step, upstreamTable);
    case "SelectColumnsStep":
      return compileSelectStep(step, upstreamTable);
    case "MutateColumnStep":
      return compileMutateStep(step, upstreamTable);
    case "RemoveDuplicatesStep":
      return compileRemoveDuplicatesStep(step, upstreamTable);
    case "MissingValuesStep":
      return compileMissingValuesStep(step, upstreamTable);
    case "SortRowsStep":
      return compileSortRowsStep(step, upstreamTable);
    case "CastColumnStep":
      return compileCastColumnStep(step, upstreamTable);
    case "ScaleNumericStep":
      return compileScaleNumericStep(step, upstreamTable);
    case "DummyVariablesStep":
      return compileDummyVariablesStep(step, upstreamTable);
    case "SQLTransformStep":
      return compileSQLStep(step);
    case "GroupAggregateStep":
      return compileGroupAggregateStep(step, upstreamTable);
    case "JoinStep":
      return compileJoinStep(step, upstreamTable);
    case "PivotStep":
      return compilePivotStep(step, upstreamTable);
    default: {
      const unknownStep: never = step;
      throw new Error(`Unsupported step type: ${String(unknownStep)}`);
    }
  }
}

export function compilePipeline(
  steps: PipelineStep[],
  baseTable: string
): string[] {
  const sqlStatements: string[] = [];
  let upstream = baseTable;

  steps.forEach((step, index) => {
    const sql = compileStep(step, upstream);
    sqlStatements.push(sql);
    upstream = stepAlias(step.id, index);
  });

  return sqlStatements;
}

export function buildPipelineSql(
  steps: PipelineStep[],
  baseTable: string
): string {
  if (steps.length === 0) {
    return `SELECT * FROM ${quoteIdentifier(baseTable)}`;
  }

  const ctes: string[] = [];
  let upstream = baseTable;

  steps.forEach((step, index) => {
    const alias = stepAlias(step.id, index);
    const sql = compileStep(step, upstream);
    ctes.push(`${quoteIdentifier(alias)} AS (${sql})`);
    upstream = alias;
  });

  return `WITH ${ctes.join(", ")} SELECT * FROM ${quoteIdentifier(upstream)}`;
}

export function buildPipelineSqlThroughStep(
  steps: PipelineStep[],
  baseTable: string,
  stepId: string
): string {
  const stepIndex = steps.findIndex((step) => step.id === stepId);
  if (stepIndex < 0) {
    throw new Error(`Unknown pipeline step target: ${stepId}`);
  }
  return buildPipelineSql(steps.slice(0, stepIndex + 1), baseTable);
}
