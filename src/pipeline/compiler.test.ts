import { describe, expect, it } from "vitest";
import {
  buildPipelineSql,
  buildPipelineSqlThroughStep,
  compilePipeline,
  compileStep
} from "./compiler";
import type {
  CastColumnStep,
  DummyVariablesStep,
  FilterStep,
  GroupAggregateStep,
  JoinStep,
  MissingValuesStep,
  PivotStep,
  RemoveDuplicatesStep,
  ScaleNumericStep,
  SelectColumnsStep,
  SortRowsStep,
  SQLTransformStep
} from "./types";

describe("pipeline compiler", () => {
  it("compiles a filter step deterministically", () => {
    const step: FilterStep = {
      id: "a",
      name: "Filter amount",
      enabled: true,
      type: "FilterStep",
      params: {
        column: "amount",
        operator: ">",
        value: "100"
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT * FROM "t0" WHERE "amount" > '100'`
    );
  });

  it("compiles dummy-variable steps", () => {
    const step: DummyVariablesStep = {
      id: "d1",
      name: "Dummies",
      enabled: true,
      type: "DummyVariablesStep",
      params: {
        sourceColumn: "segment",
        categories: ["A", "B", "C"],
        dropCategory: "A",
        prefix: "segment"
      }
    };

    expect(compileStep(step, "t0")).toContain(
      `CASE WHEN CAST("segment" AS VARCHAR) = 'B' THEN 1 ELSE 0 END AS "segment_B"`
    );
    expect(compileStep(step, "t0")).toContain(`FROM "t0"`);
  });

  it("compiles select columns", () => {
    const step: SelectColumnsStep = {
      id: "b",
      name: "Select",
      enabled: true,
      type: "SelectColumnsStep",
      params: {
        columns: ["city", "amount"]
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT "city", "amount" FROM "t0"`
    );
  });

  it("compiles remove-duplicates steps", () => {
    const step: RemoveDuplicatesStep = {
      id: "rd1",
      name: "Remove duplicates",
      enabled: true,
      type: "RemoveDuplicatesStep",
      params: {
        columns: ["city", "amount"]
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT * EXCLUDE ("_sf_dupe_rank") FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY "city", "amount" ORDER BY "city", "amount") AS "_sf_dupe_rank" FROM "t0") WHERE "_sf_dupe_rank" = 1`
    );
  });

  it("compiles missing-values fill steps", () => {
    const step: MissingValuesStep = {
      id: "mv1",
      name: "Fill missing",
      enabled: true,
      type: "MissingValuesStep",
      params: {
        mode: "fill",
        columns: ["city"],
        fillValue: "unknown"
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT * REPLACE (COALESCE("city", 'unknown') AS "city") FROM "t0"`
    );
  });

  it("compiles sort-row steps", () => {
    const step: SortRowsStep = {
      id: "sort1",
      name: "Sort rows",
      enabled: true,
      type: "SortRowsStep",
      params: {
        column: "amount",
        direction: "desc",
        nulls: "last"
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT * FROM "t0" ORDER BY "amount" DESC NULLS LAST`
    );
  });

  it("compiles cast-column steps", () => {
    const step: CastColumnStep = {
      id: "cast1",
      name: "Cast date",
      enabled: true,
      type: "CastColumnStep",
      params: {
        column: "date_str",
        targetType: "DATE",
        dateFormat: "%Y-%m-%d",
        outputColumn: "parsed_date"
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT *, CAST(TRY_STRPTIME(CAST("date_str" AS VARCHAR), '%Y-%m-%d') AS DATE) AS "parsed_date" FROM "t0"`
    );
  });

  it("compiles numeric scaling steps", () => {
    const step: ScaleNumericStep = {
      id: "scale1",
      name: "Scale amount",
      enabled: true,
      type: "ScaleNumericStep",
      params: {
        column: "amount",
        method: "zscore",
        outputColumn: "amount_z"
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT *, (TRY_CAST("amount" AS DOUBLE) - AVG(TRY_CAST("amount" AS DOUBLE)) OVER ()) / NULLIF(STDDEV_SAMP(TRY_CAST("amount" AS DOUBLE)) OVER (), 0) AS "amount_z" FROM "t0"`
    );
  });

  it("compiles group aggregate steps", () => {
    const step: GroupAggregateStep = {
      id: "c",
      name: "Aggregate by city",
      enabled: true,
      type: "GroupAggregateStep",
      params: {
        groupBy: ["city"],
        aggregates: [{ expression: "SUM(amount)", alias: "sum_amount" }]
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT "city", SUM(amount) AS "sum_amount" FROM "t0" GROUP BY "city"`
    );
  });

  it("compiles join steps", () => {
    const step: JoinStep = {
      id: "d",
      name: "Join customer table",
      enabled: true,
      type: "JoinStep",
      params: {
        rightTable: "customers",
        joinType: "left",
        conditions: [
          {
            leftColumn: "customer_id",
            operator: "=",
            rightColumn: "id"
          }
        ]
      }
    };

    expect(compileStep(step, "orders")).toBe(
      `SELECT l.*, r.* FROM "orders" AS l LEFT JOIN "customers" AS r ON l."customer_id" = r."id"`
    );
  });

  it("compiles pivot steps into deterministic conditional aggregates", () => {
    const step: PivotStep = {
      id: "e",
      name: "Pivot",
      enabled: true,
      type: "PivotStep",
      params: {
        indexColumns: ["team"],
        pivotColumn: "season",
        valueColumn: "wins",
        aggregate: "sum",
        pivotValues: ["2023", "2024"]
      }
    };

    expect(compileStep(step, "t0")).toBe(
      `SELECT "team", SUM(CASE WHEN CAST("season" AS VARCHAR) = '2023' THEN "wins" ELSE NULL END) AS "season_2023", SUM(CASE WHEN CAST("season" AS VARCHAR) = '2024' THEN "wins" ELSE NULL END) AS "season_2024" FROM "t0" GROUP BY "team"`
    );
  });

  it("throws when pivot step has no pivot values", () => {
    const step: PivotStep = {
      id: "e",
      name: "Pivot",
      enabled: true,
      type: "PivotStep",
      params: {
        indexColumns: ["team"],
        pivotColumn: "season",
        valueColumn: "wins",
        aggregate: "sum",
        pivotValues: []
      }
    };

    expect(() => compileStep(step, "t0")).toThrow("at least one pivot value");
  });

  it("compiles disabled steps as pass-through SQL", () => {
    const step: FilterStep = {
      id: "f",
      name: "Disabled filter",
      enabled: false,
      type: "FilterStep",
      params: {
        column: "amount",
        operator: ">",
        value: "100"
      }
    };

    expect(compileStep(step, "t0")).toBe(`SELECT * FROM "t0"`);
  });

  it("throws when join step has no conditions", () => {
    const step: JoinStep = {
      id: "j",
      name: "Bad join",
      enabled: true,
      type: "JoinStep",
      params: {
        rightTable: "customers",
        joinType: "inner",
        conditions: []
      }
    };

    expect(() => compileStep(step, "orders")).toThrow("join condition");
  });

  it("throws when aggregate step has no aggregates", () => {
    const step: GroupAggregateStep = {
      id: "g",
      name: "Bad aggregate",
      enabled: true,
      type: "GroupAggregateStep",
      params: {
        groupBy: ["city"],
        aggregates: []
      }
    };

    expect(() => compileStep(step, "t0")).toThrow("at least one aggregate");
  });

  it("builds a runnable SQL statement for a pipeline chain", () => {
    const steps: FilterStep[] = [
      {
        id: "step-1",
        name: "Filter amount",
        enabled: true,
        type: "FilterStep",
        params: {
          column: "amount",
          operator: ">",
          value: "100"
        }
      }
    ];

    const sql = buildPipelineSql(steps, "sales");
    expect(sql).toContain(`WITH "step_step_1" AS`);
    expect(sql).toContain(`FROM "sales"`);
    expect(sql).toContain(`SELECT * FROM "step_step_1"`);
  });

  it("builds base-table SQL when no steps are present", () => {
    expect(buildPipelineSql([], "sales")).toBe(`SELECT * FROM "sales"`);
  });

  it("builds SQL through a specific step target", () => {
    const steps: Array<FilterStep | SelectColumnsStep> = [
      {
        id: "a-1",
        name: "Filter amount",
        enabled: true,
        type: "FilterStep",
        params: {
          column: "amount",
          operator: ">",
          value: "100"
        }
      },
      {
        id: "b 2",
        name: "Select columns",
        enabled: true,
        type: "SelectColumnsStep",
        params: {
          columns: ["amount"]
        }
      }
    ];

    const sql = buildPipelineSqlThroughStep(steps, "sales", "a-1");
    expect(sql).toContain(`WITH "step_a_1" AS`);
    expect(sql).toContain(`SELECT * FROM "step_a_1"`);
    expect(sql).not.toContain(`step_b_2`);
  });

  it("throws when buildPipelineSqlThroughStep receives unknown step id", () => {
    const steps: FilterStep[] = [
      {
        id: "a-1",
        name: "Filter amount",
        enabled: true,
        type: "FilterStep",
        params: {
          column: "amount",
          operator: ">",
          value: "100"
        }
      }
    ];

    expect(() =>
      buildPipelineSqlThroughStep(steps, "sales", "missing-step")
    ).toThrow("Unknown pipeline step target");
  });

  it("returns per-step SQL snapshots in compilePipeline", () => {
    const steps: Array<FilterStep | SelectColumnsStep> = [
      {
        id: "a-1",
        name: "Filter amount",
        enabled: true,
        type: "FilterStep",
        params: {
          column: "amount",
          operator: ">",
          value: "100"
        }
      },
      {
        id: "b 2",
        name: "Select columns",
        enabled: true,
        type: "SelectColumnsStep",
        params: {
          columns: ["amount"]
        }
      }
    ];

    const statements = compilePipeline(steps, "sales");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(`SELECT * FROM "sales" WHERE "amount" > '100'`);
    expect(statements[1]).toBe(`SELECT "amount" FROM "step_a_1"`);
  });

  it("compiles SQL transform steps that are SELECT-like", () => {
    const step: SQLTransformStep = {
      id: "sql-1",
      name: "SQL",
      enabled: true,
      type: "SQLTransformStep",
      params: {
        sql: "WITH x AS (SELECT 1) SELECT * FROM x"
      }
    };

    expect(compileStep(step, "ignored")).toBe(
      "WITH x AS (SELECT 1) SELECT * FROM x"
    );
  });

  it("rejects SQL transform steps that are not SELECT-like", () => {
    const step: SQLTransformStep = {
      id: "sql-2",
      name: "SQL",
      enabled: true,
      type: "SQLTransformStep",
      params: {
        sql: "CREATE TABLE x AS SELECT 1"
      }
    };

    expect(() => compileStep(step, "ignored")).toThrow("SELECT/CTE");
  });
});
