import { describe, expect, it } from "vitest";
import type { SQLTransformStep } from "../shared/types";
import { initialState, reducer } from "./state";

function makeSqlStep(id: string, sql = "SELECT * FROM source"): SQLTransformStep {
  return {
    id,
    name: `SQL ${id}`,
    enabled: true,
    type: "SQLTransformStep",
    params: {
      sql
    }
  };
}

function withTable(state = initialState, tableName = "sales") {
  return reducer(state, {
    type: "SET_TABLES",
    tables: [
      {
        tableName,
        rowCount: 1,
        columns: [],
        rows: []
      }
    ],
    activeTableName: tableName
  });
}

describe("ui state reducer", () => {
  it("falls back to the first table when active table is missing after refresh", () => {
    const withActive = reducer(initialState, {
      type: "SET_TABLES",
      tables: [
        {
          tableName: "old_name",
          rowCount: 1,
          columns: [],
          rows: []
        }
      ],
      activeTableName: "old_name"
    });
    const next = reducer(withActive, {
      type: "SET_TABLES",
      tables: [
        {
          tableName: "new_name",
          rowCount: 1,
          columns: [],
          rows: []
        }
      ]
    });

    expect(next.activeTableName).toBe("new_name");
  });

  it("updates storage mode status", () => {
    const next = reducer(initialState, {
      type: "SET_STORAGE_MODE",
      storageMode: "idb_plus_opfs"
    });

    expect(next.storageMode).toBe("idb_plus_opfs");
  });

  it("adds pipeline steps and tracks active step", () => {
    const step = makeSqlStep("s1");
    const next = reducer(withTable(), {
      type: "ADD_PIPELINE_STEP",
      step
    });

    expect(next.pipelineSteps).toHaveLength(1);
    expect(next.pipelineSteps[0].id).toBe("s1");
    expect(next.activePipelineStepId).toBe("s1");
  });

  it("updates existing pipeline step content", () => {
    const step = makeSqlStep("s1");
    const stateWithStep = reducer(withTable(), {
      type: "ADD_PIPELINE_STEP",
      step
    });
    const updated = makeSqlStep("s1", "SELECT amount FROM source");
    const next = reducer(stateWithStep, {
      type: "UPDATE_PIPELINE_STEP",
      step: updated
    });

    expect(next.pipelineSteps[0].type).toBe("SQLTransformStep");
    if (next.pipelineSteps[0].type !== "SQLTransformStep") {
      throw new Error("Expected SQLTransformStep");
    }
    expect(next.pipelineSteps[0].params.sql).toBe("SELECT amount FROM source");
  });

  it("recomputes active pipeline step on SET_PIPELINE_STEPS", () => {
    const step1 = makeSqlStep("s1");
    const step2 = makeSqlStep("s2");
    const base = withTable();
    const populated = reducer(
      reducer(base, {
        type: "ADD_PIPELINE_STEP",
        step: step1
      }),
      {
        type: "ADD_PIPELINE_STEP",
        step: step2
      }
    );
    const withActiveS1 = reducer(populated, {
      type: "SET_ACTIVE_PIPELINE_STEP",
      stepId: "s1"
    });
    const next = reducer(withActiveS1, {
      type: "SET_PIPELINE_STEPS",
      steps: [step2]
    });

    expect(next.pipelineSteps).toHaveLength(1);
    expect(next.activePipelineStepId).toBe("s2");
  });

  it("hydrates pipeline fields", () => {
    const step = makeSqlStep("s1");
    const next = reducer(initialState, {
      type: "HYDRATE",
      patch: {
        selectedTransformTableName: "sales",
        pipelineSteps: [step],
        activePipelineStepId: "s1"
      }
    });

    expect(next.pipelineSteps).toHaveLength(1);
    expect(next.activePipelineStepId).toBe("s1");
  });

  it("preserves per-table pipelines during hydrate before tables are loaded", () => {
    const step = makeSqlStep("s1");
    const next = reducer(initialState, {
      type: "HYDRATE",
      patch: {
        selectedTransformTableName: "sales",
        pipelinesByTable: {
          sales: [step]
        },
        activePipelineStepIdByTable: {
          sales: "s1"
        }
      }
    });

    expect(next.selectedTransformTableName).toBe("sales");
    expect(next.pipelinesByTable.sales).toHaveLength(1);
    expect(next.pipelineSteps[0].id).toBe("s1");
    expect(next.activePipelineStepId).toBe("s1");
  });

  it("keeps pipelines isolated when switching selected transform table", () => {
    const step = makeSqlStep("s1");
    const withTwoTables = reducer(initialState, {
      type: "SET_TABLES",
      tables: [
        {
          tableName: "table_a",
          rowCount: 1,
          columns: [],
          rows: []
        },
        {
          tableName: "table_b",
          rowCount: 1,
          columns: [],
          rows: []
        }
      ],
      activeTableName: "table_a"
    });
    const withStepOnA = reducer(withTwoTables, {
      type: "ADD_PIPELINE_STEP",
      step
    });

    const switchedToB = reducer(withStepOnA, {
      type: "SET_SELECTED_TRANSFORM_TABLE",
      tableName: "table_b"
    });

    expect(switchedToB.pipelineSteps).toEqual([]);
    expect(switchedToB.pipelinesByTable.table_a).toHaveLength(1);
    expect(switchedToB.pipelinesByTable.table_b).toEqual([]);
  });

  it("toggles enabled state for a pipeline step", () => {
    const step = makeSqlStep("s1");
    const stateWithStep = reducer(withTable(), {
      type: "ADD_PIPELINE_STEP",
      step
    });
    const next = reducer(stateWithStep, {
      type: "TOGGLE_PIPELINE_STEP_ENABLED",
      stepId: "s1"
    });

    expect(next.pipelineSteps).toHaveLength(1);
    expect(next.pipelineSteps[0].enabled).toBe(false);
  });

  it("moves pipeline steps up and down", () => {
    const step1 = makeSqlStep("s1");
    const step2 = makeSqlStep("s2");
    const base = withTable();
    const stateWithSteps = reducer(
      reducer(base, { type: "ADD_PIPELINE_STEP", step: step1 }),
      { type: "ADD_PIPELINE_STEP", step: step2 }
    );

    const movedUp = reducer(stateWithSteps, {
      type: "MOVE_PIPELINE_STEP",
      stepId: "s2",
      direction: "up"
    });
    expect(movedUp.pipelineSteps.map((step) => step.id)).toEqual(["s2", "s1"]);

    const boundaryNoOp = reducer(movedUp, {
      type: "MOVE_PIPELINE_STEP",
      stepId: "s2",
      direction: "up"
    });
    expect(boundaryNoOp.pipelineSteps.map((step) => step.id)).toEqual(["s2", "s1"]);
  });

  it("removes a pipeline step and reassigns active step", () => {
    const step1 = makeSqlStep("s1");
    const step2 = makeSqlStep("s2");
    const base = withTable();
    const stateWithSteps = reducer(
      reducer(base, { type: "ADD_PIPELINE_STEP", step: step1 }),
      { type: "ADD_PIPELINE_STEP", step: step2 }
    );
    const activeFirst = reducer(stateWithSteps, {
      type: "SET_ACTIVE_PIPELINE_STEP",
      stepId: "s1"
    });
    const next = reducer(activeFirst, {
      type: "REMOVE_PIPELINE_STEP",
      stepId: "s1"
    });

    expect(next.pipelineSteps.map((step) => step.id)).toEqual(["s2"]);
    expect(next.activePipelineStepId).toBe("s2");
  });

  it("removes notebook blocks by id", () => {
    const stateWithBlock = reducer(initialState, {
      type: "ADD_NOTEBOOK_BLOCK",
      block: {
        id: "b1",
        title: "Block 1",
        type: "table",
        createdAt: new Date().toISOString(),
        upstreamVersionId: "sales",
        payload: { columns: [], rows: [], rowCount: 0 }
      }
    });
    const next = reducer(stateWithBlock, {
      type: "REMOVE_NOTEBOOK_BLOCK",
      blockId: "b1"
    });

    expect(next.notebookBlocks).toHaveLength(0);
  });

  it("updates notebook block payload by id", () => {
    const createdAt = new Date().toISOString();
    const stateWithBlock = reducer(initialState, {
      type: "ADD_NOTEBOOK_BLOCK",
      block: {
        id: "b1",
        title: "Block 1",
        type: "table",
        createdAt,
        upstreamVersionId: "sales",
        payload: { columns: ["a"], rows: [[1]], rowCount: 1 }
      }
    });
    const next = reducer(stateWithBlock, {
      type: "UPDATE_NOTEBOOK_BLOCK",
      block: {
        id: "b1",
        title: "Block 1",
        type: "table",
        createdAt,
        upstreamVersionId: "sales",
        payload: { columns: ["a"], rows: [[2]], rowCount: 1 }
      }
    });

    expect(next.notebookBlocks).toHaveLength(1);
    expect(next.notebookBlocks[0].payload).toEqual({
      columns: ["a"],
      rows: [[2]],
      rowCount: 1
    });
  });
});
