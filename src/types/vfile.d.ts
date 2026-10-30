import type { WikitextDocument, WikitextRenderDocument } from "../ast/model";

declare module "vfile" {
  interface DataMap {
    /** 处理器解析阶段写入的解析快照。 */
    wikitextDocument?: WikitextDocument;
    /** 处理器最终阶段写入的渲染快照。 */
    wikitextRenderDocument?: WikitextRenderDocument;
  }
}
