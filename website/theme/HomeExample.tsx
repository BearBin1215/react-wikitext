import { useEffect, useState, type ComponentType } from "react";
import { useLang } from "@rspress/core/runtime";
import "./home-example.css";

type DemoWikitext = ComponentType<{
  source: string;
  lang: string;
  onError: () => void;
}>;

const examples = {
  zh: {
    label: "在线示例",
    lang: "zh-CN",
    sourceLabel: "wikitext 源码",
    previewLabel: "渲染预览",
    source: [
      "== 你好，世界 ==",
      "'''wikitext''' 可以渲染成 ''React'' 组件。",
      "",
      "# 安装：pnpm add react-wikitext",
      "# 传入 source 与 lang 渲染",
      "# 改动左侧源码，右侧实时更新",
    ].join("\n"),
  },
  en: {
    label: "Live example",
    lang: "en",
    sourceLabel: "wikitext source",
    previewLabel: "Rendered preview",
    source: [
      "== Hello, world ==",
      "'''wikitext''' renders as ''React'' elements.",
      "",
      "# Install: pnpm add react-wikitext",
      "# Pass source and lang to render",
      "# Edit the source and watch the preview",
    ].join("\n"),
  },
} as const;

/** 在线编辑时输入不可控，接管错误出口，避免一次解析失败把整页打崩。 */
const ignoreParseError = (): void => undefined;

export function HomeExample() {
  const lang = useLang();
  const example = lang === "zh" ? examples.zh : examples.en;
  const [Wikitext, setWikitext] = useState<DemoWikitext | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void Promise.all([import("../../src"), import("../../src/styles/view.css")]).then(
      ([module]) => {
        if (active) {
          setWikitext(() => module.Wikitext);
        }
        return undefined;
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const source = drafts[lang] ?? example.source;

  return (
    <section className="home-example" aria-label={example.label}>
      <div className="home-example__card">
        <div className="home-example__pane home-example__pane--input">
          <span className="home-example__label">{example.sourceLabel}</span>
          <textarea
            className="home-example__editor"
            aria-label={example.sourceLabel}
            value={source}
            rows={8}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => {
              const next = event.target.value;
              setDrafts((prev) => ({ ...prev, [lang]: next }));
            }}
          />
        </div>
        <div className="home-example__pane home-example__pane--preview">
          <span className="home-example__label">{example.previewLabel}</span>
          <div className="home-example__preview">
            {Wikitext ? (
              <Wikitext source={source} lang={example.lang} onError={ignoreParseError} />
            ) : (
              <div className="home-example__loading" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
