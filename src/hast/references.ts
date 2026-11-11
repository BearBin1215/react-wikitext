/** 文末引用列表的 class；最终整理据此写入条目 id。 */
export const REFERENCE_LIST_CLASS = "wikitext-references__list";
/** 引用区的 class；每个分组一个引用区。 */
export const REFERENCE_SECTION_CLASS = "wikitext-references";
/** `<references>` 占位节点的 class；最终整理替换为对应分组引用区。 */
export const REFERENCE_PLACEHOLDER_CLASS = "wikitext-references-placeholder";
/** 引用分组属性；同时用于占位与生成的引用区。 */
export const REFERENCE_GROUP_PROPERTY = "dataWikitextReferences";
/** 注释项回链的 class；恢复快照时先移除旧回链再重建。 */
export const REFERENCE_BACKLINK_CLASS = "wikitext-references__backlink";
/** MediaWiki 1.43 引用区外层容器与多列 class。 */
export const REFERENCE_WRAP_CLASS = "mw-references-wrap";
export const REFERENCE_COLUMNS_CLASS = "mw-references-columns";
/** MediaWiki 1.43 引用条目的回链与正文容器 class。 */
export const REFERENCE_MW_BACKLINK_CLASS = "mw-cite-backlink";
export const REFERENCE_TEXT_CLASS = "reference-text";

/** 引用分组名；空分组使用默认组。 */
export function referenceGroupName(group: string | undefined): string {
  return (group ?? "").trim();
}

/** 引用锚点所需的稳定字段；与 Cite 1.43 的 key/name 规则一致。 */
export interface ReferenceAnchor {
  /** 全文档范围的自增 key；命名引用首次出现时分配。 */
  readonly key: number;
  /** 命名引用的 name；匿名引用没有。 */
  readonly name?: string;
}

function nameSegment(name: string | undefined): string | undefined {
  const normalized = (name ?? "").trim().replace(/[_\s]+/gu, "_");
  return normalized || undefined;
}

/** 引用条目 id；命名引用为 `cite_note-{name}-{key}`，匿名为 `cite_note-{key}`。 */
export function referenceNoteId(anchor: ReferenceAnchor): string {
  const name = nameSegment(anchor.name);
  return name ? `cite_note-${name}-${anchor.key}` : `cite_note-${anchor.key}`;
}

/** 正文中引用上标的 id；命名引用带出现序号，匿名引用只使用 key。 */
export function referenceSupId(anchor: ReferenceAnchor, occurrence: number): string {
  const name = nameSegment(anchor.name);
  if (!name) {
    return `cite_ref-${anchor.key}`;
  }
  return `cite_ref-${name}_${anchor.key}-${Math.max(occurrence - 1, 0)}`;
}
