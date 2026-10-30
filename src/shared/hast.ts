interface HastMetaCarrier {
  readonly data?: { wikitext?: { id?: string } };
}

/** 读取 HAST 节点 `data.wikitext.id`；没有 wiki 来源时返回 undefined。 */
export function hastNodeId(node: unknown): string | undefined {
  return (node as HastMetaCarrier | undefined)?.data?.wikitext?.id;
}

interface HastClassCarrier {
  readonly properties?: { readonly className?: unknown };
}

/** 判断 HAST 元素是否带有指定 class；兼容数组与字符串两种写法。 */
export function hasHastClass(node: unknown, name: string): boolean {
  const value = (node as HastClassCarrier | undefined)?.properties?.className;
  if (typeof value === "string") {
    return value.split(/\s+/u).includes(name);
  }
  return Array.isArray(value) && value.some((token) => String(token) === name);
}
