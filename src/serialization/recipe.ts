import type {
  AnalysisRecipeV1,
  ColumnSchemaEdit,
  NotebookBlock,
  PipelineStep,
  SavedQuery,
  SourceFileMetadata
} from "../shared/types";
import { isPipelineStep } from "../pipeline/validation";

export interface BuildRecipeInput {
  sources: SourceFileMetadata[];
  pipeline: PipelineStep[];
  pipelinesByTable?: Record<string, PipelineStep[]>;
  activePipelineStepIdByTable?: Record<string, string | null>;
  selectedTransformTableName?: string | null;
  savedQueries: SavedQuery[];
  notebookBlocks: NotebookBlock[];
  columnEditsByTable: Record<string, ColumnSchemaEdit[]>;
}

export function buildRecipe(input: BuildRecipeInput): AnalysisRecipeV1 {
  return {
    schemaVersion: "1.0",
    createdAt: new Date().toISOString(),
    sources: input.sources,
    pipeline: input.pipeline,
    pipelinesByTable: input.pipelinesByTable,
    activePipelineStepIdByTable: input.activePipelineStepIdByTable,
    selectedTransformTableName: input.selectedTransformTableName,
    savedQueries: input.savedQueries,
    notebookBlocks: input.notebookBlocks,
    columnEditsByTable: input.columnEditsByTable
  };
}

export function parseRecipe(json: string): AnalysisRecipeV1 {
  const parsed = JSON.parse(json) as Partial<AnalysisRecipeV1>;

  if (parsed.schemaVersion !== "1.0") {
    throw new Error("Unsupported recipe schema version");
  }
  if (!Array.isArray(parsed.sources)) {
    throw new Error("Invalid recipe: missing sources");
  }
  if (!Array.isArray(parsed.pipeline)) {
    throw new Error("Invalid recipe: missing pipeline");
  }
  parsed.pipeline.forEach((step, index) => {
    if (!isPipelineStep(step)) {
      throw new Error(`Invalid recipe: invalid pipeline step at index ${index}`);
    }
  });
  if (parsed.pipelinesByTable !== undefined) {
    if (
      typeof parsed.pipelinesByTable !== "object" ||
      parsed.pipelinesByTable === null ||
      Array.isArray(parsed.pipelinesByTable)
    ) {
      throw new Error("Invalid recipe: pipelinesByTable must be an object map");
    }
    for (const [tableName, steps] of Object.entries(parsed.pipelinesByTable)) {
      if (!Array.isArray(steps)) {
        throw new Error(
          `Invalid recipe: pipelinesByTable entry for ${tableName} must be an array`
        );
      }
      steps.forEach((step, index) => {
        if (!isPipelineStep(step)) {
          throw new Error(
            `Invalid recipe: invalid pipelinesByTable step at ${tableName}[${index}]`
          );
        }
      });
    }
  }
  if (parsed.activePipelineStepIdByTable !== undefined) {
    if (
      typeof parsed.activePipelineStepIdByTable !== "object" ||
      parsed.activePipelineStepIdByTable === null ||
      Array.isArray(parsed.activePipelineStepIdByTable)
    ) {
      throw new Error("Invalid recipe: activePipelineStepIdByTable must be an object map");
    }
    for (const [tableName, value] of Object.entries(parsed.activePipelineStepIdByTable)) {
      if (typeof value !== "string" && value !== null) {
        throw new Error(
          `Invalid recipe: activePipelineStepIdByTable entry for ${tableName} must be string|null`
        );
      }
    }
  }
  if (
    parsed.selectedTransformTableName !== undefined &&
    typeof parsed.selectedTransformTableName !== "string" &&
    parsed.selectedTransformTableName !== null
  ) {
    throw new Error("Invalid recipe: selectedTransformTableName must be string|null");
  }
  if (!Array.isArray(parsed.savedQueries)) {
    throw new Error("Invalid recipe: missing savedQueries");
  }
  if (!Array.isArray(parsed.notebookBlocks)) {
    throw new Error("Invalid recipe: missing notebookBlocks");
  }
  if (
    parsed.columnEditsByTable !== undefined &&
    (typeof parsed.columnEditsByTable !== "object" || parsed.columnEditsByTable === null)
  ) {
    throw new Error("Invalid recipe: columnEditsByTable must be an object map");
  }

  return parsed as AnalysisRecipeV1;
}
