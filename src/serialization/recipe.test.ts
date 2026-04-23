import { describe, expect, it } from "vitest";
import { buildRecipe, parseRecipe } from "./recipe";

describe("recipe serialization", () => {
  it("builds and parses recipe roundtrip", () => {
    const recipe = buildRecipe({
      sources: [
        {
          id: "s1",
          name: "example.csv",
          sizeBytes: 100,
          hasHeader: true,
          delimiter: ","
        }
      ],
      pipeline: [],
      savedQueries: [],
      notebookBlocks: [],
      columnEditsByTable: {}
    });

    const parsed = parseRecipe(JSON.stringify(recipe));
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.sources).toHaveLength(1);
  });

  it("roundtrips with pipeline steps", () => {
    const recipe = buildRecipe({
      sources: [],
      pipeline: [
        {
          id: "s1",
          name: "SQL step",
          enabled: true,
          type: "SQLTransformStep",
          params: {
            sql: "SELECT * FROM source"
          }
        }
      ],
      savedQueries: [],
      notebookBlocks: [],
      columnEditsByTable: {}
    });

    const parsed = parseRecipe(JSON.stringify(recipe));
    expect(parsed.pipeline).toHaveLength(1);
    expect(parsed.pipeline[0].type).toBe("SQLTransformStep");
  });

  it("roundtrips table-scoped pipeline state", () => {
    const step = {
      id: "step_1",
      name: "Filter Orders",
      enabled: true,
      type: "FilterStep" as const,
      params: {
        column: "amount",
        operator: ">=" as const,
        value: "100"
      }
    };
    const recipe = buildRecipe({
      sources: [],
      pipeline: [step],
      pipelinesByTable: {
        orders: [step]
      },
      activePipelineStepIdByTable: {
        orders: "step_1"
      },
      selectedTransformTableName: "orders",
      savedQueries: [],
      notebookBlocks: [],
      columnEditsByTable: {}
    });

    const parsed = parseRecipe(JSON.stringify(recipe));
    expect(parsed.pipelinesByTable?.orders).toHaveLength(1);
    expect(parsed.activePipelineStepIdByTable?.orders).toBe("step_1");
    expect(parsed.selectedTransformTableName).toBe("orders");
  });

  it("roundtrips persisted column schema edits", () => {
    const recipe = buildRecipe({
      sources: [],
      pipeline: [],
      savedQueries: [],
      notebookBlocks: [],
      columnEditsByTable: {
        sales: [
          {
            id: "edit_1",
            tableName: "sales",
            fromColumnName: "c1",
            toColumnName: "order_id",
            fromType: "VARCHAR",
            toType: "BIGINT",
            appliedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }
    });

    const parsed = parseRecipe(JSON.stringify(recipe));
    expect(parsed.columnEditsByTable?.sales).toHaveLength(1);
    expect(parsed.columnEditsByTable?.sales[0].toColumnName).toBe("order_id");
  });

  it("rejects unknown schema versions", () => {
    expect(() =>
      parseRecipe(
        JSON.stringify({
          schemaVersion: "2.0",
          sources: [],
          pipeline: [],
          savedQueries: [],
          notebookBlocks: []
        })
      )
    ).toThrow("Unsupported recipe schema version");
  });

  it("rejects recipes with missing required collections", () => {
    expect(() =>
      parseRecipe(
        JSON.stringify({
          schemaVersion: "1.0",
          sources: [],
          savedQueries: [],
          notebookBlocks: []
        })
      )
    ).toThrow("missing pipeline");

    expect(() =>
      parseRecipe(
        JSON.stringify({
          schemaVersion: "1.0",
          sources: [],
          pipeline: [],
          notebookBlocks: []
        })
      )
    ).toThrow("missing savedQueries");
  });

  it("throws on invalid JSON input", () => {
    expect(() => parseRecipe("{not-valid-json")).toThrow();
  });

  it("rejects recipes with invalid pipeline step payloads", () => {
    expect(() =>
      parseRecipe(
        JSON.stringify({
          schemaVersion: "1.0",
          sources: [],
          pipeline: [
            {
              id: "bad",
              name: "Bad filter",
              enabled: true,
              type: "FilterStep",
              params: {
                column: "amount"
              }
            }
          ],
          savedQueries: [],
          notebookBlocks: []
        })
      )
    ).toThrow("invalid pipeline step");
  });

  it("rejects invalid table-scoped pipeline maps", () => {
    expect(() =>
      parseRecipe(
        JSON.stringify({
          schemaVersion: "1.0",
          sources: [],
          pipeline: [],
          pipelinesByTable: {
            orders: "not-an-array"
          },
          savedQueries: [],
          notebookBlocks: []
        })
      )
    ).toThrow("pipelinesByTable entry");

    expect(() =>
      parseRecipe(
        JSON.stringify({
          schemaVersion: "1.0",
          sources: [],
          pipeline: [],
          activePipelineStepIdByTable: {
            orders: 123
          },
          savedQueries: [],
          notebookBlocks: []
        })
      )
    ).toThrow("activePipelineStepIdByTable entry");
  });
});
