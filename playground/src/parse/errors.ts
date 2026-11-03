import { WikitextError } from "react-wikitext/parse";
import type { ParseErrorInfo } from "./protocol";

export function serializeParseError(error: unknown): ParseErrorInfo {
  if (error instanceof WikitextError) {
    return { code: error.code, name: error.name, message: error.message };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}
