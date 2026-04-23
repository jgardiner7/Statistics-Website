import type {
  ColumnSchemaEdit,
  MergeMode,
  NotebookBlock,
  PendingImpactUpdate,
  PipelineStep,
  QueryTargetRef,
  SavedQuery,
  SourceFileMetadata
} from "../shared/types";
import type { DataTab, ResultsTab, StorageMode, UIState } from "./state";

const DB_NAME = "statsfish_local";
const STORE_NAME = "project_state";
const STATE_KEY = "active";
const OPFS_DIR = "statsfish";
const OPFS_FILE = "project_state.json";

type StorageManagerWithOPFS = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

export interface PersistedState {
  dataTab: DataTab;
  resultsTab: ResultsTab;
  storageMode: StorageMode;
  mergeMode: MergeMode;
  hasHeader: boolean;
  delimiter: string;
  sources: SourceFileMetadata[];
  selectedTransformTableName?: string | null;
  pipelinesByTable?: Record<string, PipelineStep[]>;
  activePipelineStepIdByTable?: Record<string, string | null>;
  pipelineSteps: PipelineStep[];
  activePipelineStepId: string | null;
  activeQueryTarget: QueryTargetRef | null;
  pendingImpact: PendingImpactUpdate | null;
  sqlEditorText: string;
  savedQueries: SavedQuery[];
  activeQueryId: string | null;
  notebookBlocks: NotebookBlock[];
  columnEditsByTable?: Record<string, ColumnSchemaEdit[]>;
}

function supportsIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function supportsOpfs(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const storage = navigator.storage as StorageManagerWithOPFS | undefined;
  return typeof storage?.getDirectory === "function";
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsOpfs()) {
    return null;
  }
  const storage = navigator.storage as StorageManagerWithOPFS;
  return storage.getDirectory ? storage.getDirectory() : null;
}

async function readOpfsState(): Promise<PersistedState | null> {
  const root = await getOpfsRoot();
  if (!root) {
    return null;
  }

  try {
    const dir = await root.getDirectoryHandle(OPFS_DIR);
    const fileHandle = await dir.getFileHandle(OPFS_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text) as PersistedState;
  } catch {
    return null;
  }
}

async function writeOpfsState(payload: PersistedState): Promise<void> {
  const root = await getOpfsRoot();
  if (!root) {
    return;
  }

  const dir = await root.getDirectoryHandle(OPFS_DIR, {
    create: true
  });
  const fileHandle = await dir.getFileHandle(OPFS_FILE, {
    create: true
  });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload));
  await writable.close();
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function loadIndexedDbState(): Promise<PersistedState | null> {
  if (!supportsIndexedDb()) {
    return Promise.resolve(null);
  }
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(STATE_KEY);
        request.onsuccess = () => {
          resolve((request.result as PersistedState | undefined) ?? null);
        };
        request.onerror = () => reject(request.error);
      })
  );
}

function persistIndexedDbState(payload: PersistedState): Promise<void> {
  if (!supportsIndexedDb()) {
    return Promise.resolve();
  }
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(payload, STATE_KEY);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      })
  );
}

function clearIndexedDbState(): Promise<void> {
  if (!supportsIndexedDb()) {
    return Promise.resolve();
  }
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(STATE_KEY);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      })
  );
}

async function clearOpfsState(): Promise<void> {
  const root = await getOpfsRoot();
  if (!root) {
    return;
  }
  try {
    const dir = await root.getDirectoryHandle(OPFS_DIR);
    await dir.removeEntry(OPFS_FILE);
  } catch {
    // Best-effort cleanup.
  }
}

export async function loadPersistedState(): Promise<PersistedState | null> {
  if (supportsIndexedDb()) {
    const fromIndexedDb = await loadIndexedDbState();
    if (fromIndexedDb) {
      return fromIndexedDb;
    }
  }
  return readOpfsState();
}

export function getStorageMode(): StorageMode {
  return supportsOpfs() ? "idb_plus_opfs" : "idb_only_fallback";
}

export async function persistState(state: UIState): Promise<void> {
  const payload: PersistedState = {
    dataTab: state.dataTab,
    resultsTab: state.resultsTab,
    storageMode: state.storageMode,
    mergeMode: state.mergeMode,
    hasHeader: state.hasHeader,
    delimiter: state.delimiter,
    sources: state.sources,
    selectedTransformTableName: state.selectedTransformTableName,
    pipelinesByTable: state.pipelinesByTable,
    activePipelineStepIdByTable: state.activePipelineStepIdByTable,
    pipelineSteps: state.pipelineSteps,
    activePipelineStepId: state.activePipelineStepId,
    activeQueryTarget: state.activeQueryTarget,
    pendingImpact: state.pendingImpact,
    sqlEditorText: state.sqlEditorText,
    savedQueries: state.savedQueries,
    activeQueryId: state.activeQueryId,
    notebookBlocks: state.notebookBlocks,
    columnEditsByTable: state.columnEditsByTable
  };
  await persistIndexedDbState(payload);
  if (supportsOpfs()) {
    await writeOpfsState(payload);
  }
}

export async function clearPersistedState(): Promise<void> {
  await clearIndexedDbState();
  await clearOpfsState();
}
