import type { VFile } from "vfile";
import type { WikitextDiagnostic } from "../ast/model";
import type { WikitextSourceId } from "../ast/sourceGraph/types";

type FileMessage = VFile["messages"][number];

function vfileMessageToDiagnostic(
  message: FileMessage,
  stage: WikitextDiagnostic["stage"],
  sourceId: WikitextSourceId,
): WikitextDiagnostic {
  const place = message.place;
  let location: WikitextDiagnostic["location"];
  if (place && typeof place === "object") {
    if ("start" in place && "end" in place) {
      const start = place.start.offset ?? 0;
      const end = place.end.offset ?? start;
      location = { sourceId, start, end: Math.max(start, end) };
    } else if ("line" in place && typeof place.line === "number") {
      const offset = place.offset ?? 0;
      location = { sourceId, start: offset, end: offset };
    }
  }
  return {
    code: message.ruleId ?? message.name ?? "PLUGIN_MESSAGE",
    stage,
    severity: message.fatal ? "error" : "warning",
    message: message.message,
    ...(location ? { location } : {}),
  };
}

/**
 * 读取并把 VFile 上收集的插件消息转换为诊断信息，同时清空消息列表。
 * @param file 插件写入的 VFile。
 * @param stage 当前阶段。
 * @param sourceId 消息 offset 所属的活动文本源。
 */
export function takeDiagnostics(
  file: VFile,
  stage: WikitextDiagnostic["stage"],
  sourceId: WikitextSourceId,
): WikitextDiagnostic[] {
  const diagnostics = file.messages.map((message) =>
    vfileMessageToDiagnostic(message, stage, sourceId),
  );
  file.messages = [];
  return diagnostics;
}
