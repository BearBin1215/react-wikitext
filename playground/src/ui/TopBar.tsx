import type { ChangeEvent } from "react";
import { PARSER_CONFIG_LABELS } from "@pg/parse/configs";
import { LABEL_LANGUAGES, VIEW_DIRS, VIEW_LANGS, type PlaygroundOptions } from "@pg/state/options";

interface TopBarProps {
  options: PlaygroundOptions;
  onChange: (patch: Partial<PlaygroundOptions>) => void;
}

export function TopBar({ options, onChange }: TopBarProps) {
  return (
    <header className="pg-topbar">
      <div className="pg-topbar__brand">
        react-wikitext<span>playground</span>
      </div>
      <div className="pg-topbar__globals">
        <label className="pg-inline-field">
          <span>配置</span>
          <select
            value={options.parserConfig}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onChange({ parserConfig: event.target.value as PlaygroundOptions["parserConfig"] })
            }
          >
            {Object.entries(PARSER_CONFIG_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="pg-inline-field">
          <span>页面名</span>
          <input
            type="text"
            value={options.pageName}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ pageName: event.target.value })
            }
          />
        </label>
        <label className="pg-inline-field">
          <span>占位文案</span>
          <select
            value={options.labelLanguage}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onChange({ labelLanguage: event.target.value as PlaygroundOptions["labelLanguage"] })
            }
          >
            {LABEL_LANGUAGES.map((value) => (
              <option key={value} value={value}>
                {value === "zh" ? "中文" : "English（库默认）"}
              </option>
            ))}
          </select>
        </label>
        <label className="pg-inline-field">
          <span>lang</span>
          <select
            value={options.lang}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onChange({ lang: event.target.value as PlaygroundOptions["lang"] })
            }
          >
            {VIEW_LANGS.map((value) => (
              <option key={value} value={value}>
                {value === "none" ? "未设置" : value}
              </option>
            ))}
          </select>
        </label>
        <label className="pg-inline-field">
          <span>dir</span>
          <select
            value={options.dir}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onChange({ dir: event.target.value as PlaygroundOptions["dir"] })
            }
          >
            {VIEW_DIRS.map((value) => (
              <option key={value} value={value}>
                {value === "none" ? "未设置" : value}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
