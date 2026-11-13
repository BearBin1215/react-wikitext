import type { WikitextParsedSnapshot, WikitextRenderSnapshot } from "../ast/model";

declare module "vfile" {
  interface DataMap {
    /** 处理器解析阶段写入的解析快照。 */
    wikitextDocument?: WikitextParsedSnapshot;
    /** 处理器最终阶段写入的渲染快照。 */
    wikitextRenderDocument?: WikitextRenderSnapshot;
  }
}
