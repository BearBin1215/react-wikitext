import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WikitextRenderSnapshot } from "../ast/model";
import type { WikitextPreviewOptions, WikitextPreviewResult, WikitextPreviewStatus } from "./types";

interface PreviewState {
  readonly snapshot?: WikitextRenderSnapshot;
  readonly displayedRevision?: string;
  readonly error?: Error;
}

const DEFAULT_DEBOUNCE = 250;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * 统一的实时预览调度。
 *
 * 渲染期不调用 executor、不创建 compiler、不启动 provider 请求；全部工作都在
 * effect 中发起。请求身份单调递增，effect cleanup、unmount、Strict Mode 重放与
 * 乱序返回都不会提交过期结果。
 * @param options 输入、执行器与防抖配置。
 */
export function useWikitextPreview(options: WikitextPreviewOptions): WikitextPreviewResult {
  const {
    input,
    executor,
    debounceMs = DEFAULT_DEBOUNCE,
    initialSnapshot,
    compileOptions,
  } = options;
  const [state, setState] = useState<PreviewState>(() =>
    initialSnapshot ? { snapshot: initialSnapshot, displayedRevision: input.revision } : {},
  );
  const [status, setStatus] = useState<WikitextPreviewStatus>(initialSnapshot ? "ready" : "idle");
  const [nonce, setNonce] = useState(0);

  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const keyRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);

  // 有效选项按内容序列化；宿主每次渲染新建对象时不会重复触发请求。
  const optionsKey = useMemo(
    () =>
      compileOptions === undefined
        ? ""
        : JSON.stringify({
            pageName: compileOptions.pageName ?? null,
            retainSyntax: compileOptions.retainSyntax ?? false,
            budget: compileOptions.budget ?? null,
          }),
    [compileOptions],
  );

  // Strict Mode 会重放 effect：挂载标记必须在 effect 体内重置，不能在 cleanup 里写死。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const keyChanged = keyRef.current !== input.key;
    keyRef.current = input.key;
    const id = ++requestIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("scheduled");

    // 首次输入与页面切换立即执行；同一输入键的后续编辑才防抖。
    const delay = keyChanged ? 0 : Math.max(0, debounceMs);
    const timer = setTimeout(() => {
      if (requestIdRef.current !== id) {
        return;
      }
      setStatus("running");
      void executor({
        requestId: String(id),
        input,
        ...(compileOptions === undefined ? {} : { options: compileOptions }),
        signal: controller.signal,
      }).then(
        (snapshot) => {
          if (!mountedRef.current || requestIdRef.current !== id) {
            return;
          }
          setState({ snapshot, displayedRevision: input.revision });
          setStatus("ready");
          return undefined;
        },
        (error: unknown) => {
          if (!mountedRef.current || requestIdRef.current !== id || controller.signal.aborted) {
            return;
          }
          setState((previous) => ({ ...previous, error: asError(error) }));
          setStatus("error");
          return undefined;
        },
      );
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // input 以字段为准：调用方通常每次渲染都会新建 input 对象。
    // compileOptions 只在内容变化时重跑；对象身份变化由 optionsKey 归一化。
  }, [input.key, input.revision, input.text, executor, debounceMs, optionsKey, nonce]);

  const run = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const cancel = useCallback(() => {
    requestIdRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus("idle");
  }, []);

  return {
    ...(state.snapshot === undefined ? {} : { snapshot: state.snapshot }),
    status,
    inputRevision: input.revision,
    ...(state.displayedRevision === undefined
      ? {}
      : { displayedRevision: state.displayedRevision }),
    ...(state.error === undefined ? {} : { error: state.error }),
    run,
    cancel,
  };
}
