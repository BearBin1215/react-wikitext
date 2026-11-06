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

/** 引用分组名；空分组使用默认组。 */
export function referenceGroupName(group: string | undefined): string {
  return (group ?? "").trim();
}

/** 分组名在 DOM id 中的安全片段；非 ASCII 字符编码为 `.HH`，避免不同分组碰撞。 */
function groupSegment(group: string): string {
  const segment = group.trim().replace(/[^A-Za-z0-9_-]/gu, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return `.${code.toString(16).toUpperCase()}`;
  });
  return segment || "group";
}

/** 引用条目 id；与 `<sup>` 中链接的片段保持一致。 */
export function referenceNoteId(number: number, group?: string): string {
  const name = referenceGroupName(group);
  return name ? `cite_note-${groupSegment(name)}-${number}` : `cite_note-${number}`;
}

/** 正文中第一个引用上标的 id；供回链和宿主样式定位。 */
export function referenceBacklinkId(number: number, group?: string): string {
  const name = referenceGroupName(group);
  return name ? `cite_ref-${groupSegment(name)}-${number}` : `cite_ref-${number}`;
}

/** 同一注释再次被引用时的上标 id；第一次沿用 {@link referenceBacklinkId}。 */
export function referenceOccurrenceId(number: number, occurrence: number, group?: string): string {
  const base = referenceBacklinkId(number, group);
  return occurrence <= 1 ? base : `${base}-${occurrence}`;
}
