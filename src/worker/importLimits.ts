import type { MergeMode } from "../shared/types";

export const MAX_LOGICAL_TABLE_ROWS = 1_000_000;
export const MAX_LOGICAL_TABLE_BYTES = 250 * 1024 * 1024;

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function isMergeIntoSingleTable(mode: MergeMode): boolean {
  return mode !== "separate_tables";
}

interface ImportFileSize {
  sizeBytes: number;
}

export function assertImportByteLimits(
  mergeMode: MergeMode,
  normalizedBaseName: string,
  files: ImportFileSize[]
): void {
  if (isMergeIntoSingleTable(mergeMode)) {
    const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (totalBytes > MAX_LOGICAL_TABLE_BYTES) {
      throw new Error(
        `Import exceeds V1 size limit for table "${normalizedBaseName}". ` +
          `Limit: ${formatBytes(MAX_LOGICAL_TABLE_BYTES)}. Input size: ${formatBytes(totalBytes)}.`
      );
    }
    return;
  }

  files.forEach((file, index) => {
    if (file.sizeBytes <= MAX_LOGICAL_TABLE_BYTES) {
      return;
    }
    const tableName =
      files.length === 1 ? normalizedBaseName : `${normalizedBaseName}_${index + 1}`;
    throw new Error(
      `Import exceeds V1 size limit for table "${tableName}". ` +
        `Limit: ${formatBytes(MAX_LOGICAL_TABLE_BYTES)}. Input size: ${formatBytes(file.sizeBytes)}.`
    );
  });
}

export function assertImportRowLimit(tableName: string, rowCount: number): void {
  if (rowCount <= MAX_LOGICAL_TABLE_ROWS) {
    return;
  }
  throw new Error(
    `Import exceeds V1 row limit for table "${tableName}". ` +
      `Limit: ${MAX_LOGICAL_TABLE_ROWS.toLocaleString()} rows. ` +
      `Imported rows: ${Math.round(rowCount).toLocaleString()}.`
  );
}
