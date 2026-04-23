import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DataTab } from "../state";
import { DataWindow } from "./DataWindow";

describe("DataWindow", () => {
  function renderDataWindow(tab: DataTab = "data") {
    const onUpdateColumn = vi.fn();
    render(
      <DataWindow
        dataTab={tab}
        onDataTabChange={vi.fn()}
        tables={[
          {
            tableName: "sales",
            rowCount: 2,
            columns: [
              { name: "old_name", type: "VARCHAR", nullable: true },
              { name: "amount", type: "DOUBLE", nullable: true }
            ],
            rows: [
              ["a", 1],
              ["b", 2]
            ]
          }
        ]}
        activeTableName="sales"
        onTableChange={vi.fn()}
        onImportCsv={vi.fn()}
        onRenameTable={vi.fn()}
        onDeleteTable={vi.fn()}
        onUpdateColumn={onUpdateColumn}
        onLoadMoreRows={vi.fn()}
        canLoadMoreRows={false}
        loadedRowCount={2}
        transformTableName="sales"
        onTransformTableChange={vi.fn()}
        pipelineSteps={[]}
        activePipelineStepId={null}
        onSelectPipelineStep={vi.fn()}
        onCreateTransform={vi.fn()}
        onRenamePipelineStep={vi.fn()}
        onTogglePipelineStep={vi.fn()}
        onMovePipelineStep={vi.fn()}
        onRemovePipelineStep={vi.fn()}
        savedQueries={[]}
        activeQueryId={null}
        onCreateQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onPruneQueryVersions={vi.fn()}
        onSelectQuery={vi.fn()}
      />
    );

    return {
      onUpdateColumn
    };
  }

  it("opens column editor modal from header and submits rename/type changes", () => {
    const { onUpdateColumn } = renderDataWindow();

    fireEvent.click(screen.getByRole("button", { name: "old_name" }));
    expect(screen.getByText("Edit Column")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Column Name"), {
      target: { value: "customer_id" }
    });
    fireEvent.change(screen.getByLabelText("Column Type"), {
      target: { value: "BIGINT" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Column" }));

    expect(onUpdateColumn).toHaveBeenCalledTimes(1);
    expect(onUpdateColumn).toHaveBeenCalledWith({
      tableName: "sales",
      columnName: "old_name",
      nextName: "customer_id",
      nextType: "BIGINT",
      nextNullable: true
    });
  });

  it("invokes prune callback from queries tab", () => {
    const onPruneQueryVersions = vi.fn();
    const now = new Date().toISOString();
    render(
      <DataWindow
        dataTab="queries"
        onDataTabChange={vi.fn()}
        tables={[]}
        activeTableName={null}
        onTableChange={vi.fn()}
        onImportCsv={vi.fn()}
        onRenameTable={vi.fn()}
        onDeleteTable={vi.fn()}
        onUpdateColumn={vi.fn()}
        onLoadMoreRows={vi.fn()}
        canLoadMoreRows={false}
        loadedRowCount={0}
        transformTableName={null}
        onTransformTableChange={vi.fn()}
        pipelineSteps={[]}
        activePipelineStepId={null}
        onSelectPipelineStep={vi.fn()}
        onCreateTransform={vi.fn()}
        onRenamePipelineStep={vi.fn()}
        onTogglePipelineStep={vi.fn()}
        onMovePipelineStep={vi.fn()}
        onRemovePipelineStep={vi.fn()}
        savedQueries={[
          {
            id: "q1",
            name: "Query 1",
            activeVersionId: "v2",
            createdAt: now,
            versions: [
              {
                versionId: "v1",
                sql: "SELECT * FROM source",
                target: { kind: "table", tableName: "sales" },
                dependsOnVersionIds: [],
                createdAt: now
              },
              {
                versionId: "v2",
                sql: "SELECT * FROM source WHERE amount > 0",
                target: { kind: "table", tableName: "sales" },
                dependsOnVersionIds: [],
                createdAt: now
              }
            ]
          }
        ]}
        activeQueryId={null}
        onCreateQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onPruneQueryVersions={onPruneQueryVersions}
        onSelectQuery={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Prune Old Versions" }));
    expect(onPruneQueryVersions).toHaveBeenCalledTimes(1);
    expect(onPruneQueryVersions).toHaveBeenCalledWith("q1");
  });

  it("passes selected transform table when creating a new transform", () => {
    const onCreateTransform = vi.fn();
    render(
      <DataWindow
        dataTab="transforms"
        onDataTabChange={vi.fn()}
        tables={[
          {
            tableName: "sales",
            rowCount: 2,
            columns: [{ name: "amount", type: "DOUBLE" }],
            rows: [[1], [2]]
          },
          {
            tableName: "inventory",
            rowCount: 1,
            columns: [{ name: "sku", type: "VARCHAR" }],
            rows: [["A-1"]]
          }
        ]}
        activeTableName="sales"
        onTableChange={vi.fn()}
        onImportCsv={vi.fn()}
        onRenameTable={vi.fn()}
        onDeleteTable={vi.fn()}
        onUpdateColumn={vi.fn()}
        onLoadMoreRows={vi.fn()}
        canLoadMoreRows={false}
        loadedRowCount={2}
        transformTableName="inventory"
        onTransformTableChange={vi.fn()}
        pipelineSteps={[]}
        activePipelineStepId={null}
        onSelectPipelineStep={vi.fn()}
        onCreateTransform={onCreateTransform}
        onRenamePipelineStep={vi.fn()}
        onTogglePipelineStep={vi.fn()}
        onMovePipelineStep={vi.fn()}
        onRemovePipelineStep={vi.fn()}
        savedQueries={[]}
        activeQueryId={null}
        onCreateQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onPruneQueryVersions={vi.fn()}
        onSelectQuery={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "New Transform" }));
    expect(onCreateTransform).toHaveBeenCalledTimes(1);
    expect(onCreateTransform).toHaveBeenCalledWith("inventory");
  });
});
