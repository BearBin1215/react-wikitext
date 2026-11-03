import type { ChangeEvent } from "react";
import { DEFAULT_MAX_SOURCE_LENGTH } from "react-wikitext/parse";
import { COMPONENTS_MODES, parsePositiveInteger, type PlaygroundOptions } from "@pg/state/options";
import type { SceneControlId, SceneDefinition } from "@pg/catalog";

interface SceneBarProps {
  scene: SceneDefinition;
  options: PlaygroundOptions;
  onChange: (patch: Partial<PlaygroundOptions>) => void;
}

const COMPONENTS_MODE_LABELS: Record<(typeof COMPONENTS_MODES)[number], string> = {
  none: "无",
  demo: "演示组件",
  throwing: "抛错组件",
};

interface SceneControlProps {
  id: SceneControlId;
  options: PlaygroundOptions;
  onChange: (patch: Partial<PlaygroundOptions>) => void;
}

function SceneControl({ id, options, onChange }: SceneControlProps) {
  switch (id) {
    case "expand":
      return (
        <label className="pg-check">
          <input
            type="checkbox"
            checked={options.expandTemplates}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ expandTemplates: event.target.checked })
            }
          />
          <span>展开模板（示例模板表）</span>
        </label>
      );
    case "expandFallback":
      return (
        <label className="pg-check">
          <input
            type="checkbox"
            checked={options.expandFallback}
            disabled={!options.expandTemplates}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ expandFallback: event.target.checked })
            }
          />
          <span>模拟最终解析失败</span>
        </label>
      );
    case "linkResolver":
      return (
        <label className="pg-check">
          <input
            type="checkbox"
            checked={options.linkResolver}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ linkResolver: event.target.checked })
            }
          />
          <span>链接 resolver</span>
        </label>
      );
    case "imageResolver":
      return (
        <label className="pg-check">
          <input
            type="checkbox"
            checked={options.imageResolver}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ imageResolver: event.target.checked })
            }
          />
          <span>图片 resolver</span>
        </label>
      );
    case "components":
      return (
        <label className="pg-inline-field">
          <span>自定义组件</span>
          <select
            value={options.componentsMode}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onChange({
                componentsMode: event.target.value as PlaygroundOptions["componentsMode"],
              })
            }
          >
            {COMPONENTS_MODES.map((value) => (
              <option key={value} value={value}>
                {COMPONENTS_MODE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      );
    case "maxSource":
      return (
        <label className="pg-inline-field">
          <span>源码上限</span>
          <input
            type="number"
            min={1}
            placeholder={String(DEFAULT_MAX_SOURCE_LENGTH)}
            value={options.maxSourceLength === undefined ? "" : String(options.maxSourceLength)}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ maxSourceLength: parsePositiveInteger(event.target.value) })
            }
          />
        </label>
      );
  }
}

export function SceneBar({ scene, options, onChange }: SceneBarProps) {
  const expandable = scene.controls.some((id) => id === "expand" || id === "expandFallback");
  return (
    <section className="pg-scenebar">
      <div className="pg-scenebar__intro">
        <h1>{scene.title}</h1>
        <p>{scene.description}</p>
      </div>
      {scene.controls.length > 0 ? (
        <div className="pg-scenebar__controls">
          {scene.controls.map((id) => (
            <SceneControl key={id} id={id} options={options} onChange={onChange} />
          ))}
          {expandable ? (
            <p className="pg-scenebar__note">
              启用后预览使用展开后的源码；AST 树与诊断指向展开结果。
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
