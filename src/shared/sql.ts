const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function sanitizeIdentifier(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, "_");
  const safe = trimmed.replace(/[^A-Za-z0-9_]/g, "");
  if (!safe) {
    return "table_1";
  }
  if (!IDENTIFIER_PATTERN.test(safe)) {
    return `t_${safe}`;
  }
  return safe;
}

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
