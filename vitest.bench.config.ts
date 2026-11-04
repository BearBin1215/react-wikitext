import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 性能报告使用显式采样而不是 Vitest 的 bench 统计，
 * 以便保存每次样本、阶段元数据与可校验的报告。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/performance/report.measure.ts"],
    testTimeout: 600_000,
  },
});
