import { WikitextError } from "../ast/errors";
import type { WikitextCompiler } from "../expand/types";
import { prepareWikitext } from "../hast/prepare";
import { serializeWikitextRenderSnapshot } from "../hast/serialize";
import type { WikitextPrepareOptions } from "../hast/types";
import type {
  WikitextWorkerErrorPayload,
  WikitextWorkerRequest,
  WikitextWorkerResponse,
  WikitextWorkerScopeLike,
} from "./protocol";

/** worker handler 的选项。 */
export interface WikitextWorkerHandlerOptions {
  /** 复用的编译器；生命周期归宿主，handler 不销毁它。 */
  readonly compiler: WikitextCompiler;
  /** 每次编译后执行的准备选项。 */
  readonly prepare?: WikitextPrepareOptions;
}

/** 单条消息处理器；返回可以 `postMessage` 的普通数据。 */
export type WikitextWorkerMessageHandler = (
  request: WikitextWorkerRequest,
) => Promise<WikitextWorkerResponse>;

function errorPayload(error: unknown): WikitextWorkerErrorPayload {
  if (error instanceof WikitextError) {
    return {
      code: error.code,
      name: error.name,
      message: error.message,
      ...(error.location === undefined
        ? {}
        : {
            location: {
              sourceId: error.location.sourceId,
              start: error.location.start,
              end: error.location.end,
            },
          }),
    };
  }
  const value = error instanceof Error ? error : new Error(String(error));
  return { name: value.name, message: value.message };
}

/**
 * 创建 worker 消息处理器。
 *
 * 处理器复用同一个 compiler，执行 compile 与 prepare，返回普通数据渲染快照。
 * 取消是协作式的：只会停止排队与等待，不会中断正在运行的同步 parser。
 * @param options 编译器与准备选项。
 */
export function createWikitextWorkerHandler(
  options: WikitextWorkerHandlerOptions,
): WikitextWorkerMessageHandler {
  const controllers = new Map<string, AbortController>();
  let disposed = false;

  return async (request) => {
    if (request.type === "cancel") {
      controllers.get(request.id)?.abort();
      controllers.delete(request.id);
      return { type: "cancelled", id: request.id };
    }
    if (request.type === "dispose") {
      disposed = true;
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
      return { type: "cancelled", id: "dispose" };
    }
    if (disposed) {
      return {
        type: "error",
        id: request.id,
        error: { code: "DISPOSED", name: "WikitextError", message: "The worker was disposed." },
      };
    }
    const controller = new AbortController();
    controllers.set(request.id, controller);
    try {
      const compilation = await options.compiler.compile(request.input, {
        ...(request.options?.pageName === undefined ? {} : { pageName: request.options.pageName }),
        ...(request.options?.budget === undefined ? {} : { budget: request.options.budget }),
        ...(request.options?.retainSyntax === undefined
          ? {}
          : { retainSyntax: request.options.retainSyntax }),
        signal: controller.signal,
      });
      const snapshot = prepareWikitext(compilation.snapshot, options.prepare ?? {});
      return {
        type: "result",
        id: request.id,
        snapshot: serializeWikitextRenderSnapshot(snapshot),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return { type: "cancelled", id: request.id };
      }
      return { type: "error", id: request.id, error: errorPayload(error) };
    } finally {
      controllers.delete(request.id);
    }
  };
}

/**
 * 把 handler 接入宿主创建的 worker 作用域。
 *
 * 宿主负责创建 Worker 与决定 URL、打包方式与 CSP；这里只处理消息协议。
 * @param scope worker 全局作用域。
 * @param options 编译器与准备选项。
 */
export function attachWikitextWorker(
  scope: WikitextWorkerScopeLike,
  options: WikitextWorkerHandlerOptions,
): () => void {
  const handle = createWikitextWorkerHandler(options);
  const listener = (event: { readonly data: unknown }): void => {
    const data = event.data;
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as { type?: unknown }).type !== "string"
    ) {
      return;
    }
    void handle(data as WikitextWorkerRequest).then((response) => {
      scope.postMessage(response);
      return undefined;
    });
  };
  scope.addEventListener("message", listener);
  return () => {
    scope.removeEventListener?.("message", listener);
  };
}
