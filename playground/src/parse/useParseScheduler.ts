import { useCallback, useEffect, useRef, useState } from "react";
import type { WikitextExpansionInfo } from "./protocol";
import type { WikitextParsedSnapshot } from "react-wikitext/parse";
import type { ParserConfigKey } from "./configs";
import { serializeParseError } from "./errors";
import type { ParseErrorInfo, ParseRequest, ParseResponse, ParseStats } from "./protocol";
import { runParse, statsFor } from "./runParse";

const PARSE_DEBOUNCE_MS = 250;

/** 调度输入；`key` 只用于防抖分组，调度器不持有输入源身份。 */
export interface ParseSchedulerInput {
  /** 调用方提供的防抖分组键，通常是当前输入源 id。 */
  readonly key: string;
  readonly source: string;
  readonly configKey: ParserConfigKey;
  readonly pageName: string;
  readonly maxSourceLength?: number;
  readonly maxNodeCount?: number;
  readonly expandTemplates: boolean;
  readonly expandFallback: boolean;
}

/** 一次解析尝试的完整结果；`key` 标明它属于哪个防抖分组。 */
export interface ParseSchedulerResult {
  readonly key: string;
  readonly doc?: WikitextParsedSnapshot;
  readonly expansion?: WikitextExpansionInfo;
  readonly error?: ParseErrorInfo;
  readonly stats?: ParseStats;
  /** 实际执行位置，用于状态栏与复现信息。 */
  readonly origin: "worker" | "main";
}

export interface ParseSchedulerState {
  readonly result?: ParseSchedulerResult;
  readonly parsing: boolean;
  /** Worker 是否可用；构造失败或出错后会退到主线程。 */
  readonly workerAvailable: boolean;
}

interface InternalState extends ParseSchedulerState {
  /** 请求 id；用于丢弃过期结果。 */
  readonly requestId: number;
}

function requestFrom(input: ParseSchedulerInput, id: number): ParseRequest {
  return {
    id,
    source: input.source,
    configKey: input.configKey,
    pageName: input.pageName,
    ...(input.maxSourceLength === undefined ? {} : { maxSourceLength: input.maxSourceLength }),
    ...(input.maxNodeCount === undefined ? {} : { maxNodeCount: input.maxNodeCount }),
    expandTemplates: input.expandTemplates,
    expandFallback: input.expandFallback,
  };
}

/**
 * 解析调度：防抖、请求 id、Worker 与主线程回退、过期结果过滤。
 * 不保存输入源文本或身份，只把结果与 `key` 一起返回，由会话层决定是否采用。
 */
export function useParseScheduler(input: ParseSchedulerInput): ParseSchedulerState {
  const [state, setState] = useState<InternalState>({
    requestId: 0,
    parsing: true,
    workerAvailable: true,
  });
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const latestRequest = useRef<ParseRequest | null>(null);
  const attempted = useRef(new Set<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 分组键只用于给结果打标签，保持回调引用稳定，避免每次切换场景重建 Worker。
  const keyRef = useRef(input.key);

  const acceptPayload = useCallback(
    (
      request: ParseRequest,
      payload: ParsePayloadLike,
      origin: "worker" | "main",
      stats: ParseStats,
    ) => {
      if (request.id !== requestId.current) {
        return;
      }
      setState({
        requestId: request.id,
        parsing: false,
        workerAvailable: origin === "worker",
        result: { key: keyRef.current, ...payload, stats, origin },
      });
    },
    [],
  );

  const acceptError = useCallback(
    (
      request: ParseRequest,
      error: ParseErrorInfo,
      origin: "worker" | "main",
      stats: ParseStats,
    ) => {
      if (request.id !== requestId.current) {
        return;
      }
      const key = keyRef.current;
      setState((previous) => ({
        requestId: request.id,
        parsing: false,
        workerAvailable: origin === "worker",
        result: {
          key,
          // 同一分组内保留上一份成功文档，预览不会因输入中间态闪成空白。
          ...(previous.result?.key === key && previous.result.doc
            ? { doc: previous.result.doc, expansion: previous.result.expansion }
            : {}),
          error,
          stats,
          origin,
        },
      }));
    },
    [],
  );

  const parseOnMain = useCallback(
    async (request: ParseRequest) => {
      const started = performance.now();
      try {
        const payload = await runParse(request);
        acceptPayload(request, payload, "main", statsFor(request, performance.now() - started));
      } catch (error) {
        acceptError(
          request,
          serializeParseError(error),
          "main",
          statsFor(request, performance.now() - started),
        );
      }
    },
    [acceptError, acceptPayload],
  );

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" });
    } catch {
      // Worker 构造失败时只能退到主线程解析。
      // oxlint-disable-next-line react/set-state-in-effect
      setState((previous) => ({ ...previous, workerAvailable: false }));
      return;
    }
    const handleMessage = (event: MessageEvent<ParseResponse>) => {
      const message = event.data;
      if (message.id !== requestId.current) {
        return;
      }
      const request = latestRequest.current;
      if (!request || request.id !== message.id) {
        return;
      }
      const stats: ParseStats = {
        durationMs: message.durationMs,
        configKey: message.configKey,
        pageName: message.pageName,
      };
      if (message.ok) {
        acceptPayload(
          request,
          {
            doc: message.doc,
            ...(message.expansion === undefined ? {} : { expansion: message.expansion }),
          },
          "worker",
          stats,
        );
        return;
      }
      acceptError(request, message.error, "worker", stats);
    };
    const handleError = () => {
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      setState((previous) => ({ ...previous, workerAvailable: false }));
      if (latestRequest.current) {
        void parseOnMain(latestRequest.current);
      }
    };
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    workerRef.current = worker;
    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
  }, [acceptError, acceptPayload, parseOnMain]);

  const {
    key,
    source,
    configKey,
    pageName,
    maxSourceLength,
    maxNodeCount,
    expandTemplates,
    expandFallback,
  } = input;

  useEffect(() => {
    // 请求发出时的分组键；响应回来时同组请求已递增 id，过期结果会被丢弃。
    keyRef.current = key;
    const request = requestFrom(
      {
        key,
        source,
        configKey,
        pageName,
        ...(maxSourceLength === undefined ? {} : { maxSourceLength }),
        ...(maxNodeCount === undefined ? {} : { maxNodeCount }),
        expandTemplates,
        expandFallback,
      },
      ++requestId.current,
    );
    latestRequest.current = request;
    // 同一分组内编辑保留旧文档并标记 loading；分组变化时旧的 result.key 由会话层丢弃。
    // oxlint-disable-next-line react/set-state-in-effect
    setState((previous) => ({
      ...previous,
      requestId: request.id,
      parsing: true,
      result:
        previous.result?.key === key ? { ...previous.result, error: undefined } : previous.result,
    }));
    const wait = attempted.current.has(key) ? PARSE_DEBOUNCE_MS : 0;
    const timer = setTimeout(() => {
      timerRef.current = undefined;
      attempted.current.add(key);
      const worker = workerRef.current;
      if (worker) {
        worker.postMessage(request);
      } else {
        void parseOnMain(request);
      }
    }, wait);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (timerRef.current === timer) {
        timerRef.current = undefined;
      }
    };
  }, [
    key,
    source,
    configKey,
    pageName,
    maxSourceLength,
    maxNodeCount,
    expandTemplates,
    expandFallback,
    parseOnMain,
  ]);

  return {
    ...(state.result ? { result: state.result } : {}),
    parsing: state.parsing,
    workerAvailable: state.workerAvailable,
  };
}

interface ParsePayloadLike {
  doc: WikitextParsedSnapshot;
  expansion?: WikitextExpansionInfo;
}
