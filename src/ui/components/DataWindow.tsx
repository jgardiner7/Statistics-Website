import { useEffect, useRef, useState } from "react";
import type { PipelineStep, SavedQuery, TablePreview } from "../../shared/types";
import { formatQueryTarget, getActiveVersion } from "../../queries/lineage";
import type { DataTab } from "../state";
import { DataGrid } from "./DataGrid";
import { TabBar } from "./TabBar";

const AUTOLOAD_BUFFER_ROWS = 10;
const MIN_AUTOLOAD_TARGET_ROWS = 20;
const MIN_MEASURABLE_GRID_HEIGHT_PX = 80;
const FALLBACK_ROW_HEIGHT_PX = 24;
const COMMON_DUCKDB_TYPES = [
  "VARCHAR",
  "BOOLEAN",
  "INTEGER",
  "BIGINT",
  "DOUBLE",
  "DECIMAL(18,4)",
  "DATE",
  "TIMESTAMP"
];

function normalizeTypeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

interface DataWindowProps {
  dataTab: DataTab;
  onDataTabChange: (tab: DataTab) => void;
  tables: TablePreview[];
  activeTableName: string | null;
  onTableChange: (tableName: string) => void;
  onImportCsv: () => void;
  onRenameTable: (nextName: string) => void;
  onDeleteTable: (tableName: string) => void;
  onUpdateColumn: (input: {
    tableName: string;
    columnName: string;
    nextName: string;
    nextType: string;
    nextNullable?: boolean;
  }) => void;
  onLoadMoreRows: () => void;
  canLoadMoreRows: boolean;
  loadedRowCount: number;
  transformTableName: string | null;
  onTransformTableChange: (tableName: string) => void;
  pipelineSteps: PipelineStep[];
  activePipelineStepId: string | null;
  onSelectPipelineStep: (stepId: string) => void;
  onCreateTransform: (tableName: string | null) => void;
  onRenamePipelineStep: (stepId: string, nextName: string) => void;
  onTogglePipelineStep: (stepId: string) => void;
  onMovePipelineStep: (stepId: string, direction: "up" | "down") => void;
  onRemovePipelineStep: (stepId: string) => void;
  savedQueries: SavedQuery[];
  activeQueryId: string | null;
  onCreateQuery: () => void;
  onRenameQuery: (queryId: string, nextName: string) => void;
  onPruneQueryVersions: (queryId: string) => void;
  onSelectQuery: (queryId: string) => void;
}

function DataTabBody({
  tables,
  activeTableName,
  onTableChange,
  onImportCsv,
  onRenameTable,
  onDeleteTable,
  onUpdateColumn,
  onLoadMoreRows,
  canLoadMoreRows,
  loadedRowCount
}: Pick<
  DataWindowProps,
  | "tables"
  | "activeTableName"
  | "onTableChange"
  | "onImportCsv"
  | "onRenameTable"
  | "onDeleteTable"
  | "onUpdateColumn"
  | "onLoadMoreRows"
  | "canLoadMoreRows"
  | "loadedRowCount"
>) {
  const activeTable =
    tables.find((table) => table.tableName === activeTableName) ?? tables[0];
  const [renameInput, setRenameInput] = useState(activeTable?.tableName ?? "");
  const [editingColumn, setEditingColumn] = useState<{
    originalName: string;
    nextName: string;
    currentType: string;
    nextType: string;
    currentNullable: boolean;
    nextNullable: boolean;
  } | null>(null);
  const [selectedTypePreset, setSelectedTypePreset] = useState("custom");
  const [columnEditError, setColumnEditError] = useState("");
  const previewGridRef = useRef<HTMLDivElement | null>(null);
  const autoLoadTargetRowsRef = useRef<number | null>(null);
  const lastAutoLoadRequestAtRowCountRef = useRef<number | null>(null);

  useEffect(() => {
    setRenameInput(activeTable?.tableName ?? "");
    setEditingColumn(null);
    setSelectedTypePreset("custom");
    setColumnEditError("");
  }, [activeTable?.tableName]);

  useEffect(() => {
    autoLoadTargetRowsRef.current = null;
    lastAutoLoadRequestAtRowCountRef.current = null;
  }, [activeTable?.tableName]);

  useEffect(() => {
    if (!activeTable || !canLoadMoreRows) {
      lastAutoLoadRequestAtRowCountRef.current = null;
      return;
    }
    const container = previewGridRef.current;
    if (!container) {
      return;
    }
    if (container.clientHeight < MIN_MEASURABLE_GRID_HEIGHT_PX) {
      return;
    }

    if (autoLoadTargetRowsRef.current === null) {
      const table = container.querySelector("table");
      const headerHeight =
        table?.querySelector("thead")?.getBoundingClientRect().height ??
        FALLBACK_ROW_HEIGHT_PX;
      const sampleRowHeight =
        table?.querySelector("tbody tr")?.getBoundingClientRect().height ??
        FALLBACK_ROW_HEIGHT_PX;
      const availableBodyHeight = Math.max(0, container.clientHeight - headerHeight);
      const estimatedVisibleRows = Math.max(
        1,
        Math.floor(availableBodyHeight / Math.max(1, sampleRowHeight))
      );
      const targetRows = Math.max(
        MIN_AUTOLOAD_TARGET_ROWS,
        estimatedVisibleRows + AUTOLOAD_BUFFER_ROWS
      );
      autoLoadTargetRowsRef.current = Math.min(activeTable.rowCount, targetRows);
    }

    const autoLoadTargetRows =
      autoLoadTargetRowsRef.current ?? MIN_AUTOLOAD_TARGET_ROWS;
    if (loadedRowCount >= autoLoadTargetRows) {
      lastAutoLoadRequestAtRowCountRef.current = null;
      return;
    }
    if (lastAutoLoadRequestAtRowCountRef.current === loadedRowCount) {
      return;
    }

    lastAutoLoadRequestAtRowCountRef.current = loadedRowCount;
    const timer = window.setTimeout(() => {
      onLoadMoreRows();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTable, canLoadMoreRows, loadedRowCount, onLoadMoreRows]);

  return (
    <div className="pane-body data-pane-body">
      <div className="inline-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onImportCsv}
        >
          Import CSV
        </button>
      </div>
      <div className="inline-row">
        <label htmlFor="active-table-select">Table:</label>
        <select
          id="active-table-select"
          value={activeTable?.tableName ?? ""}
          onChange={(event) => onTableChange(event.target.value)}
        >
          {tables.map((table) => (
            <option key={table.tableName} value={table.tableName}>
              {table.tableName}
            </option>
          ))}
        </select>
      </div>
      <div className="hint-line">
        {activeTable
          ? `${loadedRowCount.toLocaleString()} of ${activeTable.rowCount.toLocaleString()} rows loaded`
          : "Upload a CSV to start."}
      </div>
      {activeTable ? (
        <div className="hint-line">Click a column header to rename it or change its type.</div>
      ) : null}
      <div className="inline-row">
        <label htmlFor="rename-table-input">Rename:</label>
        <input
          id="rename-table-input"
          type="text"
          value={renameInput}
          disabled={!activeTable}
          onChange={(event) => setRenameInput(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-secondary compact"
          disabled={
            !activeTable || !renameInput.trim() || renameInput.trim() === activeTable.tableName
          }
          onClick={() => onRenameTable(renameInput)}
        >
          Rename
        </button>
        <button
          type="button"
          className="btn btn-ghost compact danger"
          disabled={!activeTable}
          onClick={() => {
            if (!activeTable) {
              return;
            }
            onDeleteTable(activeTable.tableName);
          }}
        >
          Delete Dataset
        </button>
      </div>
      <DataGrid
        containerRef={previewGridRef}
        className="data-preview-grid"
        columns={activeTable?.columns.map((column) => column.name) ?? []}
        rows={activeTable?.rows ?? []}
        emptyText="No active table preview."
        onColumnHeaderClick={(_, columnIndex) => {
          const column = activeTable?.columns[columnIndex];
          if (!activeTable || !column) {
            return;
          }
          setEditingColumn({
            originalName: column.name,
            nextName: column.name,
            currentType: column.type,
            nextType: column.type,
            currentNullable: column.nullable ?? true,
            nextNullable: column.nullable ?? true
          });
          const normalizedType = normalizeTypeText(column.type);
          const matchesCommon = COMMON_DUCKDB_TYPES.find(
            (typeName) => normalizeTypeText(typeName) === normalizedType
          );
          setSelectedTypePreset(matchesCommon ?? "custom");
          setColumnEditError("");
        }}
        columnHeaderTitle="Edit column name and type"
      />
      <div className="inline-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onLoadMoreRows}
          disabled={!canLoadMoreRows || !activeTable}
        >
          Load 10 more rows
        </button>
      </div>
      {activeTable && editingColumn && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setEditingColumn(null);
            setSelectedTypePreset("custom");
            setColumnEditError("");
          }}
        >
          <div
            className="impact-modal column-edit-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Edit Column</h3>
            <div className="hint-line">
              Table: {activeTable.tableName} | Column: {editingColumn.originalName}
            </div>
            <label htmlFor="column-edit-name">Column Name</label>
            <input
              id="column-edit-name"
              type="text"
              value={editingColumn.nextName}
              onChange={(event) => {
                const nextName = event.target.value;
                setEditingColumn((current) =>
                  current
                    ? {
                        ...current,
                        nextName
                      }
                    : current
                );
                setColumnEditError("");
              }}
            />
            <label htmlFor="column-edit-type">Column Type</label>
            <select
              id="column-edit-type-preset"
              value={selectedTypePreset}
              onChange={(event) => {
                const selected = event.target.value;
                setSelectedTypePreset(selected);
                if (selected !== "custom") {
                  setEditingColumn((current) =>
                    current
                      ? {
                          ...current,
                          nextType: selected
                        }
                      : current
                  );
                }
                setColumnEditError("");
              }}
            >
              {COMMON_DUCKDB_TYPES.map((typeName) => (
                <option key={`column-type-preset-${typeName}`} value={typeName}>
                  {typeName}
                </option>
              ))}
              <option value="custom">Custom (type manually)</option>
            </select>
            <input
              id="column-edit-type"
              type="text"
              list="duckdb-column-types"
              value={editingColumn.nextType}
              onChange={(event) => {
                const nextType = event.target.value;
                setEditingColumn((current) =>
                  current
                    ? {
                        ...current,
                        nextType
                      }
                    : current
                );
                const normalizedType = normalizeTypeText(nextType);
                const matchesCommon = COMMON_DUCKDB_TYPES.find(
                  (typeName) => normalizeTypeText(typeName) === normalizedType
                );
                setSelectedTypePreset(matchesCommon ?? "custom");
                setColumnEditError("");
              }}
            />
            <datalist id="duckdb-column-types">
              {COMMON_DUCKDB_TYPES.map((typeName) => (
                <option key={`duckdb-type-${typeName}`} value={typeName} />
              ))}
            </datalist>
            <label className="checkbox-label compact" htmlFor="column-edit-nullable">
              <input
                id="column-edit-nullable"
                type="checkbox"
                checked={editingColumn.nextNullable}
                onChange={(event) => {
                  const nextNullable = event.target.checked;
                  setEditingColumn((current) =>
                    current
                      ? {
                          ...current,
                          nextNullable
                        }
                      : current
                  );
                  setColumnEditError("");
                }}
              />
              Allow NULL values
            </label>
            {columnEditError ? (
              <div className="storage-mode-banner">{columnEditError}</div>
            ) : null}
            <div className="inline-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setEditingColumn(null);
                  setSelectedTypePreset("custom");
                  setColumnEditError("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const nextName = editingColumn.nextName.trim();
                  const nextType = editingColumn.nextType.trim();
                  if (!nextName) {
                    setColumnEditError("Column name cannot be empty.");
                    return;
                  }
                  if (!nextType) {
                    setColumnEditError("Column type cannot be empty.");
                    return;
                  }

                  const unchangedName = nextName === editingColumn.originalName;
                  const unchangedType =
                    normalizeTypeText(nextType) ===
                    normalizeTypeText(editingColumn.currentType);
                  const unchangedNullable =
                    editingColumn.nextNullable === editingColumn.currentNullable;
                  if (unchangedName && unchangedType && unchangedNullable) {
                    setEditingColumn(null);
                    setSelectedTypePreset("custom");
                    setColumnEditError("");
                    return;
                  }

                  onUpdateColumn({
                    tableName: activeTable.tableName,
                    columnName: editingColumn.originalName,
                    nextName,
                    nextType,
                    nextNullable: editingColumn.nextNullable
                  });
                  setEditingColumn(null);
                  setSelectedTypePreset("custom");
                  setColumnEditError("");
                }}
              >
                Save Column
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TransformTabBody({
  tables,
  transformTableName,
  onTransformTableChange,
  pipelineSteps,
  activePipelineStepId,
  onSelectPipelineStep,
  onCreateTransform,
  onRenamePipelineStep,
  onTogglePipelineStep,
  onMovePipelineStep,
  onRemovePipelineStep
}: Pick<
  DataWindowProps,
  | "tables"
  | "transformTableName"
  | "onTransformTableChange"
  | "pipelineSteps"
  | "activePipelineStepId"
  | "onSelectPipelineStep"
  | "onCreateTransform"
  | "onRenamePipelineStep"
  | "onTogglePipelineStep"
  | "onMovePipelineStep"
  | "onRemovePipelineStep"
>) {
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepRenameInput, setStepRenameInput] = useState("");
  const tableNames = tables.map((table) => table.tableName);
  const resolvedTransformTableName =
    transformTableName && tableNames.some((name) => name === transformTableName)
      ? transformTableName
      : tableNames[0] ?? "";

  return (
    <div className="pane-body scroll-pane">
      <div className="inline-row">
        <label htmlFor="transform-table-select">Table:</label>
        <select
          id="transform-table-select"
          value={resolvedTransformTableName}
          disabled={tableNames.length === 0}
          onChange={(event) => onTransformTableChange(event.target.value)}
        >
          {tableNames.length === 0 ? (
            <option value="">No tables</option>
          ) : (
            tableNames.map((tableName) => (
              <option key={`transform-table-${tableName}`} value={tableName}>
                {tableName}
              </option>
            ))
          )}
        </select>
      </div>
      <div className="inline-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onCreateTransform(resolvedTransformTableName || null)}
        >
          New Transform
        </button>
      </div>
      {pipelineSteps.length === 0 ? (
        <div className="empty-box">
          No transform steps yet.
        </div>
      ) : (
        <ul className="list-block transforms-list">
          {pipelineSteps.map((step, index) => (
            <li
              key={step.id}
              className={step.id === activePipelineStepId ? "list-row active" : "list-row"}
            >
              <button
                type="button"
                className="list-row-button"
                onClick={() => onSelectPipelineStep(step.id)}
              >
                <span>
                  <span className="list-title">{step.name}</span>
                  <span className="list-subtitle">{step.type}</span>
                </span>
                <span className="inline-row">
                  <span className={step.enabled ? "pill enabled" : "pill disabled"}>
                    {step.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <span className="list-arrow">›</span>
                </span>
              </button>
              <div className="list-row-actions">
                {editingStepId === step.id ? (
                  <>
                    <input
                      type="text"
                      className="rename-input"
                      value={stepRenameInput}
                      onChange={(event) => setStepRenameInput(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary compact"
                      onClick={() => {
                        onRenamePipelineStep(step.id, stepRenameInput);
                        setEditingStepId(null);
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost compact"
                      onClick={() => setEditingStepId(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost compact"
                    onClick={() => {
                      setEditingStepId(step.id);
                      setStepRenameInput(step.name);
                    }}
                  >
                    Rename
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost compact"
                  onClick={() => onMovePipelineStep(step.id, "up")}
                  disabled={index === 0}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="btn btn-ghost compact"
                  onClick={() => onMovePipelineStep(step.id, "down")}
                  disabled={index === pipelineSteps.length - 1}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="btn btn-secondary compact"
                  onClick={() => onTogglePipelineStep(step.id)}
                >
                  {step.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost compact danger"
                  onClick={() => onRemovePipelineStep(step.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QueryTabBody({
  savedQueries,
  activeQueryId,
  onCreateQuery,
  onRenameQuery,
  onPruneQueryVersions,
  onSelectQuery
}: Pick<
  DataWindowProps,
  | "savedQueries"
  | "activeQueryId"
  | "onCreateQuery"
  | "onRenameQuery"
  | "onPruneQueryVersions"
  | "onSelectQuery"
>) {
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);
  const [queryRenameInput, setQueryRenameInput] = useState("");

  return (
    <div className="pane-body scroll-pane">
      <div className="inline-row">
        <button type="button" className="btn btn-primary" onClick={onCreateQuery}>
          New Query
        </button>
      </div>
      {savedQueries.length === 0 ? (
        <div className="empty-box">No saved queries yet.</div>
      ) : (
        <ul className="list-block sketch-queries">
          {savedQueries.map((query) => {
            const activeVersion = getActiveVersion(query);
            const activeVersionNumber =
              query.versions.findIndex(
                (version) => version.versionId === activeVersion.versionId
              ) + 1;
            return (
              <li
                key={query.id}
                className={query.id === activeQueryId ? "list-row active" : "list-row"}
              >
                <button
                  type="button"
                  className="list-row-button"
                  onClick={() => onSelectQuery(query.id)}
                >
                  <span>
                    <span className="list-title">{query.name}</span>
                    <span className="list-subtitle">
                      {formatQueryTarget(activeVersion.target)} | active v
                      {Math.max(activeVersionNumber, 1)} | total {query.versions.length}
                    </span>
                  </span>
                  <span className="list-arrow">›</span>
                </button>
                <div className="list-row-actions">
                  {editingQueryId === query.id ? (
                    <>
                      <input
                        type="text"
                        className="rename-input"
                        value={queryRenameInput}
                        onChange={(event) => setQueryRenameInput(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary compact"
                        onClick={() => {
                          onRenameQuery(query.id, queryRenameInput);
                          setEditingQueryId(null);
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost compact"
                        onClick={() => setEditingQueryId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost compact"
                      onClick={() => {
                        setEditingQueryId(query.id);
                        setQueryRenameInput(query.name);
                      }}
                    >
                      Rename
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost compact"
                    onClick={() => onPruneQueryVersions(query.id)}
                    disabled={query.versions.length <= 1}
                  >
                    Prune Old Versions
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function DataWindow(props: DataWindowProps) {
  const { dataTab, onDataTabChange } = props;

  return (
    <section className="window data-window">
      <TabBar
        value={dataTab}
        onChange={onDataTabChange}
        tabs={[
          { id: "data", label: "Data" },
          { id: "transforms", label: "Transforms" },
          { id: "queries", label: "Queries" }
        ]}
      />
      {dataTab === "data" && (
        <DataTabBody
          tables={props.tables}
          activeTableName={props.activeTableName}
          onTableChange={props.onTableChange}
          onImportCsv={props.onImportCsv}
          onRenameTable={props.onRenameTable}
          onDeleteTable={props.onDeleteTable}
          onUpdateColumn={props.onUpdateColumn}
          onLoadMoreRows={props.onLoadMoreRows}
          canLoadMoreRows={props.canLoadMoreRows}
          loadedRowCount={props.loadedRowCount}
        />
      )}
      {dataTab === "transforms" && (
        <TransformTabBody
          tables={props.tables}
          transformTableName={props.transformTableName}
          onTransformTableChange={props.onTransformTableChange}
          pipelineSteps={props.pipelineSteps}
          activePipelineStepId={props.activePipelineStepId}
          onSelectPipelineStep={props.onSelectPipelineStep}
          onCreateTransform={props.onCreateTransform}
          onRenamePipelineStep={props.onRenamePipelineStep}
          onTogglePipelineStep={props.onTogglePipelineStep}
          onMovePipelineStep={props.onMovePipelineStep}
          onRemovePipelineStep={props.onRemovePipelineStep}
        />
      )}
      {dataTab === "queries" && (
        <QueryTabBody
          savedQueries={props.savedQueries}
          activeQueryId={props.activeQueryId}
          onCreateQuery={props.onCreateQuery}
          onRenameQuery={props.onRenameQuery}
          onPruneQueryVersions={props.onPruneQueryVersions}
          onSelectQuery={props.onSelectQuery}
        />
      )}
    </section>
  );
}
