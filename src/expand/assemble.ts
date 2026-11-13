import type { WikitextSourceSpan } from "../ast/sourceGraph/types";
import type { SourceGraphBuilder } from "../ast/sourceGraph/graph";
import type { InvocationDraft } from "./evaluate";
import type { WikitextOutput, WikitextOutputMark } from "../ast/sourceGraph/output";

/** 把输出片段装配为展开源码，并记录片段关系与出现位置。 */
export function assemble(
  builder: SourceGraphBuilder,
  output: WikitextOutput,
  expandedId: string,
): void {
  let offset = 0;
  let occurrence = 0;
  for (const piece of output.pieces) {
    const length = piece.text.length;
    const to: WikitextSourceSpan = { sourceId: expandedId, start: offset, end: offset + length };
    const exact = piece.source !== undefined && piece.source.end - piece.source.start === length;
    if (exact) {
      builder.addSegment({
        kind: piece.invocationId === undefined ? "copy" : "value",
        from: piece.source,
        to,
        precision: "exact",
        ...(piece.invocationId === undefined ? {} : { invocationId: piece.invocationId }),
        occurrenceId: `${piece.invocationId ?? "page"}#${occurrence++}`,
      });
    } else if (piece.anchor) {
      builder.addSegment({
        kind: "invocation",
        from: piece.anchor,
        to,
        precision: "enclosing-invocation",
        ...(piece.invocationId === undefined ? {} : { invocationId: piece.invocationId }),
      });
    } else {
      builder.addSegment({ kind: "generated", to, precision: "enclosing-invocation" });
    }
    offset += length;
  }
}

export function recordInvocations(
  builder: SourceGraphBuilder,
  drafts: readonly InvocationDraft[],
  marks: readonly WikitextOutputMark[],
  expandedId: string,
): void {
  for (const draft of drafts) {
    const outputs: WikitextSourceSpan[] = [];
    for (const mark of marks) {
      if (mark.invocationId === draft.id) {
        outputs.push({ sourceId: expandedId, start: mark.start, end: mark.end });
      }
    }
    builder.addInvocation({
      id: draft.id,
      kind: draft.kind,
      name: draft.name,
      scopeId: draft.scopeId,
      ...(draft.parentId === undefined ? {} : { parentId: draft.parentId }),
      sourceId: draft.sourceId,
      start: draft.start,
      end: draft.end,
      status: draft.status,
      outputs,
      ...(draft.templateTitle === undefined ? {} : { templateTitle: draft.templateTitle }),
      ...(draft.reason === undefined ? {} : { reason: draft.reason }),
    });
    if (outputs.length > 0) {
      // 调用级关联：点击模板正文输出时可以回到页面调用位置，精度为粗粒度。
      const start = Math.min(...outputs.map((output) => output.start));
      const end = Math.max(...outputs.map((output) => output.end));
      builder.addSegment({
        kind: "invocation",
        from: { sourceId: draft.sourceId, start: draft.start, end: draft.end },
        to: { sourceId: expandedId, start, end },
        precision: "enclosing-invocation",
        invocationId: draft.id,
      });
    }
  }
}
