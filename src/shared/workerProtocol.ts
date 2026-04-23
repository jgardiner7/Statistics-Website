import type {
  ChiSquareTestResult,
  ColumnInfo,
  CorrelationMethod,
  MergeMode,
  OLSRegressionResult,
  PearsonCorrelationResult,
  PipelineStep,
  PrimitiveValue,
  TablePreview,
  TableProfile,
  WelchTTestResult
} from "./types";

export type WorkerRequest =
  | {
      requestId: string;
      type: "CANCEL_REQUEST";
      payload: {
        targetRequestId: string;
      };
    }
  | {
      requestId: string;
      type: "INIT_ENGINE";
    }
  | {
      requestId: string;
      type: "IMPORT_CSVS";
      payload: {
        tableName: string;
        mergeMode: MergeMode;
        appendToExisting?: boolean;
        sampleRows?: number;
        hasHeader: boolean;
        delimiter: string;
        files: Array<
          | {
              fileName: string;
              sizeBytes: number;
              buffer: ArrayBuffer;
              file?: never;
            }
          | {
              fileName: string;
              sizeBytes: number;
              file: File;
              buffer?: never;
            }
        >;
      };
    }
  | {
      requestId: string;
      type: "LIST_TABLES";
    }
  | {
      requestId: string;
      type: "RENAME_TABLE";
      payload: {
        fromTableName: string;
        toTableName: string;
      };
    }
  | {
      requestId: string;
      type: "ALTER_TABLE_COLUMN";
      payload: {
        tableName: string;
        columnName: string;
        nextName: string;
        nextType: string;
        nextNullable?: boolean;
      };
    }
  | {
      requestId: string;
      type: "DELETE_TABLE";
      payload: {
        tableName: string;
      };
    }
  | {
      requestId: string;
      type: "RESET_PROJECT";
    }
  | {
      requestId: string;
      type: "PREVIEW_TABLE";
      payload: {
        tableName: string;
        limit?: number;
      };
    }
  | {
      requestId: string;
      type: "RUN_SQL";
      payload: {
        sql: string;
        limit?: number;
        offset?: number;
        includeTotalRowCount?: boolean;
      };
    }
  | {
      requestId: string;
      type: "PROFILE_TABLE";
      payload: {
        tableName: string;
        limitColumns?: number;
      };
    }
  | {
      requestId: string;
      type: "PROFILE_SQL";
      payload: {
        sql: string;
        label?: string;
        limitColumns?: number;
      };
    }
  | {
      requestId: string;
      type: "RUN_PIPELINE";
      payload: {
        baseTableName: string;
        steps: PipelineStep[];
        limit?: number;
      };
    }
  | {
      requestId: string;
      type: "RUN_WELCH_T_TEST";
      payload: {
        sql: string;
        valueColumn: string;
        groupColumn: string;
        groupA: string;
        groupB: string;
        confidenceLevel?: number;
      };
    }
  | {
      requestId: string;
      type: "RUN_PEARSON_CORRELATION";
      payload: {
        sql: string;
        xColumn: string;
        yColumn: string;
        method?: CorrelationMethod;
        confidenceLevel?: number;
      };
    }
  | {
      requestId: string;
      type: "RUN_CHI_SQUARE_TEST";
      payload: {
        sql: string;
        rowColumn: string;
        columnColumn: string;
      };
    }
  | {
      requestId: string;
      type: "RUN_OLS_REGRESSION";
      payload: {
        sql: string;
        dependentColumn: string;
        independentColumns: string[];
        includeIntercept?: boolean;
        oneHotEncodeCategorical?: boolean;
        maxDiagnosticPoints?: number;
      };
    };

export type WorkerResponse =
  | {
      requestId: string;
      status: "ok";
      type:
        | "CANCEL_REQUEST"
        | "INIT_ENGINE"
        | "IMPORT_CSVS"
        | "LIST_TABLES"
        | "RENAME_TABLE"
        | "ALTER_TABLE_COLUMN"
        | "DELETE_TABLE"
        | "RESET_PROJECT"
        | "PREVIEW_TABLE"
        | "RUN_SQL"
        | "PROFILE_TABLE"
        | "PROFILE_SQL"
        | "RUN_PIPELINE"
        | "RUN_WELCH_T_TEST"
        | "RUN_PEARSON_CORRELATION"
        | "RUN_CHI_SQUARE_TEST"
        | "RUN_OLS_REGRESSION";
      payload:
        | {
            cancelled: boolean;
          }
        | { ready: true }
        | { tableNames: string[] }
        | { tableNames: string[]; importedInto: string[] }
        | { tableNames: string[]; renamedTo: string }
        | { tableName: string; columns: ColumnInfo[] }
        | { tableNames: string[]; deletedTableName: string }
        | { tableNames: string[]; cleared: true }
        | TablePreview
        | {
            columns: string[];
            rows: PrimitiveValue[][];
            rowCount: number;
          }
        | TableProfile
        | WelchTTestResult
        | PearsonCorrelationResult
        | ChiSquareTestResult
        | OLSRegressionResult;
    }
  | {
      requestId: string;
      status: "error";
      type: WorkerRequest["type"];
      error: {
        code: string;
        message: string;
      };
    };

export function makeRequestId(): string {
  return crypto.randomUUID();
}
