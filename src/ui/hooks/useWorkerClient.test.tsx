import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerResponse } from "../../shared/workerProtocol";
import { useWorkerClient, type WorkerClient } from "./useWorkerClient";

type PostedMessage = Record<string, unknown>;

class MockWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  postedMessages: PostedMessage[] = [];
  terminate = vi.fn();

  postMessage = (message: PostedMessage) => {
    this.postedMessages.push(message);
    const requestId = String(message.requestId ?? "");
    const type = String(message.type ?? "");
    if (type === "CANCEL_REQUEST") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            requestId,
            status: "ok",
            type: "CANCEL_REQUEST",
            payload: {
              cancelled: true
            }
          }
        } as unknown as MessageEvent<WorkerResponse>);
      });
      return;
    }
    const sql =
      typeof message.payload === "object" &&
      message.payload &&
      "sql" in message.payload
        ? String((message.payload as { sql?: unknown }).sql ?? "")
        : "";
    const delayMs = sql.includes("SELECT 1") ? 25 : 1;
    setTimeout(() => {
      this.onmessage?.({
        data: {
          requestId,
          status: "ok",
          type: "RUN_SQL",
          payload: {
            columns: [],
            rows: [],
            rowCount: 0
          }
        }
      } as unknown as MessageEvent<WorkerResponse>);
    }, delayMs);
  };
}

function WorkerHarness(props: {
  onReady: (client: WorkerClient) => void;
}) {
  const client = useWorkerClient();
  useEffect(() => {
    props.onReady(client);
  }, [client, props]);
  return null;
}

describe("useWorkerClient", () => {
  const OriginalWorker = globalThis.Worker;
  let mockWorkers: MockWorker[] = [];

  beforeEach(() => {
    mockWorkers = [];
    class WorkerConstructor extends MockWorker {
      constructor(_url: URL | string, _options?: WorkerOptions) {
        super();
        mockWorkers.push(this);
      }
    }
    globalThis.Worker = WorkerConstructor as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = OriginalWorker;
  });

  it("cancels prior in-flight sendLatest requests on the same channel", async () => {
    let clientRef: WorkerClient | null = null;
    render(
      <WorkerHarness
        onReady={(client) => {
          clientRef = client;
        }}
      />
    );
    await waitFor(() => expect(clientRef).not.toBeNull());
    if (!clientRef) {
      throw new Error("Worker client failed to initialize.");
    }
    const client: WorkerClient = clientRef;

    const first = client.sendLatest("sql", {
      type: "RUN_SQL",
      payload: {
        sql: "SELECT 1",
        limit: 10
      }
    });
    const second = client.sendLatest("sql", {
      type: "RUN_SQL",
      payload: {
        sql: "SELECT 2",
        limit: 10
      }
    });

    await expect(first).rejects.toThrow("Cancelled by newer request");
    await expect(second).resolves.toMatchObject({
      status: "ok",
      type: "RUN_SQL"
    });

    const messages = mockWorkers[0]?.postedMessages ?? [];
    const cancelMessage = messages.find((message) => message.type === "CANCEL_REQUEST");
    const firstRequest = messages.find(
      (message) =>
        message.type === "RUN_SQL" &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        (message.payload as { sql?: unknown }).sql === "SELECT 1"
    );
    expect(cancelMessage).toBeTruthy();
    expect(firstRequest).toBeTruthy();
    expect(cancelMessage?.payload).toMatchObject({
      targetRequestId: firstRequest?.requestId
    });
  });
});
