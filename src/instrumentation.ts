/**
 * 可选的阶段计时。
 *
 * sink 由调用方通过 `profile` 选项显式传入，编译器与准备管线各自持有；
 * 未提供时 `measureSync` / `measureAsync` 只多一次判断。不保存模块级状态，
 * 因此并发编译与并发准备互不串扰。
 */

/** 编译器阶段名。 */
export type WikitextCompilerStageName =
  | "normalize"
  | "page-syntax"
  | "template"
  | "evaluate"
  | "fetch"
  | "assemble"
  | "final-syntax"
  | "build";

/** 准备阶段名。 */
export type WikitextPrepareStageName =
  | "prepare-clone"
  | "prepare-plugin"
  | "prepare-convert"
  | "prepare-rehype"
  | "prepare-assemble";

/** 全部阶段名；字符串直接进入基准报告。 */
export type WikitextStageName = WikitextCompilerStageName | WikitextPrepareStageName;

/** 阶段计时接收器；每次阶段结束调用一次，单位毫秒。 */
export type WikitextStageSink = (stage: WikitextStageName, durationMs: number) => void;

/**
 * 测量一个同步阶段。
 * @param stage 阶段名。
 * @param sink 接收器；省略时只执行不计量。
 * @param run 执行体。
 */
export function measureSync<T>(
  stage: WikitextStageName,
  sink: WikitextStageSink | undefined,
  run: () => T,
): T {
  if (sink === undefined) {
    return run();
  }
  const started = performance.now();
  try {
    return run();
  } finally {
    sink(stage, performance.now() - started);
  }
}

/**
 * 测量一个异步阶段。
 * @param stage 阶段名。
 * @param sink 接收器；省略时只执行不计量。
 * @param run 执行体。
 */
export async function measureAsync<T>(
  stage: WikitextStageName,
  sink: WikitextStageSink | undefined,
  run: () => T | Promise<T>,
): Promise<T> {
  if (sink === undefined) {
    return run();
  }
  const started = performance.now();
  try {
    return await run();
  } finally {
    sink(stage, performance.now() - started);
  }
}
