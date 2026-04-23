export interface TableRegistryDiff {
  missingInRegistry: string[];
  staleInRegistry: string[];
}

export function diffTableRegistry(
  registryTables: string[],
  discoveredTables: string[]
): TableRegistryDiff {
  const registrySet = new Set(registryTables);
  const discoveredSet = new Set(discoveredTables);
  return {
    missingInRegistry: discoveredTables.filter((tableName) => !registrySet.has(tableName)),
    staleInRegistry: registryTables.filter((tableName) => !discoveredSet.has(tableName))
  };
}
