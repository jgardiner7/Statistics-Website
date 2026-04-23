import { useEffect, useMemo, useState } from "react";
import type { MergeMode } from "../../shared/types";
import { sanitizeIdentifier } from "../../shared/sql";

function baseNameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "dataset";
}

interface ImportCsvModalProps {
  open: boolean;
  files: File[];
  existingTableNames: string[];
  initialMergeMode: MergeMode;
  initialDelimiter: string;
  initialHasHeader: boolean;
  onCancel: () => void;
  onConfirm: (input: {
    destination: "new" | "existing";
    tableName: string;
    mergeMode: MergeMode;
    delimiter: string;
    hasHeader: boolean;
  }) => void;
}

const NEW_TABLE_MODES: Array<{ value: MergeMode; label: string }> = [
  { value: "same_table_union_by_name", label: "Same table: union by name" },
  { value: "same_table_exact_schema", label: "Same table: exact schema" },
  { value: "same_table_by_position", label: "Same table: by position" },
  { value: "separate_tables", label: "Separate tables" }
];

const EXISTING_TABLE_MODES: Array<{ value: MergeMode; label: string }> = [
  { value: "same_table_union_by_name", label: "Union by name" },
  { value: "same_table_exact_schema", label: "Exact schema" },
  { value: "same_table_by_position", label: "By position" }
];

export function ImportCsvModal({
  open,
  files,
  existingTableNames,
  initialMergeMode,
  initialDelimiter,
  initialHasHeader,
  onCancel,
  onConfirm
}: ImportCsvModalProps) {
  const [destination, setDestination] = useState<"new" | "existing">("new");
  const [newTableName, setNewTableName] = useState("dataset");
  const [existingTableName, setExistingTableName] = useState("");
  const [mergeMode, setMergeMode] = useState<MergeMode>("same_table_union_by_name");
  const [delimiter, setDelimiter] = useState(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [errorText, setErrorText] = useState("");

  const isExistingTableEnabled = existingTableNames.length > 0;
  const mergeModeOptions =
    destination === "existing" ? EXISTING_TABLE_MODES : NEW_TABLE_MODES;

  useEffect(() => {
    if (!open || files.length === 0) {
      return;
    }
    const defaultNewTableName = sanitizeIdentifier(baseNameFromFile(files[0].name));
    setDestination("new");
    setNewTableName(defaultNewTableName);
    setExistingTableName(existingTableNames[0] ?? "");
    setMergeMode(initialMergeMode);
    setDelimiter(initialDelimiter || ",");
    setHasHeader(initialHasHeader);
    setErrorText("");
  }, [
    existingTableNames,
    files,
    initialDelimiter,
    initialHasHeader,
    initialMergeMode,
    isExistingTableEnabled,
    open
  ]);

  useEffect(() => {
    if (destination === "existing" && mergeMode === "separate_tables") {
      setMergeMode("same_table_union_by_name");
    }
  }, [destination, mergeMode]);

  const titleText = useMemo(() => {
    if (files.length === 0) {
      return "Import CSV";
    }
    if (files.length === 1) {
      return `Import ${files[0].name}`;
    }
    return `Import ${files.length} CSV files`;
  }, [files]);

  if (!open || files.length === 0) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="impact-modal import-modal">
        <h3>{titleText}</h3>
        <div className="hint-line">
          Choose destination table and CSV parse options before import.
        </div>

        <div className="import-modal-section">
          <strong>Destination</strong>
          <label className="checkbox-label">
            <input
              type="radio"
              name="import-destination"
              checked={destination === "new"}
              onChange={() => setDestination("new")}
            />
            Create new table
          </label>
          <input
            type="text"
            value={newTableName}
            disabled={destination !== "new"}
            onChange={(event) => setNewTableName(event.target.value)}
            placeholder="new_table_name"
          />

          {isExistingTableEnabled && (
            <>
              <label className="checkbox-label">
                <input
                  type="radio"
                  name="import-destination"
                  checked={destination === "existing"}
                  onChange={() => setDestination("existing")}
                />
                Merge into existing table
              </label>
              <select
                value={existingTableName}
                disabled={destination !== "existing"}
                onChange={(event) => setExistingTableName(event.target.value)}
              >
                {existingTableNames.map((tableName) => (
                  <option key={tableName} value={tableName}>
                    {tableName}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="import-modal-section">
          <strong>Import Options</strong>
          <label htmlFor="import-merge-mode">Merge mode</label>
          <select
            id="import-merge-mode"
            value={mergeMode}
            onChange={(event) => setMergeMode(event.target.value as MergeMode)}
          >
            {mergeModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label htmlFor="import-delimiter">Delimiter</label>
          <input
            id="import-delimiter"
            type="text"
            maxLength={1}
            value={delimiter}
            onChange={(event) => setDelimiter(event.target.value || ",")}
          />

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(event) => setHasHeader(event.target.checked)}
            />
            Header row
          </label>
        </div>

        {errorText ? <div className="storage-mode-banner">{errorText}</div> : null}

        <div className="inline-row">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const targetTableNameRaw =
                destination === "new" ? newTableName : existingTableName;
              const targetTableName = sanitizeIdentifier(targetTableNameRaw);
              if (!targetTableName.trim()) {
                setErrorText("Choose a valid table name before importing.");
                return;
              }
              if (destination === "existing" && !existingTableName) {
                setErrorText("Choose an existing table.");
                return;
              }
              if (!delimiter) {
                setErrorText("Delimiter is required.");
                return;
              }
              setErrorText("");
              onConfirm({
                destination,
                tableName: targetTableName,
                mergeMode,
                delimiter,
                hasHeader
              });
            }}
          >
            Start Import
          </button>
        </div>
      </div>
    </div>
  );
}
