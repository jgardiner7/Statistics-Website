export const IMPORT_SAMPLE_ROW_FALLBACK = 200_000;

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isImportLimitErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("import exceeds v1 size limit") ||
    normalized.includes("import exceeds v1 row limit")
  );
}
