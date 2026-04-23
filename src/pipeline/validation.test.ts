import { describe, expect, it } from "vitest";
import { isPipelineStep, normalizePipelineSteps } from "./validation";

describe("pipeline validation", () => {
  it("accepts valid filter steps", () => {
    expect(
      isPipelineStep({
        id: "s1",
        name: "Filter",
        enabled: true,
        type: "FilterStep",
        params: {
          column: "amount",
          operator: ">",
          value: "10"
        }
      })
    ).toBe(true);
  });

  it("rejects invalid operator values", () => {
    expect(
      isPipelineStep({
        id: "s1",
        name: "Filter",
        enabled: true,
        type: "FilterStep",
        params: {
          column: "amount",
          operator: "LIKE",
          value: "10"
        }
      })
    ).toBe(false);
  });

  it("accepts valid join steps", () => {
    expect(
      isPipelineStep({
        id: "j1",
        name: "Join",
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
      })
    ).toBe(true);
  });

  it("accepts valid dummy variable steps", () => {
    expect(
      isPipelineStep({
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
      })
    ).toBe(true);
  });

  it("accepts valid pivot steps with explicit pivot values", () => {
    expect(
      isPipelineStep({
        id: "p1",
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
      })
    ).toBe(true);
  });

  it("accepts valid cleaning steps", () => {
    expect(
      isPipelineStep({
        id: "mv1",
        name: "Fill missing",
        enabled: true,
        type: "MissingValuesStep",
        params: {
          mode: "fill",
          columns: ["amount"],
          fillValue: "0"
        }
      })
    ).toBe(true);
    expect(
      isPipelineStep({
        id: "sort1",
        name: "Sort rows",
        enabled: true,
        type: "SortRowsStep",
        params: {
          column: "amount",
          direction: "asc",
          nulls: "last"
        }
      })
    ).toBe(true);
  });

  it("rejects invalid join condition operator", () => {
    expect(
      isPipelineStep({
        id: "j1",
        name: "Join",
        enabled: true,
        type: "JoinStep",
        params: {
          rightTable: "customers",
          joinType: "left",
          conditions: [
            {
              leftColumn: "customer_id",
              operator: "LIKE",
              rightColumn: "id"
            }
          ]
        }
      })
    ).toBe(false);
  });

  it("normalizes mixed arrays to valid steps only", () => {
    const normalized = normalizePipelineSteps([
      {
        id: "a",
        name: "SQL",
        enabled: true,
        type: "SQLTransformStep",
        params: {
          sql: "SELECT * FROM source"
        }
      },
      {
        id: "b",
        name: "Broken",
        enabled: true,
        type: "FilterStep",
        params: {
          column: "amount"
        }
      },
      "wrong"
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].type).toBe("SQLTransformStep");
  });
});
