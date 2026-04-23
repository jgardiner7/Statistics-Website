/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from "../shared/workerProtocol";
import { DuckDBRuntime } from "./runtime";

const runtime = new DuckDBRuntime();
const inFlightRequestIds = new Set<string>();

function success(request: WorkerRequest, payload: unknown): WorkerResponse {
  return {
    requestId: request.requestId,
    status: "ok",
    type: request.type,
    payload
  } as WorkerResponse;
}

function failure(request: WorkerRequest, error: unknown): WorkerResponse {
  return {
    requestId: request.requestId,
    status: "error",
    type: request.type,
    error: {
      code: "WORKER_ERROR",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    switch (request.type) {
      case "CANCEL_REQUEST": {
        const targetRequestId = request.payload.targetRequestId.trim();
        if (!targetRequestId || !inFlightRequestIds.has(targetRequestId)) {
          return success(request, { cancelled: false });
        }
        const cancelled = await runtime.cancelPendingQuery();
        return success(request, { cancelled });
      }
      case "INIT_ENGINE": {
        await runtime.init();
        return success(request, { ready: true });
      }
      case "IMPORT_CSVS": {
        const imported = await runtime.importCSVs(request.payload);
        return success(request, imported);
      }
      case "LIST_TABLES": {
        const tableNames = await runtime.listTables();
        return success(request, { tableNames });
      }
      case "RENAME_TABLE": {
        const renamed = await runtime.renameTable(
          request.payload.fromTableName,
          request.payload.toTableName
        );
        return success(request, renamed);
      }
      case "ALTER_TABLE_COLUMN": {
        const updated = await runtime.alterTableColumn(request.payload);
        return success(request, updated);
      }
      case "DELETE_TABLE": {
        const deleted = await runtime.deleteTable(request.payload.tableName);
        return success(request, deleted);
      }
      case "RESET_PROJECT": {
        const reset = await runtime.resetProject();
        return success(request, reset);
      }
      case "PREVIEW_TABLE": {
        const preview = await runtime.previewTable(
          request.payload.tableName,
          request.payload.limit
        );
        return success(request, preview);
      }
      case "RUN_SQL": {
        const result = await runtime.runSQL(
          request.payload.sql,
          request.payload.limit,
          request.payload.includeTotalRowCount,
          request.payload.offset
        );
        return success(request, result);
      }
      case "PROFILE_TABLE": {
        const profile = await runtime.profileTable(
          request.payload.tableName,
          request.payload.limitColumns
        );
        return success(request, profile);
      }
      case "PROFILE_SQL": {
        const profile = await runtime.profileSql(request.payload);
        return success(request, profile);
      }
      case "RUN_PIPELINE": {
        const result = await runtime.runPipeline(
          request.payload.baseTableName,
          request.payload.steps,
          request.payload.limit
        );
        return success(request, result);
      }
      case "RUN_WELCH_T_TEST": {
        const result = await runtime.runWelchTTest(request.payload);
        return success(request, result);
      }
      case "RUN_PEARSON_CORRELATION": {
        const result = await runtime.runPearsonCorrelation(request.payload);
        return success(request, result);
      }
      case "RUN_CHI_SQUARE_TEST": {
        const result = await runtime.runChiSquareTest(request.payload);
        return success(request, result);
      }
      case "RUN_OLS_REGRESSION": {
        const result = await runtime.runOLSRegression(request.payload);
        return success(request, result);
      }
      default: {
        return failure(request, "Unknown request type");
      }
    }
  } catch (error) {
    return failure(request, error);
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "CANCEL_REQUEST") {
    inFlightRequestIds.add(request.requestId);
  }
  try {
    const response = await handleRequest(request);
    self.postMessage(response);
  } finally {
    inFlightRequestIds.delete(request.requestId);
  }
};
