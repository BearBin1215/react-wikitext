import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 递归读取目录下的 TS/TSX 源码及其路径，供静态边界检查使用。 */
export function readSourceEntries(directory: string): Array<{ file: string; code: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return readSourceEntries(path);
    }
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
      ? [{ file: path, code: readFileSync(path, "utf8") }]
      : [];
  });
}

/** 递归读取目录下的 TS/TSX 源码，供静态边界检查使用。 */
export function readSourceFiles(directory: string): string[] {
  return readSourceEntries(directory).map((entry) => entry.code);
}
