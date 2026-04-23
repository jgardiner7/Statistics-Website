import { describe, expect, it } from "vitest";
import { diffTableRegistry } from "./tableRegistry";

describe("diffTableRegistry", () => {
  it("returns no differences when registry matches discovered tables", () => {
    const diff = diffTableRegistry(["sales", "inventory"], ["sales", "inventory"]);
    expect(diff).toEqual({
      missingInRegistry: [],
      staleInRegistry: []
    });
  });

  it("identifies missing tables that exist physically but not in registry", () => {
    const diff = diffTableRegistry(["sales"], ["sales", "inventory", "returns"]);
    expect(diff.missingInRegistry).toEqual(["inventory", "returns"]);
    expect(diff.staleInRegistry).toEqual([]);
  });

  it("identifies stale registry tables that no longer exist physically", () => {
    const diff = diffTableRegistry(["sales", "old_table"], ["sales"]);
    expect(diff.missingInRegistry).toEqual([]);
    expect(diff.staleInRegistry).toEqual(["old_table"]);
  });

  it("handles simultaneous missing and stale entries", () => {
    const diff = diffTableRegistry(
      ["sales", "legacy", "archive"],
      ["sales", "inventory", "new_table"]
    );
    expect(diff).toEqual({
      missingInRegistry: ["inventory", "new_table"],
      staleInRegistry: ["legacy", "archive"]
    });
  });
});
