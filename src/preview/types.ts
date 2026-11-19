import type { WikitextRenderSnapshot } from "../ast/model";
import type { WikitextCompileBudget, WikitextInput } from "../expand/types";

/** 预览请求的有效编译选项；只描述可以跨线程传递的普通数据。 */
export interface WikitextPreviewCompileOptions {
  /** 页面上下文名；省略时使用输入键。 */
  readonly pageName?: string;
  /** 单次编译的展开预算。 */
  readonly budget?: WikitextCompileBudget;
  /** 是否要求执行端保留上游语法树。 */
  readonly retainSyntax?: boolean;
}

/** 传给 executor 的请求。 */
export interface WikitextPreviewRequest {
  /** 单调递增的请求身份；用于忽略乱序结果。 */
  readonly requestId: string;
  /** 页面原始输入与版本。 */
  readonly input: WikitextInput;
  /** 有效编译选项；省略时使用执行端默认值。 */
  readonly options?: WikitextPreviewCompileOptions;
  /** 协作式取消；执行的同步 parser 不能被抢占。 */
  readonly signal?: AbortSignal;
}

/**
 * 预览执行器：负责 compile 与 prepare，返回渲染快照。
 *
 * 主线程执行器直接复用 `createWikitextCompiler`；Worker 执行器只负责协议转换。
 */
export type WikitextPreviewExecutor = (
  request: WikitextPreviewRequest,
) => Promise<WikitextRenderSnapshot>;

/**
 * 预览调度状态。
 *
 * `idle` 没有排队请求，`scheduled` 已排队等待防抖，`running` 执行中，
 * `ready` 有可展示结果，`error` 最近一次执行失败。
 */
export type WikitextPreviewStatus = "idle" | "scheduled" | "running" | "ready" | "error";

/** `useWikitextPreview` 的选项。 */
export interface WikitextPreviewOptions {
  /** 当前编辑器输入；`revision` 必须随内容变化。 */
  readonly input: WikitextInput;
  /** 执行编译与准备的执行器；主线程可用 `createWikitextCompiler` 包装，Worker 场景用 `createWikitextWorkerExecutor` 提供。 */
  readonly executor: WikitextPreviewExecutor;
  /** 同一输入键后续编辑的防抖时间，默认 250ms；首次输入立即执行。 */
  readonly debounceMs?: number;
  /** 初始快照；SSR 由宿主提前编译并与客户端一致。 */
  readonly initialSnapshot?: WikitextRenderSnapshot;
  /** 有效编译选项；对象身份变化会触发新请求。 */
  readonly compileOptions?: WikitextPreviewCompileOptions;
}

/** `useWikitextPreview` 的返回值。 */
export interface WikitextPreviewResult {
  /** 当前展示的快照；可能是上一次成功结果。 */
  readonly snapshot?: WikitextRenderSnapshot;
  readonly status: WikitextPreviewStatus;
  /** 当前输入版本。 */
  readonly inputRevision: string;
  /** 展示快照对应的输入版本；旧快照时与 `inputRevision` 不同。 */
  readonly displayedRevision?: string;
  /** 最近一次失败的错误；由下一次成功或失败的结果替换。 */
  readonly error?: Error;
  /** 跳过防抖立即执行。 */
  readonly run: () => void;
  /** 取消排队与等待中的请求；不提交任何结果。 */
  readonly cancel: () => void;
}
