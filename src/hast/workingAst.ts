import { WikitextPrepareError } from "../ast/errors";
import { assignSemanticIds } from "../ast/ids";
import { PREPARE_MAX_DEPTH, PREPARE_MAX_SEMANTIC_NODES } from "../ast/limits";
import type { WikitextRoot } from "../ast/model";
import { clearQueryCache } from "../ast/query";

/**
 * 校验插件处理后的语义工作树，重新分配路径式 id，并清除该 root 的查询缓存。
 * 校验失败或超出固定准备预算时抛 `WikitextPrepareError`，阶段为 `wikitext`。
 */
export function validateWorkingAst(tree: unknown): asserts tree is WikitextRoot {
  if (!tree || typeof tree !== "object") {
    throw new WikitextPrepareError("PREPARE_FAILED", "Wiki plugin result is not a root node.", {
      stage: "wikitext",
    });
  }
  const root = tree as { type?: unknown; children?: unknown };
  if (root.type !== "root" || !Array.isArray(root.children)) {
    throw new WikitextPrepareError("PREPARE_FAILED", "Wiki plugin result is not a root node.", {
      stage: "wikitext",
    });
  }
  let count = 0;
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object") {
      throw new WikitextPrepareError("PREPARE_FAILED", "Wiki plugin produced an invalid node.", {
        stage: "wikitext",
      });
    }
    const candidate = node as { type?: unknown; children?: unknown };
    if (typeof candidate.type !== "string") {
      throw new WikitextPrepareError("PREPARE_FAILED", "Wiki node is missing a type.", {
        stage: "wikitext",
      });
    }
    count++;
    if (count > PREPARE_MAX_SEMANTIC_NODES) {
      throw new WikitextPrepareError(
        "PREPARE_FAILED",
        `Semantic node count exceeds the limit of ${PREPARE_MAX_SEMANTIC_NODES}.`,
        { stage: "wikitext" },
      );
    }
    if (depth > PREPARE_MAX_DEPTH) {
      throw new WikitextPrepareError(
        "PREPARE_FAILED",
        `Semantic nesting depth exceeds the limit of ${PREPARE_MAX_DEPTH}.`,
        { stage: "wikitext" },
      );
    }
    if (candidate.children !== undefined) {
      if (!Array.isArray(candidate.children)) {
        throw new WikitextPrepareError("PREPARE_FAILED", "Wiki node has invalid children.", {
          stage: "wikitext",
        });
      }
      for (const child of candidate.children) {
        visit(child, depth + 1);
      }
    }
  };
  visit(tree, 0);
  const ast = tree as WikitextRoot;
  assignSemanticIds(ast);
  clearQueryCache(ast);
}
