import { useMemo, useState, type ChangeEvent } from "react";
import { buildSceneMenu, sceneOf, type SceneDefinition } from "@pg/catalog";

interface SceneMenuProps {
  sources: readonly SceneDefinition[];
  currentId: string;
  dirty: boolean;
  onSelect: (id: string) => void;
}

function matchesQuery(source: SceneDefinition, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [source.id, source.title, source.description].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

export function SceneMenu({ sources, currentId, dirty, onSelect }: SceneMenuProps) {
  const groups = useMemo(() => buildSceneMenu(sources), [sources]);
  const [query, setQuery] = useState("");
  const [corpusOpen, setCorpusOpen] = useState(() => sceneOf(currentId).group === "corpus");
  const searching = query.trim().length > 0;
  const visible = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((source) => matchesQuery(source, query)),
        }))
        .filter((group) => group.items.length > 0),
    [groups, query],
  );
  const total = visible.reduce((count, group) => count + group.items.length, 0);

  return (
    <nav className="pg-sources" aria-label="场景菜单" data-testid="pg-source-list">
      <div className="pg-sources__heading">
        <h2 className="pg-sidebar__heading">场景</h2>
        <span className="pg-count">{total}</span>
      </div>
      <input
        className="pg-source-search"
        type="search"
        aria-label="筛选场景"
        placeholder="筛选 id / 标题 / 说明…"
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
        data-testid="pg-source-search"
      />
      {visible.map((group) => {
        const collapsible = group.id === "corpus";
        const open = !collapsible || searching || corpusOpen;
        return (
          <section className="pg-source-group" key={group.id}>
            {collapsible ? (
              <button
                type="button"
                className="pg-source-group__toggle"
                aria-expanded={open}
                onClick={() => setCorpusOpen((value) => !value)}
                data-testid="pg-corpus-toggle"
              >
                <span>{group.title}</span>
                <span className="pg-count">{group.items.length}</span>
              </button>
            ) : (
              <h3 className="pg-source-group__title">{group.title}</h3>
            )}
            {open ? (
              <div className="pg-source-list">
                {group.items.map((source) => {
                  const active = source.id === currentId;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      className={active ? "pg-source is-active" : "pg-source"}
                      data-source-id={source.id}
                      data-testid="pg-source-item"
                      aria-pressed={active}
                      title={source.description}
                      onClick={() => onSelect(source.id)}
                    >
                      <span className="pg-source__line">
                        <span className="pg-source__title">{source.title}</span>
                        {active && dirty ? <span className="pg-source__dirty">已修改</span> : null}
                      </span>
                      <span className="pg-source__description">{source.description}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
      {total === 0 ? <p className="pg-note">没有匹配的场景。</p> : null}
    </nav>
  );
}
