import { useEffect, useMemo, useRef } from "react";
import type { WorkerRequest, WorkerResponse } from "../../shared/workerProtocol";
import { makeRequestId } from "../../shared/workerProtocol";

type PendingRequest = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
};

export type WorkerClient = {
  send<TRequest extends Omit<WorkerRequest, "requestId">>(
    request: TRequest,
    transferables?: Transferable[]
  ): Promise<WorkerResponse>;
  sendLatest<TRequest extends Omit<WorkerRequest, "requestId">>(
    channel: string,
    request: TRequest,
    transferables?: Transferable[]
  ): Promise<WorkerResponse>;
};

export function useWorkerClient(): WorkerClient {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const latestTokenByChannelRef = useRef<Map<string, number>>(new Map());
  const latestRequestIdByChannelRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const worker = new Worker(new URL("../../worker/index.ts", import.meta.url), {
      type: "module"
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = pendingRef.current.get(response.requestId);
      if (!pending) {
        return;
      }
      pendingRef.current.delete(response.requestId);
      if (response.status === "error") {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response);
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
      latestRequestIdByChannelRef.current.clear();
    };
  }, []);

  const client = useMemo(() => {
    const sendRequest = <TRequest extends Omit<WorkerRequest, "requestId">>(
      request: TRequest,
      transferables?: Transferable[]
    ): {
      requestId: string;
      response: Promise<WorkerResponse>;
    } => {
      const worker = workerRef.current;
      if (!worker) {
        throw new Error("Worker has not been initialized yet");
      }
      const requestId = makeRequestId();
      const fullRequest = { ...request, requestId } as WorkerRequest;
      const responsePromise = new Promise<WorkerResponse>((resolve, reject) => {
        pendingRef.current.set(requestId, {
          resolve,
          reject
        });
      });
      worker.postMessage(fullRequest, transferables ?? []);
      return {
        requestId,
        response: responsePromise
      };
    };

    const sendCancellation = (targetRequestId: string) => {
      const worker = workerRef.current;
      if (!worker) {
        return;
      }
      const cancelRequest: WorkerRequest = {
        requestId: makeRequestId(),
        type: "CANCEL_REQUEST",
        payload: {
          targetRequestId
        }
      };
      worker.postMessage(cancelRequest);
    };

    return {
      async send<TRequest extends Omit<WorkerRequest, "requestId">>(
        request: TRequest,
        transferables?: Transferable[]
      ): Promise<WorkerResponse> {
        return sendRequest(request, transferables).response;
      },
      async sendLatest<TRequest extends Omit<WorkerRequest, "requestId">>(
        channel: string,
        request: TRequest,
        transferables?: Transferable[]
      ): Promise<WorkerResponse> {
        const nextToken = (latestTokenByChannelRef.current.get(channel) ?? 0) + 1;
        latestTokenByChannelRef.current.set(channel, nextToken);
        const previousRequestId = latestRequestIdByChannelRef.current.get(channel);
        if (previousRequestId) {
          sendCancellation(previousRequestId);
        }
        const queued = sendRequest(request, transferables);
        latestRequestIdByChannelRef.current.set(channel, queued.requestId);
        const response = await queued.response;
        const activeToken = latestTokenByChannelRef.current.get(channel);
        const activeRequestId = latestRequestIdByChannelRef.current.get(channel);
        if (activeToken !== nextToken || activeRequestId !== queued.requestId) {
          throw new Error("Cancelled by newer request");
        }
        return response;
      }
    } as WorkerClient;
  }, []);

  return client;
}
