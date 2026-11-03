import { useMemo } from "react";
import { buildReproMarkdown, buildReproTest, type ReproInput } from "@pg/harness/repro";
import { CopyButton } from "./CopyButton";

export function ReproPanel(input: ReproInput) {
  const { markdown, testSnippet } = useMemo(
    () => ({ markdown: buildReproMarkdown(input), testSnippet: buildReproTest(input) }),
    [input],
  );

  return (
    <div className="pg-repro" data-testid="pg-repro">
      <div className="pg-repro__toolbar">
        <span className="pg-note">
          源码、选项、诊断与准备结果来自当前状态，可直接粘贴到 issue 或测试文件。
        </span>
        <div className="pg-repro__actions">
          <CopyButton text={markdown} label="复制 Markdown" />
          <CopyButton text={testSnippet} label="复制 Vitest" />
        </div>
      </div>

      <section>
        <h3>复现信息</h3>
        <pre className="pg-code" data-testid="pg-repro-markdown">
          <code>{markdown}</code>
        </pre>
      </section>

      <section>
        <h3>Vitest 片段</h3>
        <pre className="pg-code" data-testid="pg-repro-test">
          <code>{testSnippet}</code>
        </pre>
      </section>
    </div>
  );
}
