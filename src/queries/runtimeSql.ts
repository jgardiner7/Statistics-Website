import { buildPipelineSqlThroughStep } from "../pipeline/compiler";
import type {
  PipelineStep,
  SavedQuery,
  SavedQueryVersion
} from "../shared/types";
import { quoteIdentifier, sanitizeIdentifier } from "../shared/sql";
import { getActiveVersion } from "./lineage";

interface BuildRuntimeSqlInput {
  userSql: string;
  fallbackTableName: string | null;
  target: SavedQueryVersion["target"] | null;
  savedQueries: SavedQuery[];
  pipelineSteps: PipelineStep[];
  pipelineStepsByTable?: Record<string, PipelineStep[]>;
}

interface NamedReferenceDefinition {
  alias: string;
  resolveSql: () => string;
}

function isSelectLike(sql: string): boolean {
  return /^\s*(with|select)\b/i.test(sql);
}

function versionLookup(savedQueries: SavedQuery[]): Map<string, SavedQueryVersion> {
  const map = new Map<string, SavedQueryVersion>();
  for (const query of savedQueries) {
    for (const version of query.versions) {
      if (map.has(version.versionId)) {
        throw new Error(`Duplicate query version ID: ${version.versionId}`);
      }
      map.set(version.versionId, version);
    }
  }
  return map;
}

function resolveVersionSourceSql(
  versionId: string,
  versionsById: Map<string, SavedQueryVersion>,
  resolvePipelineSteps: (baseTableName: string | null) => PipelineStep[],
  visiting = new Set<string>()
): string {
  if (visiting.has(versionId)) {
    throw new Error("Detected cyclical saved query dependency.");
  }
  visiting.add(versionId);
  const version = versionsById.get(versionId);
  if (!version) {
    throw new Error(`Missing query version: ${versionId}`);
  }

  let sourceSql: string;
  if (version.target.kind === "table") {
    sourceSql = `SELECT * FROM ${quoteIdentifier(version.target.tableName)}`;
  } else if (version.target.kind === "pipeline_step") {
    const pipelineSteps =
      version.target.pipelineSnapshot && version.target.pipelineSnapshot.length > 0
        ? version.target.pipelineSnapshot
        : resolvePipelineSteps(version.target.baseTableName);
    sourceSql = buildPipelineSqlThroughStep(
      pipelineSteps,
      version.target.baseTableName,
      version.target.stepId
    );
  } else {
    sourceSql = resolveVersionSourceSql(
      version.target.versionId,
      versionsById,
      resolvePipelineSteps,
      visiting
    );
  }
  const body = version.sql.trim() || "SELECT * FROM source";
  visiting.delete(versionId);
  return `WITH source AS (${sourceSql}) SELECT * FROM (${body}) AS _sf_saved_version`;
}

function resolveTargetSql(
  target: SavedQueryVersion["target"] | null,
  fallbackTableName: string | null,
  savedQueries: SavedQuery[],
  resolvePipelineSteps: (baseTableName: string | null) => PipelineStep[]
): string {
  if (!target) {
    if (!fallbackTableName) {
      throw new Error("No table or query target available.");
    }
    return `SELECT * FROM ${quoteIdentifier(fallbackTableName)}`;
  }
  if (target.kind === "table") {
    return `SELECT * FROM ${quoteIdentifier(target.tableName)}`;
  }
  if (target.kind === "pipeline_step") {
    const pipelineSteps =
      target.pipelineSnapshot && target.pipelineSnapshot.length > 0
        ? target.pipelineSnapshot
        : resolvePipelineSteps(target.baseTableName);
    return buildPipelineSqlThroughStep(
      pipelineSteps,
      target.baseTableName,
      target.stepId
    );
  }
  return resolveVersionSourceSql(
    target.versionId,
    versionLookup(savedQueries),
    resolvePipelineSteps
  );
}

function uniqueReferenceName(rawName: string, usedNames: Set<string>): string {
  const normalized = sanitizeIdentifier(rawName || "ref");
  let candidate = normalized.toLowerCase() === "source" ? `${normalized}_ref` : normalized;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${normalized}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAliasReferenced(userSql: string, alias: string): boolean {
  const escaped = escapeRegExp(alias);
  const bareIdentifierPattern = new RegExp(`\\b${escaped}\\b`, "i");
  const quotedIdentifierPattern = new RegExp(`"${escaped}"`, "i");
  return (
    bareIdentifierPattern.test(userSql) || quotedIdentifierPattern.test(userSql)
  );
}

function resolveNamedReferenceBaseTable(
  target: SavedQueryVersion["target"] | null,
  fallbackTableName: string | null
): string | null {
  if (!target) {
    return fallbackTableName;
  }
  if (target.kind === "table") {
    return target.tableName;
  }
  if (target.kind === "pipeline_step") {
    return target.baseTableName;
  }
  return fallbackTableName;
}

function buildNamedReferenceDefinitions(
  namedReferenceBaseTable: string | null,
  pipelineTableNames: string[],
  savedQueries: SavedQuery[],
  resolvePipelineSteps: (baseTableName: string | null) => PipelineStep[]
): NamedReferenceDefinition[] {
  const usedNames = new Set<string>(["source"]);
  let versionsById: Map<string, SavedQueryVersion> | null = null;
  const getVersionsById = (): Map<string, SavedQueryVersion> => {
    if (!versionsById) {
      versionsById = versionLookup(savedQueries);
    }
    return versionsById;
  };
  const definitions: NamedReferenceDefinition[] = [];

  for (const query of savedQueries) {
    const alias = uniqueReferenceName(query.name, usedNames);
    const versionId = getActiveVersion(query).versionId;
    definitions.push({
      alias,
      resolveSql: () => {
        const sourceSql = resolveVersionSourceSql(
          versionId,
          getVersionsById(),
          resolvePipelineSteps
        );
        return `
          ${quoteIdentifier(alias)} AS (
            SELECT * FROM (
              ${sourceSql}
            ) AS _sf_named_query_ref
          )
        `;
      }
    });
  }

  const pipelineTables = new Set<string>();
  if (namedReferenceBaseTable) {
    pipelineTables.add(namedReferenceBaseTable);
  }
  for (const tableName of pipelineTableNames) {
    pipelineTables.add(tableName);
  }
  for (const tableName of pipelineTables) {
    const pipelineSteps = resolvePipelineSteps(tableName);
    for (const step of pipelineSteps) {
      const rawAliases = new Set<string>();
      if (tableName === namedReferenceBaseTable) {
        rawAliases.add(step.name);
      }
      rawAliases.add(`${tableName}_${step.name}`);
      for (const rawAlias of rawAliases) {
        const alias = uniqueReferenceName(rawAlias, usedNames);
        definitions.push({
          alias,
          resolveSql: () => {
            const sourceSql = buildPipelineSqlThroughStep(
              pipelineSteps,
              tableName,
              step.id
            );
            return `
              ${quoteIdentifier(alias)} AS (
                ${sourceSql}
              )
            `;
          }
        });
      }
    }
  }

  return definitions;
}

export function buildRuntimeSql({
  userSql,
  fallbackTableName,
  target,
  savedQueries,
  pipelineSteps,
  pipelineStepsByTable
}: BuildRuntimeSqlInput): string {
  const trimmed = userSql.trim();
  const effectiveUserSql = trimmed || "SELECT * FROM source LIMIT 200";
  if (!isSelectLike(effectiveUserSql)) {
    return effectiveUserSql;
  }

  const resolvePipelineSteps = (baseTableName: string | null): PipelineStep[] => {
    if (baseTableName && pipelineStepsByTable) {
      const byTable = pipelineStepsByTable[baseTableName];
      if (Array.isArray(byTable)) {
        return byTable;
      }
    }
    return pipelineSteps;
  };

  const sourceSql = resolveTargetSql(
    target,
    fallbackTableName,
    savedQueries,
    resolvePipelineSteps
  );
  const namedReferenceBaseTable = resolveNamedReferenceBaseTable(
    target,
    fallbackTableName
  );
  const pipelineTableNames = pipelineStepsByTable
    ? Object.keys(pipelineStepsByTable)
    : namedReferenceBaseTable
      ? [namedReferenceBaseTable]
      : [];
  const namedReferenceDefinitions = buildNamedReferenceDefinitions(
    namedReferenceBaseTable,
    pipelineTableNames,
    savedQueries,
    resolvePipelineSteps
  );
  const namedReferenceCtes = namedReferenceDefinitions
    .filter((definition) => isAliasReferenced(effectiveUserSql, definition.alias))
    .map((definition) => definition.resolveSql());

  const cteClauses = [
    `
      source AS (
        ${sourceSql}
      )
    `,
    ...namedReferenceCtes
  ];
  return `
    WITH ${cteClauses.join(",\n")}
    SELECT * FROM (
      ${effectiveUserSql}
    ) AS _sf_user_query
  `;
}

export function getVersionByQueryId(
  savedQueries: SavedQuery[],
  queryId: string
): SavedQueryVersion {
  const query = savedQueries.find((entry) => entry.id === queryId);
  if (!query) {
    throw new Error(`Unknown query: ${queryId}`);
  }
  return getActiveVersion(query);
}
