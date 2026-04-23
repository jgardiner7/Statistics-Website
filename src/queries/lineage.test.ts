import { describe, expect, it } from "vitest";
import {
  applyImpactDecisions,
  getActiveVersion,
  pruneQueryVersions,
  saveQueryVersion,
  validateSavedQueries
} from "./lineage";

describe("saved query lineage", () => {
  it("creates a new saved query with an initial version", () => {
    const result = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Query 1",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });

    expect(result.savedQueries).toHaveLength(1);
    expect(result.pendingImpact).toBeNull();
    expect(result.savedQueries[0].versions).toHaveLength(1);
  });

  it("collects impact when editing an upstream query", () => {
    const q1 = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Query 1",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });
    const q1Version = getActiveVersion(q1.savedQueries[0]);

    const q2 = saveQueryVersion({
      savedQueries: q1.savedQueries,
      activeQueryId: null,
      queryName: "Query 2",
      sql: "SELECT * FROM source",
      target: {
        kind: "query_version",
        queryId: q1.savedQueries[0].id,
        queryName: q1.savedQueries[0].name,
        versionId: q1Version.versionId
      }
    });

    const edited = saveQueryVersion({
      savedQueries: q2.savedQueries,
      activeQueryId: q1.savedQueries[0].id,
      queryName: q1.savedQueries[0].name,
      sql: "SELECT * FROM source WHERE amount > 100",
      target: { kind: "table", tableName: "sales" }
    });

    expect(edited.pendingImpact).not.toBeNull();
    expect(edited.pendingImpact?.items).toHaveLength(1);
    expect(edited.pendingImpact?.items[0].queryName).toBe("Query 2");
    expect(edited.pendingImpact?.items[0].decision).toBe("keep_pinned");
  });

  it("applies fork/adopt decisions by creating new dependent versions", () => {
    const q1 = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Base",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });
    const q1Version = getActiveVersion(q1.savedQueries[0]);

    const q2 = saveQueryVersion({
      savedQueries: q1.savedQueries,
      activeQueryId: null,
      queryName: "Child",
      sql: "SELECT * FROM source",
      target: {
        kind: "query_version",
        queryId: q1.savedQueries[0].id,
        queryName: q1.savedQueries[0].name,
        versionId: q1Version.versionId
      }
    });

    const edited = saveQueryVersion({
      savedQueries: q2.savedQueries,
      activeQueryId: q1.savedQueries[0].id,
      queryName: q1.savedQueries[0].name,
      sql: "SELECT * FROM source WHERE amount > 0",
      target: { kind: "table", tableName: "sales" }
    });

    if (!edited.pendingImpact) {
      throw new Error("Expected pending impact.");
    }
    edited.pendingImpact.items[0].decision = "adopt_new";
    const applied = applyImpactDecisions(edited.savedQueries, edited.pendingImpact);
    const child = applied.find((query) => query.name === "Child");
    if (!child) {
      throw new Error("Missing child query");
    }
    expect(child.versions.length).toBe(2);
  });

  it("forks a dependent query into a separate saved query entry", () => {
    const q1 = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Base",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });
    const q1Version = getActiveVersion(q1.savedQueries[0]);

    const q2 = saveQueryVersion({
      savedQueries: q1.savedQueries,
      activeQueryId: null,
      queryName: "Child",
      sql: "SELECT * FROM source",
      target: {
        kind: "query_version",
        queryId: q1.savedQueries[0].id,
        queryName: q1.savedQueries[0].name,
        versionId: q1Version.versionId
      }
    });

    const edited = saveQueryVersion({
      savedQueries: q2.savedQueries,
      activeQueryId: q1.savedQueries[0].id,
      queryName: q1.savedQueries[0].name,
      sql: "SELECT * FROM source WHERE amount > 0",
      target: { kind: "table", tableName: "sales" }
    });

    if (!edited.pendingImpact) {
      throw new Error("Expected pending impact.");
    }
    edited.pendingImpact.items[0].decision = "fork_dependent";

    const applied = applyImpactDecisions(edited.savedQueries, edited.pendingImpact);
    const originalChild = applied.find((query) => query.name === "Child");
    if (!originalChild) {
      throw new Error("Missing original child query");
    }
    expect(originalChild.versions.length).toBe(1);

    const forked = applied.find(
      (query) => query.id !== originalChild.id && query.name.startsWith("Child (fork)")
    );
    if (!forked) {
      throw new Error("Missing forked child query");
    }
    expect(forked.versions.length).toBe(1);
    const forkedActiveVersion = getActiveVersion(forked);
    expect(forkedActiveVersion.target.kind).toBe("query_version");
    if (forkedActiveVersion.target.kind !== "query_version") {
      throw new Error("Expected query_version target");
    }
    expect(forkedActiveVersion.target.versionId).toBe(
      edited.pendingImpact.newVersionId
    );
  });

  it("rejects persisted query graphs that contain dependency cycles", () => {
    const now = new Date().toISOString();
    expect(() =>
      validateSavedQueries([
        {
          id: "q1",
          name: "Q1",
          activeVersionId: "v1",
          createdAt: now,
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
              createdAt: now
            }
          ]
        },
        {
          id: "q2",
          name: "Q2",
          activeVersionId: "v2",
          createdAt: now,
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
              createdAt: now
            }
          ]
        }
      ])
    ).toThrow("acyclic");
  });

  it("applies transitive adopt decisions from upstream to downstream dependents", () => {
    const q1 = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Q1",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });
    const q1Active = getActiveVersion(q1.savedQueries[0]);

    const q2 = saveQueryVersion({
      savedQueries: q1.savedQueries,
      activeQueryId: null,
      queryName: "Q2",
      sql: "SELECT * FROM source",
      target: {
        kind: "query_version",
        queryId: q1.savedQueries[0].id,
        queryName: "Q1",
        versionId: q1Active.versionId
      }
    });
    const q2Query = q2.savedQueries.find((query) => query.name === "Q2");
    if (!q2Query) {
      throw new Error("Missing Q2");
    }
    const q2Active = getActiveVersion(q2Query);

    const q3 = saveQueryVersion({
      savedQueries: q2.savedQueries,
      activeQueryId: null,
      queryName: "Q3",
      sql: "SELECT * FROM source",
      target: {
        kind: "query_version",
        queryId: q2Query.id,
        queryName: "Q2",
        versionId: q2Active.versionId
      }
    });

    const edited = saveQueryVersion({
      savedQueries: q3.savedQueries,
      activeQueryId: q1.savedQueries[0].id,
      queryName: "Q1",
      sql: "SELECT * FROM source WHERE amount > 10",
      target: { kind: "table", tableName: "sales" }
    });
    if (!edited.pendingImpact) {
      throw new Error("Expected pending impact");
    }
    for (const item of edited.pendingImpact.items) {
      item.decision = "adopt_new";
    }

    const applied = applyImpactDecisions(edited.savedQueries, edited.pendingImpact);
    const nextQ2 = applied.find((query) => query.name === "Q2");
    const nextQ3 = applied.find((query) => query.name === "Q3");
    if (!nextQ2 || !nextQ3) {
      throw new Error("Missing downstream queries");
    }
    const nextQ2Active = getActiveVersion(nextQ2);
    const nextQ3Active = getActiveVersion(nextQ3);
    expect(nextQ2.versions.length).toBe(2);
    expect(nextQ3.versions.length).toBe(2);
    expect(nextQ2Active.target.kind).toBe("query_version");
    if (nextQ2Active.target.kind !== "query_version") {
      throw new Error("Expected query target");
    }
    expect(nextQ2Active.target.versionId).toBe(edited.pendingImpact.newVersionId);
    expect(nextQ3Active.target.kind).toBe("query_version");
    if (nextQ3Active.target.kind !== "query_version") {
      throw new Error("Expected query target");
    }
    expect(nextQ3Active.target.versionId).toBe(nextQ2Active.versionId);
  });

  it("routes downstream adopts to forked upstream versions when parent is forked", () => {
    const q1 = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Q1",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });
    const q1Active = getActiveVersion(q1.savedQueries[0]);

    const q2 = saveQueryVersion({
      savedQueries: q1.savedQueries,
      activeQueryId: null,
      queryName: "Q2",
      sql: "SELECT * FROM source",
      target: {
        kind: "query_version",
        queryId: q1.savedQueries[0].id,
        queryName: "Q1",
        versionId: q1Active.versionId
      }
    });
    const q2Query = q2.savedQueries.find((query) => query.name === "Q2");
    if (!q2Query) {
      throw new Error("Missing Q2");
    }
    const q2Active = getActiveVersion(q2Query);

    const q3 = saveQueryVersion({
      savedQueries: q2.savedQueries,
      activeQueryId: null,
      queryName: "Q3",
      sql: "SELECT * FROM source",
      target: {
        kind: "query_version",
        queryId: q2Query.id,
        queryName: "Q2",
        versionId: q2Active.versionId
      }
    });

    const edited = saveQueryVersion({
      savedQueries: q3.savedQueries,
      activeQueryId: q1.savedQueries[0].id,
      queryName: "Q1",
      sql: "SELECT * FROM source WHERE amount > 10",
      target: { kind: "table", tableName: "sales" }
    });
    if (!edited.pendingImpact) {
      throw new Error("Expected pending impact");
    }
    const q2Impact = edited.pendingImpact.items.find((item) => item.queryName === "Q2");
    const q3Impact = edited.pendingImpact.items.find((item) => item.queryName === "Q3");
    if (!q2Impact || !q3Impact) {
      throw new Error("Missing impact entries");
    }
    q2Impact.decision = "fork_dependent";
    q3Impact.decision = "adopt_new";

    const applied = applyImpactDecisions(edited.savedQueries, edited.pendingImpact);
    const originalQ2 = applied.find((query) => query.name === "Q2");
    const forkedQ2 = applied.find((query) => query.name.startsWith("Q2 (fork)"));
    const nextQ3 = applied.find((query) => query.name === "Q3");
    if (!originalQ2 || !forkedQ2 || !nextQ3) {
      throw new Error("Missing expected queries");
    }
    expect(originalQ2.versions.length).toBe(1);
    expect(forkedQ2.versions.length).toBe(1);
    const forkedQ2Active = getActiveVersion(forkedQ2);
    const nextQ3Active = getActiveVersion(nextQ3);
    expect(nextQ3.versions.length).toBe(2);
    expect(nextQ3Active.target.kind).toBe("query_version");
    if (nextQ3Active.target.kind !== "query_version") {
      throw new Error("Expected query target");
    }
    expect(nextQ3Active.target.versionId).toBe(forkedQ2Active.versionId);
  });

  it("rejects invalid dependency metadata in persisted graphs", () => {
    const now = new Date().toISOString();
    expect(() =>
      validateSavedQueries([
        {
          id: "q1",
          name: "Q1",
          activeVersionId: "v1",
          createdAt: now,
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
              dependsOnVersionIds: [],
              createdAt: now
            }
          ]
        },
        {
          id: "q2",
          name: "Q2",
          activeVersionId: "v2",
          createdAt: now,
          versions: [
            {
              versionId: "v2",
              sql: "SELECT * FROM source",
              target: { kind: "table", tableName: "sales" },
              dependsOnVersionIds: [],
              createdAt: now
            }
          ]
        }
      ])
    ).toThrow("dependency list must include target version");

    expect(() =>
      validateSavedQueries([
        {
          id: "q1",
          name: "Q1",
          activeVersionId: "v1",
          createdAt: now,
          versions: [
            {
              versionId: "v1",
              sql: "SELECT * FROM source",
              target: { kind: "table", tableName: "sales" },
              dependsOnVersionIds: ["v2"],
              createdAt: now
            }
          ]
        },
        {
          id: "q2",
          name: "Q2",
          activeVersionId: "v2",
          createdAt: now,
          versions: [
            {
              versionId: "v2",
              sql: "SELECT * FROM source",
              target: { kind: "table", tableName: "sales" },
              dependsOnVersionIds: [],
              createdAt: now
            }
          ]
        }
      ])
    ).toThrow("non-query target");

    expect(() =>
      validateSavedQueries([
        {
          id: "q1",
          name: "Q1",
          activeVersionId: "v1",
          createdAt: now,
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
              dependsOnVersionIds: ["v2", "v2"],
              createdAt: now
            }
          ]
        },
        {
          id: "q2",
          name: "Q2",
          activeVersionId: "v2",
          createdAt: now,
          versions: [
            {
              versionId: "v2",
              sql: "SELECT * FROM source",
              target: { kind: "table", tableName: "sales" },
              dependsOnVersionIds: [],
              createdAt: now
            }
          ]
        }
      ])
    ).toThrow("duplicate dependency");
  });

  it("rejects duplicate version IDs across queries", () => {
    const now = new Date().toISOString();
    expect(() =>
      validateSavedQueries([
        {
          id: "q1",
          name: "Q1",
          activeVersionId: "shared",
          createdAt: now,
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
          activeVersionId: "shared",
          createdAt: now,
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
      ])
    ).toThrow("Duplicate version ID");
  });

  it("prunes inactive versions for a saved query", () => {
    const initial = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Q1",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });
    const queryId = initial.savedQueries[0].id;
    const edited = saveQueryVersion({
      savedQueries: initial.savedQueries,
      activeQueryId: queryId,
      queryName: "Q1",
      sql: "SELECT * FROM source WHERE amount > 10",
      target: { kind: "table", tableName: "sales" }
    });
    const q1Before = edited.savedQueries.find((query) => query.id === queryId);
    if (!q1Before) {
      throw new Error("Missing Q1 before prune");
    }
    expect(q1Before.versions).toHaveLength(2);

    const pruned = pruneQueryVersions({
      savedQueries: edited.savedQueries,
      queryId
    });
    const q1After = pruned.savedQueries.find((query) => query.id === queryId);
    if (!q1After) {
      throw new Error("Missing Q1 after prune");
    }
    expect(pruned.removedVersionIds).toHaveLength(1);
    expect(q1After.versions).toHaveLength(1);
    expect(q1After.versions[0].versionId).toBe(q1After.activeVersionId);
  });

  it("blocks prune when downstream queries depend on an old version", () => {
    const q1 = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Q1",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });
    const q1InitialVersion = getActiveVersion(q1.savedQueries[0]);
    const q2 = saveQueryVersion({
      savedQueries: q1.savedQueries,
      activeQueryId: null,
      queryName: "Q2",
      sql: "SELECT * FROM source",
      target: {
        kind: "query_version",
        queryId: q1.savedQueries[0].id,
        queryName: "Q1",
        versionId: q1InitialVersion.versionId
      }
    });
    const q1Edited = saveQueryVersion({
      savedQueries: q2.savedQueries,
      activeQueryId: q1.savedQueries[0].id,
      queryName: "Q1",
      sql: "SELECT * FROM source WHERE amount > 0",
      target: { kind: "table", tableName: "sales" }
    });

    expect(() =>
      pruneQueryVersions({
        savedQueries: q1Edited.savedQueries,
        queryId: q1.savedQueries[0].id
      })
    ).toThrow("depends on version");
  });

  it("blocks prune when versions are protected by external pins", () => {
    const q1 = saveQueryVersion({
      savedQueries: [],
      activeQueryId: null,
      queryName: "Q1",
      sql: "SELECT * FROM source",
      target: { kind: "table", tableName: "sales" }
    });
    const q1Edited = saveQueryVersion({
      savedQueries: q1.savedQueries,
      activeQueryId: q1.savedQueries[0].id,
      queryName: "Q1",
      sql: "SELECT * FROM source WHERE amount > 0",
      target: { kind: "table", tableName: "sales" }
    });
    const oldVersionId = q1.savedQueries[0].activeVersionId;

    expect(() =>
      pruneQueryVersions({
        savedQueries: q1Edited.savedQueries,
        queryId: q1.savedQueries[0].id,
        protectedVersionIds: [oldVersionId]
      })
    ).toThrow("pinned by notebook/query state");
  });
});
