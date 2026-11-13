import type { WikitextSourceSpan } from "../ast/sourceGraph/types";
import type { WikitextInput } from "../expand/types";
import type { SerializedWikitextRenderSnapshot } from "../hast/serialize";
import type { WikitextPreviewCompileOptions } from "../preview/types";

/** worker 的错误负载；只包含可序列化字段。 */
export interface WikitextWorkerErrorPayload {
  readonly code?: string;
  readonly name: string;
  readonly message: string;
  /** 失败位置与快照诊断使用同一 span 模型。 */
  readonly location?: WikitextSourceSpan;
}

/** 发给 worker 的消息。 */
export type WikitextWorkerRequest =
  | {
      readonly type: "compile";
      readonly id: string;
      readonly input: WikitextInput;
      readonly options?: WikitextPreviewCompileOptions;
    }
  | { readonly type: "cancel"; readonly id: string }
  | { readonly type: "dispose" };

/** worker 返回的消息。 */
export type WikitextWorkerResponse =
  | {
      readonly type: "result";
      readonly id: string;
      readonly snapshot: SerializedWikitextRenderSnapshot;
    }
  | { readonly type: "error"; readonly id: string; readonly error: WikitextWorkerErrorPayload }
  | { readonly type: "cancelled"; readonly id: string };

/** 主线程侧的 worker 形状。 */
export interface WikitextWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener?: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  terminate?: () => void;
}

/** worker 全局作用域形状；作用域侧没有 `terminate`。 */
export type WikitextWorkerScopeLike = Omit<WikitextWorkerLike, "terminate">;
