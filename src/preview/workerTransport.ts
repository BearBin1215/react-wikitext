import type { WikitextRenderSnapshot } from "../ast/model";
import { restoreWikitextRenderSnapshot } from "../hast/serialize";
import type {
  WikitextWorkerLike,
  WikitextWorkerRequest,
  WikitextWorkerResponse,
} from "../worker/protocol";
import type { WikitextPreviewExecutor, WikitextPreviewRequest } from "./types";

interface Pending {
  readonly resolve: (snapshot: WikitextRenderSnapshot) => void;
  readonly reject: (error: unknown) => void;
  readonly cleanup: () => void;
}

/** 主线程侧的 worker 执行器。 */
export interface WikitextWorkerTransport {
  readonly executor: WikitextPreviewExecutor;
  /** 取消全部等待并终止宿主 worker。 */
  dispose(): void;
}

function abortError(reason: unknown): Error {
  const error = new Error("The preview request was cancelled.");
  error.name = "AbortError";
  if (reason !== undefined) {
    (error as { cause?: unknown }).cause = reason;
  }
  return error;
}

/**
 * 用宿主创建的 Worker 建立预览执行器。
 *
 * 函数、compiler、provider 与 AbortSignal 不通过 `postMessage` 传递；
 * 这里只发送可序列化的输入与选项。
 * @param worker 宿主创建的 Worker 实例。
 */
export function createWikitextWorkerExecutor(worker: WikitextWorkerLike): WikitextWorkerTransport {
  const pending = new Map<string, Pending>();
  let sequence = 0;
  let disposed = false;

  const listener = (event: { readonly data: unknown }): void => {
    const data = event.data as WikitextWorkerResponse | undefined;
    if (!data || typeof data !== "object" || typeof data.id !== "string") {
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) {
      return;
    }
    pending.delete(data.id);
    entry.cleanup();
    if (data.type === "result") {
      try {
        entry.resolve(restoreWikitextRenderSnapshot(data.snapshot));
      } catch (error) {
        entry.reject(error);
      }
      return;
    }
    if (data.type === "cancelled") {
      entry.reject(abortError(undefined));
      return;
    }
    const error = new Error(data.error.message);
    error.name = data.error.name;
    if (data.error.code !== undefined) {
      (error as { code?: string }).code = data.error.code;
    }
    entry.reject(error);
  };

  worker.addEventListener("message", listener);

  const executor: WikitextPreviewExecutor = (request: WikitextPreviewRequest) => {
    if (disposed) {
      return Promise.reject(new Error("The worker transport has been disposed."));
    }
    const id = request.requestId || String(++sequence);
    const signal = request.signal;
    return new Promise<WikitextRenderSnapshot>((resolve, reject) => {
      const onAbort = (): void => {
        pending.delete(id);
        worker.postMessage({ type: "cancel", id } satisfies WikitextWorkerRequest);
        reject(abortError(signal?.reason));
      };
      if (signal?.aborted) {
        reject(abortError(signal.reason));
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = (): void => {
        signal?.removeEventListener("abort", onAbort);
      };
      pending.set(id, { resolve, reject, cleanup });
      worker.postMessage({
        type: "compile",
        id,
        input: request.input,
        ...(request.options === undefined ? {} : { options: request.options }),
      } satisfies WikitextWorkerRequest);
    });
  };

  return {
    executor,
    dispose() {
      disposed = true;
      worker.removeEventListener?.("message", listener);
      for (const [id, entry] of pending) {
        entry.cleanup();
        entry.reject(abortError(undefined));
        worker.postMessage({ type: "cancel", id } satisfies WikitextWorkerRequest);
      }
      pending.clear();
      worker.postMessage({ type: "dispose" } satisfies WikitextWorkerRequest);
      worker.terminate?.();
    },
  };
}
