const BLOCKS = [
  "== 章节标题 ==",
  "这是一段包含[[内部链接|显示文字]]、[https://example.com 外部链接]以及'''粗体'''和''斜体''的正文。",
  "下一行文本用于测试单个 text token 跨段。",
  "",
  "* 列表项一\n* 列表项二\n** 嵌套列表项",
  "",
  '{| class="wikitable"\n|+ 表格标题\n! 名称 !! 数值\n|-\n| A || 1\n|-\n| B || 2\n|}',
  "",
  "{{Infobox|name=示例|value={{Nested|x=1}}}}",
  "",
  '<ref name="r">引用内容 [[链接]]</ref>',
  "",
  '<div class="box"><span title="t">HTML 内容</span></div>',
  "",
];

export function buildFixture(targetLength: number): string {
  const parts: string[] = [];
  let length = 0;
  let index = 0;
  while (length < targetLength) {
    const block = BLOCKS[index % BLOCKS.length]!;
    parts.push(block);
    length += block.length + 1;
    index++;
  }
  return parts.join("\n").slice(0, targetLength);
}
