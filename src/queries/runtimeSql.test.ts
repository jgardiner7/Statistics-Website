import { describe, expect, it } from "vitest";
import type { SavedQuery } from "../shared/types";
import { buildRuntimeSql } from "./runtimeSql";

describe("buildRuntimeSql", () => {
  it("builds query against table target", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT COUNT(*) AS n FROM source",
      fallbackTableName: "sales",
      target: { kind: "table", tableName: "sales" },
      savedQueries: [],
      pipelineSteps: []
    });

    expect(sql).toContain("source AS");
    expect(sql).toContain('"sales"');
  });

  it("builds query against saved query target", () => {
    const savedQueries: SavedQuery[] = [
      {
        id: "q1",
        name: "Q1",
        createdAt: new Date().toISOString(),
        activeVersionId: "v1",
        versions: [
          {
            versionId: "v1",
            sql: "SELECT * FROM source",
            target: { kind: "table", tableName: "sales" },
            dependsOnVersionIds: [],
            createdAt: new Date().toISOString()
          }
        ]
      }
    ];

    const sql = buildRuntimeSql({
      userSql: "SELECT * FROM source LIMIT 10",
      fallbackTableName: "sales",
      target: {
        kind: "query_version",
        queryId: "q1",
        queryName: "Q1",
        versionId: "v1"
      },
      savedQueries,
      pipelineSteps: []
    });

    expect(sql).toContain("WITH source AS");
    expect(sql).toContain("_sf_saved_version");
  });

  it("uses a safe default query when editor SQL is empty", () => {
    const sql = buildRuntimeSql({
      userSql: "   ",
      fallbackTableName: "sales",
      target: { kind: "table", tableName: "sales" },
      savedQueries: [],
      pipelineSteps: []
    });

    expect(sql).toContain("SELECT * FROM source LIMIT 200");
  });

  it("passes through non-select SQL without injecting source wrapper", () => {
    const sql = buildRuntimeSql({
      userSql: "CREATE TABLE tmp AS SELECT 1",
      fallbackTableName: "sales",
      target: { kind: "table", tableName: "sales" },
      savedQueries: [],
      pipelineSteps: []
    });

    expect(sql).toBe("CREATE TABLE tmp AS SELECT 1");
  });

  it("throws when no target and no fallback table are available", () => {
    expect(() =>
      buildRuntimeSql({
        userSql: "SELECT * FROM source",
        fallbackTableName: null,
        target: null,
        savedQueries: [],
        pipelineSteps: []
      })
    ).toThrow("No table or query target");
  });

  it("throws when targeted saved-query version is missing", () => {
    expect(() =>
      buildRuntimeSql({
        userSql: "SELECT * FROM source",
        fallbackTableName: "sales",
        target: {
          kind: "query_version",
          queryId: "missing",
          queryName: "Missing",
          versionId: "missing-v1"
        },
        savedQueries: [],
        pipelineSteps: []
      })
    ).toThrow("Missing query version");
  });

  it("throws when duplicate version IDs are present", () => {
    const now = new Date().toISOString();
    const savedQueries: SavedQuery[] = [
      {
        id: "q1",
        name: "Q1",
        createdAt: now,
        activeVersionId: "shared",
        versions: [
          {
            versionId: "shared",
            sql: "SELECT * FROM source",
            target: { kind: "table", tableName: "sales" },
            dependsOnVersionIds: [],
            createdAt: now
          }
        ]
      },
      {
        id: "q2",
        name: "Q2",
        createdAt: now,
        activeVersionId: "shared",
        versions: [
          {
            versionId: "shared",
            sql: "SELECT * FROM source",
            target: { kind: "table", tableName: "sales" },
            dependsOnVersionIds: [],
            createdAt: now
          }
        ]
      }
    ];

    expect(() =>
      buildRuntimeSql({
        userSql: "SELECT * FROM source",
        fallbackTableName: "sales",
        target: {
          kind: "query_version",
          queryId: "q1",
          queryName: "Q1",
          versionId: "shared"
        },
        savedQueries,
        pipelineSteps: []
      })
    ).toThrow("Duplicate query version ID");
  });

  it("rejects cyclical saved query dependencies", () => {
    const savedQueries: SavedQuery[] = [
      {
        id: "q1",
        name: "Q1",
        createdAt: new Date().toISOString(),
        activeVersionId: "v1",
        versions: [
          {
            versionId: "v1",
            sql: "SELECT * FROM source",
            target: {
              kind: "query_version",
              queryId: "q2",
              queryName: "Q2",
              versionId: "v2"
            },
            dependsOnVersionIds: ["v2"],
            createdAt: new Date().toISOString()
          }
        ]
      },
      {
        id: "q2",
        name: "Q2",
        createdAt: new Date().toISOString(),
        activeVersionId: "v2",
        versions: [
          {
            versionId: "v2",
            sql: "SELECT * FROM source",
            target: {
              kind: "query_version",
              queryId: "q1",
              queryName: "Q1",
              versionId: "v1"
            },
            dependsOnVersionIds: ["v1"],
            createdAt: new Date().toISOString()
          }
        ]
      }
    ];

    expect(() =>
      buildRuntimeSql({
        userSql: "SELECT * FROM source",
        fallbackTableName: "sales",
        target: {
          kind: "query_version",
          queryId: "q1",
          queryName: "Q1",
          versionId: "v1"
        },
        savedQueries,
        pipelineSteps: []
      })
    ).toThrow("cyclical");
  });

  it("builds query against a pipeline step target", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT * FROM source",
      fallbackTableName: "sales",
      target: {
        kind: "pipeline_step",
        stepId: "filter-step",
        stepName: "Filter amount",
        baseTableName: "sales"
      },
      savedQueries: [],
      pipelineSteps: [
        {
          id: "filter-step",
          name: "Filter amount",
          enabled: true,
          type: "FilterStep",
          params: {
            column: "amount",
            operator: ">",
            value: "100"
          }
        }
      ]
    });

    expect(sql).toContain(`"step_filter_step"`);
    expect(sql).toContain(`FROM "sales"`);
  });

  it("resolves pipeline step target from the step base table map", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT * FROM source",
      fallbackTableName: "sales_primary",
      target: {
        kind: "pipeline_step",
        stepId: "step_secondary",
        stepName: "Secondary Filter",
        baseTableName: "sales_secondary"
      },
      savedQueries: [],
      pipelineSteps: [
        {
          id: "step_primary",
          name: "Primary Filter",
          enabled: true,
          type: "FilterStep",
          params: {
            column: "X",
            operator: ">",
            value: "10"
          }
        }
      ],
      pipelineStepsByTable: {
        sales_secondary: [
          {
            id: "step_secondary",
            name: "Secondary Filter",
            enabled: true,
            type: "FilterStep",
            params: {
              column: "date",
              operator: ">",
              value: "2020-01-01"
            }
          }
        ]
      }
    });

    expect(sql).toContain('"sales_secondary"');
    expect(sql).toContain('"date"');
    expect(sql).not.toContain('"X"');
  });

  it("throws when a pipeline step target is missing from the current pipeline", () => {
    expect(() =>
      buildRuntimeSql({
        userSql: "SELECT * FROM source",
        fallbackTableName: "sales",
        target: {
          kind: "pipeline_step",
          stepId: "missing",
          stepName: "Missing",
          baseTableName: "sales"
        },
        savedQueries: [],
        pipelineSteps: []
      })
    ).toThrow("Unknown pipeline step target");
  });

  it("uses pinned pipeline snapshots for pipeline-step targets", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT * FROM source",
      fallbackTableName: "sales",
      target: {
        kind: "pipeline_step",
        stepId: "old_step",
        stepName: "Old filter",
        baseTableName: "sales",
        pipelineSnapshot: [
          {
            id: "old_step",
            name: "Old filter",
            enabled: true,
            type: "FilterStep",
            params: {
              column: "amount",
              operator: ">",
              value: "100"
            }
          }
        ]
      },
      savedQueries: [],
      pipelineSteps: [
        {
          id: "new_step",
          name: "New filter",
          enabled: true,
          type: "FilterStep",
          params: {
            column: "date",
            operator: ">",
            value: "2020-01-01"
          }
        }
      ]
    });

    expect(sql).toContain(`"amount" > '100'`);
    expect(sql).not.toContain(`"date" > '2020-01-01'`);
  });

  it("uses pinned pipeline snapshots inside saved-query versions", () => {
    const now = new Date().toISOString();
    const savedQueries: SavedQuery[] = [
      {
        id: "q1",
        name: "Q1",
        createdAt: now,
        activeVersionId: "v1",
        versions: [
          {
            versionId: "v1",
            sql: "SELECT * FROM source",
            target: {
              kind: "pipeline_step",
              stepId: "old_step",
              stepName: "Old filter",
              baseTableName: "sales",
              pipelineSnapshot: [
                {
                  id: "old_step",
                  name: "Old filter",
                  enabled: true,
                  type: "FilterStep",
                  params: {
                    column: "amount",
                    operator: ">",
                    value: "100"
                  }
                }
              ]
            },
            dependsOnVersionIds: [],
            createdAt: now
          }
        ]
      }
    ];

    const sql = buildRuntimeSql({
      userSql: "SELECT * FROM source",
      fallbackTableName: "sales",
      target: {
        kind: "query_version",
        queryId: "q1",
        queryName: "Q1",
        versionId: "v1"
      },
      savedQueries,
      pipelineSteps: [
        {
          id: "new_step",
          name: "New filter",
          enabled: true,
          type: "FilterStep",
          params: {
            column: "date",
            operator: ">",
            value: "2020-01-01"
          }
        }
      ]
    });

    expect(sql).toContain(`"amount" > '100'`);
    expect(sql).not.toContain(`"date" > '2020-01-01'`);
  });

  it("registers saved query names as SQL-referenceable aliases", () => {
    const now = new Date().toISOString();
    const savedQueries: SavedQuery[] = [
      {
        id: "q_top_customers",
        name: "Top Customers",
        createdAt: now,
        activeVersionId: "v1",
        versions: [
          {
            versionId: "v1",
            sql: "SELECT customer_id, amount FROM source",
            target: { kind: "table", tableName: "sales" },
            dependsOnVersionIds: [],
            createdAt: now
          }
        ]
      }
    ];

    const sql = buildRuntimeSql({
      userSql: "SELECT COUNT(*) FROM Top_Customers",
      fallbackTableName: "sales",
      target: { kind: "table", tableName: "sales" },
      savedQueries,
      pipelineSteps: []
    });

    expect(sql).toContain(`"Top_Customers" AS`);
    expect(sql).toContain("FROM Top_Customers");
  });

  it("registers transform names as SQL-referenceable aliases", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT COUNT(*) FROM Amount_Filtered",
      fallbackTableName: "sales",
      target: { kind: "table", tableName: "sales" },
      savedQueries: [],
      pipelineSteps: [
        {
          id: "step_1",
          name: "Amount Filtered",
          enabled: true,
          type: "FilterStep",
          params: {
            column: "amount",
            operator: ">",
            value: "100"
          }
        }
      ]
    });

    expect(sql).toContain(`"Amount_Filtered" AS`);
    expect(sql).toContain("FROM Amount_Filtered");
  });

  it("does not inject transform aliases when they are not referenced", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT * FROM source",
      fallbackTableName: "sales",
      target: { kind: "table", tableName: "sales" },
      savedQueries: [],
      pipelineSteps: [
        {
          id: "step_bad",
          name: "Bad Transform",
          enabled: true,
          type: "SelectColumnsStep",
          params: {
            columns: ["X", "Y", "Z"]
          }
        }
      ]
    });

    expect(sql).not.toContain(`"Bad_Transform" AS`);
    expect(sql).toContain("SELECT * FROM source");
  });

  it("builds referenced transform aliases from the selected table target", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT COUNT(*) FROM Amount_Filtered",
      fallbackTableName: "sales_primary",
      target: { kind: "table", tableName: "sales_secondary" },
      savedQueries: [],
      pipelineSteps: [
        {
          id: "step_1",
          name: "Amount Filtered",
          enabled: true,
          type: "FilterStep",
          params: {
            column: "amount",
            operator: ">",
            value: "100"
          }
        }
      ]
    });

    expect(sql).toContain(`"Amount_Filtered" AS`);
    expect(sql).toContain('FROM "sales_secondary"');
    expect(sql).not.toContain('FROM "sales_primary"');
  });

  it("builds named transform aliases from the target table pipeline map", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT COUNT(*) FROM Secondary_Filter",
      fallbackTableName: "sales_primary",
      target: { kind: "table", tableName: "sales_secondary" },
      savedQueries: [],
      pipelineSteps: [
        {
          id: "step_primary",
          name: "Primary Filter",
          enabled: true,
          type: "FilterStep",
          params: {
            column: "X",
            operator: ">",
            value: "10"
          }
        }
      ],
      pipelineStepsByTable: {
        sales_secondary: [
          {
            id: "step_secondary",
            name: "Secondary Filter",
            enabled: true,
            type: "FilterStep",
            params: {
              column: "date",
              operator: ">",
              value: "2020-01-01"
            }
          }
        ]
      }
    });

    expect(sql).toContain('"Secondary_Filter" AS');
    expect(sql).toContain('"date"');
    expect(sql).not.toContain('"Primary_Filter" AS');
  });

  it("registers cross-table transform aliases with table-prefixed names", () => {
    const sql = buildRuntimeSql({
      userSql: "SELECT COUNT(*) FROM sales_secondary_Secondary_Filter",
      fallbackTableName: "sales_primary",
      target: { kind: "table", tableName: "sales_primary" },
      savedQueries: [],
      pipelineSteps: [],
      pipelineStepsByTable: {
        sales_primary: [
          {
            id: "step_primary",
            name: "Primary Filter",
            enabled: true,
            type: "FilterStep",
            params: {
              column: "X",
              operator: ">",
              value: "10"
            }
          }
        ],
        sales_secondary: [
          {
            id: "step_secondary",
            name: "Secondary Filter",
            enabled: true,
            type: "FilterStep",
            params: {
              column: "date",
              operator: ">",
              value: "2020-01-01"
            }
          }
        ]
      }
    });

    expect(sql).toContain('"sales_secondary_Secondary_Filter" AS');
    expect(sql).toContain('"date"');
  });
});
