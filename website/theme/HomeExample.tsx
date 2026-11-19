import { useEffect, useState, type ComponentType } from "react";
import { useLang } from "@rspress/core/runtime";
import { Link } from "@rspress/core/theme-original";
import "./home-example.css";

type DemoWikitext = ComponentType<{
  source: string;
  lang: string;
  onError: () => void;
}>;

const examples = {
  zh: {
    label: "在线试用",
    lang: "zh-CN",
    sourceLabel: "wikitext 源码",
    previewLabel: "渲染预览",
    hint: "安装：",
    install: "pnpm add react-wikitext",
    linkText: "查看快速开始",
    linkHref: "/zh/guide/quick-start",
    errorText: "示例加载失败，请查看快速开始。",
    source: [
      "== 你好，世界 ==",
      "'''wikitext''' 可以渲染成 ''React'' 组件。",
      "",
      "* 列表项",
      "* 另一项",
      "",
      "> 引用块",
    ].join("\n"),
  },
  en: {
    label: "Try it live",
    lang: "en",
    sourceLabel: "wikitext source",
    previewLabel: "Rendered preview",
    hint: "Install with",
    install: "pnpm add react-wikitext",
    linkText: "Read the quick start",
    linkHref: "/guide/quick-start",
    errorText: "The example failed to load. See the quick start.",
    source: [
      "== Hello, world ==",
      "'''wikitext''' renders as ''React'' elements.",
      "",
      "* First item",
      "* Second item",
      "",
      "> Block quote",
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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([import("../../src"), import("../../src/styles/view.css")])
      .then(([module]) => {
        if (active) {
          setWikitext(() => module.Wikitext);
        }
        return undefined;
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const source = drafts[lang] ?? example.source;

  return (
    <section className="home-example" aria-labelledby="home-example-title">
      <div className="home-example__header">
        <h2 className="home-example__title" id="home-example-title">
          {example.label}
        </h2>
        <p className="home-example__hint">
          {example.hint} <code>{example.install}</code> ·{" "}
          <Link href={example.linkHref}>{example.linkText}</Link>
        </p>
      </div>
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
            {failed ? (
              <p className="home-example__error">{example.errorText}</p>
            ) : Wikitext ? (
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
