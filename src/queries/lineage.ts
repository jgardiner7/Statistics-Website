import type {
  ImpactDecision,
  PendingImpactUpdate,
  QueryTargetRef,
  SavedQuery,
  SavedQueryVersion
} from "../shared/types";

export interface SaveQueryInput {
  savedQueries: SavedQuery[];
  activeQueryId: string | null;
  queryName: string;
  sql: string;
  target: QueryTargetRef;
}

export interface SaveQueryResult {
  savedQueries: SavedQuery[];
  activeQueryId: string;
  pendingImpact: PendingImpactUpdate | null;
}

export interface PruneQueryVersionsInput {
  savedQueries: SavedQuery[];
  queryId: string;
  keepVersionIds?: string[];
  protectedVersionIds?: string[];
}

export interface PruneQueryVersionsResult {
  savedQueries: SavedQuery[];
  removedVersionIds: string[];
}

interface VersionRef {
  queryId: string;
  queryName: string;
  versionId: string;
}

export function getActiveVersion(query: SavedQuery): SavedQueryVersion {
  const version = query.versions.find(
    (entry) => entry.versionId === query.activeVersionId
  );
  if (!version) {
    throw new Error(`Query ${query.id} is missing active version.`);
  }
  return version;
}

function findQuery(savedQueries: SavedQuery[], queryId: string): SavedQuery {
  const query = savedQueries.find((entry) => entry.id === queryId);
  if (!query) {
    throw new Error(`Unknown query: ${queryId}`);
  }
  return query;
}

function buildDependencyIds(target: QueryTargetRef): string[] {
  return target.kind === "query_version" ? [target.versionId] : [];
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeDependencyIds(
  target: QueryTargetRef,
  dependencyIds: string[]
): string[] {
  const deduped = uniq(dependencyIds);
  if (target.kind !== "query_version") {
    return deduped;
  }
  if (deduped.includes(target.versionId)) {
    return deduped;
  }
  return [target.versionId, ...deduped];
}

interface VersionIndexes {
  versionsById: Map<string, SavedQueryVersion>;
}

function buildVersionIndexes(savedQueries: SavedQuery[]): VersionIndexes {
  const map = new Map<string, SavedQueryVersion>();
  for (const query of savedQueries) {
    for (const version of query.versions) {
      if (map.has(version.versionId)) {
        throw new Error(`Duplicate version ID detected: ${version.versionId}`);
      }
      map.set(version.versionId, version);
    }
  }
  return { versionsById: map };
}

export function validateSavedQueries(savedQueries: SavedQuery[]): void {
  const { versionsById } = buildVersionIndexes(savedQueries);

  for (const query of savedQueries) {
    if (!query.versions.length) {
      throw new Error(`Query ${query.name} has no versions.`);
    }
    const active = query.versions.find(
      (version) => version.versionId === query.activeVersionId
    );
    if (!active) {
      throw new Error(`Query ${query.name} is missing its active version.`);
    }

    for (const version of query.versions) {
      const normalizedDependencies = normalizeDependencyIds(
        version.target,
        version.dependsOnVersionIds
      );
      const uniqueDependencies = uniq(version.dependsOnVersionIds);
      if (version.target.kind !== "query_version" && normalizedDependencies.length > 0) {
        throw new Error(
          `Query ${query.name} has non-query target but declares version dependencies.`
        );
      }
      if (
        version.target.kind === "query_version" &&
        !version.dependsOnVersionIds.includes(version.target.versionId)
      ) {
        throw new Error(
          `Query ${query.name} dependency list must include target version ${version.target.versionId}.`
        );
      }
      if (uniqueDependencies.length !== version.dependsOnVersionIds.length) {
        throw new Error(
          `Query ${query.name} has duplicate dependency version IDs.`
        );
      }

      for (const dependency of version.dependsOnVersionIds) {
        if (!versionsById.has(dependency)) {
          throw new Error(
            `Query ${query.name} references missing dependency version ${dependency}.`
          );
        }
      }

      if (version.target.kind === "query_version") {
        if (!versionsById.has(version.target.versionId)) {
          throw new Error(
            `Query ${query.name} targets missing version ${version.target.versionId}.`
          );
        }
      }
    }
  }

  const visitState = new Map<string, 0 | 1 | 2>();
  const detectCycle = (versionId: string): boolean => {
    const state = visitState.get(versionId) ?? 0;
    if (state === 1) {
      return true;
    }
    if (state === 2) {
      return false;
    }

    visitState.set(versionId, 1);
    const version = versionsById.get(versionId);
    if (!version) {
      return false;
    }
    for (const dependency of version.dependsOnVersionIds) {
      if (detectCycle(dependency)) {
        return true;
      }
    }
    visitState.set(versionId, 2);
    return false;
  };

  for (const versionId of versionsById.keys()) {
    if (detectCycle(versionId)) {
      throw new Error("Saved query dependency graph must be acyclic.");
    }
  }
}

function dependencyDistance(
  startVersionId: string,
  targetVersionId: string,
  versionsById: Map<string, SavedQueryVersion>
): number | null {
  const queue: Array<{ id: string; depth: number }> = [
    { id: startVersionId, depth: 0 }
  ];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as { id: string; depth: number };
    if (current.id === targetVersionId) {
      return current.depth;
    }
    if (seen.has(current.id)) {
      continue;
    }
    seen.add(current.id);
    const version = versionsById.get(current.id);
    if (!version) {
      continue;
    }
    for (const dependency of version.dependsOnVersionIds) {
      queue.push({ id: dependency, depth: current.depth + 1 });
    }
  }
  return null;
}

function collectImpacts(
  savedQueries: SavedQuery[],
  editedQueryId: string,
  editedQueryName: string,
  oldVersionId: string,
  newVersionId: string
): PendingImpactUpdate | null {
  const { versionsById } = buildVersionIndexes(savedQueries);
  const items = savedQueries
    .filter((query) => query.id !== editedQueryId)
    .map((query) => {
      const distance = dependencyDistance(
        query.activeVersionId,
        oldVersionId,
        versionsById
      );
      if (distance === null) {
        return null;
      }
      return {
        queryId: query.id,
        queryName: query.name,
        fromVersionId: query.activeVersionId,
        depth: distance,
        decision: "keep_pinned" as ImpactDecision
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.depth - b.depth);

  if (items.length === 0) {
    return null;
  }

  return {
    editedQueryId,
    editedQueryName,
    oldVersionId,
    newVersionId,
    items
  };
}

export function saveQueryVersion(input: SaveQueryInput): SaveQueryResult {
  const trimmedSql = input.sql.trim();
  if (!trimmedSql) {
    throw new Error("SQL cannot be empty.");
  }
  const trimmedName = input.queryName.trim();
  const queryName = trimmedName || `Query ${input.savedQueries.length + 1}`;

  const now = new Date().toISOString();
  if (!input.activeQueryId) {
    const queryId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const query: SavedQuery = {
      id: queryId,
      name: queryName,
      activeVersionId: versionId,
      createdAt: now,
      versions: [
        {
          versionId,
          sql: trimmedSql,
          target: input.target,
          dependsOnVersionIds: buildDependencyIds(input.target),
          createdAt: now
        }
      ]
    };
    const savedQueries = [query, ...input.savedQueries];
    validateSavedQueries(savedQueries);
    return {
      savedQueries,
      activeQueryId: query.id,
      pendingImpact: null
    };
  }

  const existing = findQuery(input.savedQueries, input.activeQueryId);
  const oldVersionId = existing.activeVersionId;
  const newVersionId = crypto.randomUUID();
  const nextVersion: SavedQueryVersion = {
    versionId: newVersionId,
    sql: trimmedSql,
    target: input.target,
    dependsOnVersionIds: buildDependencyIds(input.target),
    createdAt: now
  };
  const updatedQuery: SavedQuery = {
    ...existing,
    name: queryName,
    activeVersionId: newVersionId,
    versions: [...existing.versions, nextVersion]
  };
  const savedQueries = input.savedQueries.map((query) =>
    query.id === existing.id ? updatedQuery : query
  );
  validateSavedQueries(savedQueries);

  return {
    savedQueries,
    activeQueryId: existing.id,
    pendingImpact: collectImpacts(
      savedQueries,
      existing.id,
      existing.name,
      oldVersionId,
      newVersionId
    )
  };
}

function remapTarget(
  target: QueryTargetRef,
  versionRemap: Map<string, VersionRef>
): QueryTargetRef {
  if (target.kind !== "query_version") {
    return target;
  }
  const remapped = versionRemap.get(target.versionId);
  if (!remapped) {
    return target;
  }
  return {
    kind: "query_version",
    queryId: remapped.queryId,
    queryName: remapped.queryName,
    versionId: remapped.versionId
  };
}

function forkName(name: string, usedNames: Set<string>): string {
  const base = `${name} (fork)`;
  if (!usedNames.has(base)) {
    return base;
  }
  let i = 2;
  while (usedNames.has(`${base} ${i}`)) {
    i += 1;
  }
  return `${base} ${i}`;
}

export function applyImpactDecisions(
  savedQueries: SavedQuery[],
  pendingImpact: PendingImpactUpdate
): SavedQuery[] {
  validateSavedQueries(savedQueries);
  const ordered = [...pendingImpact.items].sort((a, b) => a.depth - b.depth);
  const versionRemap = new Map<string, VersionRef>();
  versionRemap.set(pendingImpact.oldVersionId, {
    queryId: pendingImpact.editedQueryId,
    queryName: pendingImpact.editedQueryName,
    versionId: pendingImpact.newVersionId
  });

  let updated = [...savedQueries];
  const usedNames = new Set(updated.map((query) => query.name));

  for (const item of ordered) {
    if (item.decision === "keep_pinned") {
      continue;
    }

    const query = findQuery(updated, item.queryId);
    const sourceVersion = query.versions.find(
      (version) => version.versionId === item.fromVersionId
    );
    if (!sourceVersion) {
      continue;
    }

    const newVersionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const remappedTarget = remapTarget(sourceVersion.target, versionRemap);
    const remappedDependencies = sourceVersion.dependsOnVersionIds.map(
      (dependency) => versionRemap.get(dependency)?.versionId ?? dependency
    );
    const cloned: SavedQueryVersion = {
      ...sourceVersion,
      versionId: newVersionId,
      target: remappedTarget,
      dependsOnVersionIds: normalizeDependencyIds(
        remappedTarget,
        remappedDependencies
      ),
      createdAt: now
    };

    if (item.decision === "adopt_new") {
      const rewritten: SavedQuery = {
        ...query,
        activeVersionId: newVersionId,
        versions: [...query.versions, cloned]
      };
      updated = updated.map((entry) =>
        entry.id === query.id ? rewritten : entry
      );
      versionRemap.set(sourceVersion.versionId, {
        queryId: query.id,
        queryName: query.name,
        versionId: newVersionId
      });
      continue;
    }

    const nextName = forkName(query.name, usedNames);
    const forkedQuery: SavedQuery = {
      id: crypto.randomUUID(),
      name: nextName,
      activeVersionId: newVersionId,
      createdAt: now,
      versions: [cloned]
    };
    usedNames.add(nextName);
    updated = [forkedQuery, ...updated];
    versionRemap.set(sourceVersion.versionId, {
      queryId: forkedQuery.id,
      queryName: forkedQuery.name,
      versionId: newVersionId
    });
  }

  validateSavedQueries(updated);
  return updated;
}

export function pruneQueryVersions(
  input: PruneQueryVersionsInput
): PruneQueryVersionsResult {
  validateSavedQueries(input.savedQueries);
  const query = findQuery(input.savedQueries, input.queryId);
  const keepSet = new Set<string>([
    query.activeVersionId,
    ...(input.keepVersionIds ?? [])
  ]);
  const removedVersionIds = query.versions
    .map((version) => version.versionId)
    .filter((versionId) => !keepSet.has(versionId));
  if (removedVersionIds.length === 0) {
    return {
      savedQueries: input.savedQueries,
      removedVersionIds: []
    };
  }

  const removedSet = new Set(removedVersionIds);
  const protectedSet = new Set(input.protectedVersionIds ?? []);
  for (const removedVersionId of removedSet) {
    if (protectedSet.has(removedVersionId)) {
      throw new Error(
        `Cannot prune version ${removedVersionId}: it is pinned by notebook/query state.`
      );
    }
  }

  for (const candidateQuery of input.savedQueries) {
    for (const version of candidateQuery.versions) {
      if (candidateQuery.id === query.id && removedSet.has(version.versionId)) {
        continue;
      }
      if (
        version.target.kind === "query_version" &&
        removedSet.has(version.target.versionId)
      ) {
        throw new Error(
          `Cannot prune: ${candidateQuery.name} depends on version ${version.target.versionId}.`
        );
      }
      const dependency = version.dependsOnVersionIds.find((versionId) =>
        removedSet.has(versionId)
      );
      if (dependency) {
        throw new Error(
          `Cannot prune: ${candidateQuery.name} depends on version ${dependency}.`
        );
      }
    }
  }

  const nextSavedQueries = input.savedQueries.map((candidateQuery) =>
    candidateQuery.id !== query.id
      ? candidateQuery
      : {
          ...candidateQuery,
          versions: candidateQuery.versions.filter(
            (version) => !removedSet.has(version.versionId)
          )
        }
  );
  validateSavedQueries(nextSavedQueries);
  return {
    savedQueries: nextSavedQueries,
    removedVersionIds
  };
}

export function formatQueryTarget(target: QueryTargetRef): string {
  if (target.kind === "table") {
    return `Table: ${target.tableName}`;
  }
  if (target.kind === "pipeline_step") {
    return target.pipelineSnapshot && target.pipelineSnapshot.length > 0
      ? `Pipeline: ${target.stepName} (pinned)`
      : `Pipeline: ${target.stepName}`;
  }
  return `Query: ${target.queryName}`;
}
