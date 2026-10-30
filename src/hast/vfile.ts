import type { VFile } from "vfile";
import type { WikitextDiagnostic } from "../ast/model";

type FileMessage = VFile["messages"][number];

function vfileMessageToDiagnostic(
  message: FileMessage,
  stage: WikitextDiagnostic["stage"],
): WikitextDiagnostic {
  const place = message.place;
  let position: WikitextDiagnostic["position"];
  if (place && typeof place === "object") {
    if ("start" in place && "end" in place) {
      position = {
        start: {
          line: place.start.line,
          column: place.start.column,
          offset: place.start.offset ?? 0,
        },
        end: {
          line: place.end.line,
          column: place.end.column,
          offset: place.end.offset ?? 0,
        },
      };
    } else if ("line" in place && typeof place.line === "number") {
      const point = { line: place.line, column: place.column ?? 1, offset: place.offset ?? 0 };
      position = { start: point, end: point };
    }
  }
  return {
    code: message.ruleId ?? message.name ?? "PLUGIN_MESSAGE",
    stage,
    severity: message.fatal ? "error" : "warning",
    message: message.message,
    ...(position ? { position } : {}),
  };
}

/** 读取并把 VFile 上收集的插件消息转换为诊断信息，同时清空消息列表。 */
export function takeDiagnostics(
  file: VFile,
  stage: WikitextDiagnostic["stage"],
): WikitextDiagnostic[] {
  const diagnostics = file.messages.map((message) => vfileMessageToDiagnostic(message, stage));
  file.messages = [];
  return diagnostics;
}
