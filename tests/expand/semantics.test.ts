import { describe, expect, it, vi } from "vitest";
import { getSpanText } from "@/ast";
import {
  expandWikitext,
  type WikitextExpandOptions,
  type WikitextTemplateResolver,
} from "../helpers/expand";

const TEMPLATES: Record<string, string> = {
  "Template:Echo": "{{{1}}}",
  "Template:EchoAll": "1=[{{{1|}}}] 2=[{{{2|}}}] a=[{{{a|}}}] x=[{{{x|}}}]",
  "Template:WsAnon": "[{{{1|}}}]",
  "Template:WsNamed": "[{{{x|}}}]",
  "Template:Default": "{{{x|fallback}}}",
  "Template:DefaultNested": "{{{x|{{Inner|d}}}}}",
  "Template:Inner": "inner({{{1|}}})",
  "Template:Pass": "{{Inner|{{{1}}}}}",
  "Template:Set": "{{EchoAll|{{{key|1}}}=value}}",
  "Template:KV": "{{{a=b}}}",
  "Template:List": "* item",
  "Template:Table": "{|\n| cell\n|}",
  "Template:Head": "==H==",
  "Template:CommentList": "<!--c-->*x",
  "Template:ArgBody": "x{{{1}}}",
  "Template:Body": "body",
  "Template:Keyed": "{{{k}}}",
  "Template:Two": "[{{{1}}}] [{{{b}}}]",
  "Template:RelA": "{{ {{{1|/sub}}} }}",
  "Template:RelB": "{{ {{{1|/sub}}} }}",
  "Template:RelA/sub": "A",
  "Template:RelB/sub": "B",
  "Template:Include": "a<noinclude>n</noinclude>b<includeonly>i</includeonly>c",
  "Template:MixedInclude": "<includeonly>a<noinclude>b</noinclude>c</includeonly>",
  "Template:OpenNoinclude": "a<noinclude>b",
  "Template:NestedNoinclude": "a<noinclude>b<noinclude>c</noinclude>d</noinclude>e",
  "Template:OnlyInNoinclude": "a<noinclude>b<onlyinclude>c</onlyinclude>d</noinclude>e",
  "Template:SpaceTag": "a< noinclude>b",
  "Template:InvalidClose": "a<noinclude>x</noinclude/>b",
  "Template:SelfClosing": "a<noinclude/>b<includeonly/>c",
  "Template:Only": "x<onlyinclude>o1</onlyinclude>y<onlyinclude>o2</onlyinclude>z",
  "Template:Protection":
    "<!--<noinclude>c</noinclude>--><nowiki><noinclude>n</noinclude></nowiki><noinclude>d</noinclude>e",
  "Template:Wrap": "a{{Missing}}b",
};

describe("pure parser functions", () => {
  it("evaluates arithmetic and comparisons", async () => {
    expect((await expand("{{#expr:1 + 2 * 3}}")).snapshot.source).toBe("7");
    expect((await expand("{{#expr:1 / 4 round 2}}")).snapshot.source).toBe("0.25");
    expect((await expand("{{#ifexpr:3 > 2|yes|no}}")).snapshot.source).toBe("yes");
    expect((await expand("{{#expr:1 and 2 or 0}}")).snapshot.source).toBe("1");
    expect((await expand("{{#expr:not 0}}")).snapshot.source).toBe("1");
    expect((await expand("{{#expr:pi > 3}}")).snapshot.source).toBe("1");
    expect((await expand("{{#expr:1 / 0}}")).expansion.status).toBe("partial");
    expect(
      (await expand("{{#expr:1 / 0}}")).expansion.diagnostics.map((entry) => entry.code),
    ).toContain("EXPRESSION_ERROR");
  });

  it("supports common string functions", async () => {
    expect((await expand("{{#len:abcd}}")).snapshot.source).toBe("4");
    expect((await expand("{{#sub:abcdef|2|3}}")).snapshot.source).toBe("cde");
    expect((await expand("{{#replace:a-b-c|-|_}}")).snapshot.source).toBe("a_b_c");
    expect((await expand("{{#titleparts:A/B/C|2|1}}")).snapshot.source).toBe("A/B");
    expect((await expand("{{#titleparts:A/B/C|0|2}}")).snapshot.source).toBe("B/C");
    expect((await expand("{{#padleft:7|3|0}}")).snapshot.source).toBe("007");
    expect((await expand("{{#uc:abc}}")).snapshot.source).toBe("ABC");
    expect((await expand("{{#urlencode:a b}}")).snapshot.source).toBe("a%20b");
  });

  it("supports #tag", async () => {
    expect((await expand("{{#tag:poem|x|class=y}}")).snapshot.source).toBe(
      '<poem class="y">x</poem>',
    );
  });

  it("keeps unsupported functions as diagnostics", async () => {
    const expanded = await expand("{{#invoke:Mod|fn}}");
    expect(expanded.snapshot.source).toBe("{{#invoke:Mod|fn}}");
    expect(expanded.expansion.diagnostics.map((entry) => entry.code)).toContain("UNSUPPORTED_CALL");
  });
});

function resolver(locate: (title: string) => string | null | undefined): WikitextTemplateResolver {
  return ({ title }) => locate(title);
}

async function expand(source: string, options: Partial<WikitextExpandOptions> = {}) {
  return expandWikitext(source, { templates: TEMPLATES, ...options });
}

describe("template parameters", () => {
  it("applies last-wins order for named and anonymous parameters", async () => {
    expect((await expand("{{EchoAll|first|1=second}}")).snapshot.source).toBe(
      "1=[second] 2=[] a=[] x=[]",
    );
    expect((await expand("{{EchoAll|1=first|second}}")).snapshot.source).toBe(
      "1=[second] 2=[] a=[] x=[]",
    );
    expect((await expand("{{EchoAll|a|b|a=c|d}}")).snapshot.source).toBe("1=[a] 2=[b] a=[c] x=[]");
  });

  it("keeps anonymous whitespace and trims named keys and values", async () => {
    expect((await expand("{{WsAnon|  a  }}")).snapshot.source).toBe("[  a  ]");
    expect((await expand("{{WsNamed| x =  v  }}")).snapshot.source).toBe("[v]");
  });

  it("distinguishes provided empty values from missing values", async () => {
    expect((await expand("{{Default}}")).snapshot.source).toBe("fallback");
    expect((await expand("{{Default|x=}}")).snapshot.source).toBe("");
    expect((await expand("{{{x}}}")).snapshot.source).toBe("{{{x}}}");
    expect((await expand("{{{x|}}}")).snapshot.source).toBe("");
  });

  it("evaluates defaults only when the parameter is undefined", async () => {
    const locate = vi.fn((title: string) => TEMPLATES[title] ?? null);
    const resolveTemplate = resolver(locate);
    expect((await expandWikitext("{{DefaultNested}}", { resolveTemplate })).snapshot.source).toBe(
      "inner(d)",
    );
    expect(locate).toHaveBeenCalledWith("Template:Inner");
    locate.mockClear();
    expect(
      (await expandWikitext("{{DefaultNested|x=provided}}", { resolveTemplate })).snapshot.source,
    ).toBe("provided");
    expect(locate.mock.calls.map(([title]) => title)).toEqual(["Template:DefaultNested"]);
  });

  it("does not evaluate parameters that the template never reads", async () => {
    const locate = vi.fn((title: string) => (title === "Template:Echo" ? "ok" : null));
    expect(
      (await expandWikitext("{{Echo|{{Missing}}}}", { resolveTemplate: resolver(locate) })).snapshot
        .source,
    ).toBe("ok");
    expect(locate.mock.calls.map(([title]) => title)).toEqual(["Template:Echo"]);
    const locateBody = vi.fn((title: string) => TEMPLATES[title] ?? null);
    expect(
      (await expandWikitext("{{Body|{{Missing}}=v}}", { resolveTemplate: resolver(locateBody) }))
        .snapshot.source,
    ).toBe("body");
    expect(locateBody.mock.calls.map(([title]) => title)).toEqual(["Template:Body"]);
  });

  it("keeps {{!}} and {{=}} inside one parameter value", async () => {
    expect((await expand("{{Echo|a{{!}}b}}")).snapshot.source).toBe("a|b");
    expect((await expand("{{KV|a{{=}}b=v}}")).snapshot.source).toBe("v");
  });
});

describe("scopes and dynamic names", () => {
  it("evaluates passed expressions in the caller scope", async () => {
    expect((await expand("{{Pass|v}}")).snapshot.source).toBe("inner(v)");
    expect((await expand("{{Pass}}")).snapshot.source).toBe("inner({{{1}}})");
  });

  it("resolves dynamic template names and parameter keys", async () => {
    expect((await expand("{{ {{{name|Inner}}} }}")).snapshot.source).toBe("inner()");
    const name = await expand("{{ {{{name}}} }}");
    expect(name.snapshot.source).toBe("{{ {{{name}}} }}");
    expect(name.expansion.diagnostics.map((item) => item.code)).toEqual(["UNRESOLVED_DEPENDENCY"]);
    expect((await expand("{{Set}}")).snapshot.source).toBe("1=[value] 2=[] a=[] x=[]");
    expect((await expand("{{Set|key=a}}")).snapshot.source).toBe("1=[] 2=[] a=[value] x=[]");
    const keyed = await expand("{{Keyed|{{Missing}}=v}}");
    expect(keyed.snapshot.source).toBe("{{{k}}}");
    expect(keyed.expansion.status).toBe("partial");
    expect(keyed.expansion.diagnostics.map((item) => item.code)).toEqual([
      "TEMPLATE_NOT_FOUND",
      "UNRESOLVED_DEPENDENCY",
    ]);
    const partial = await expand("{{Two|1=v|{{Missing}}=x}}");
    expect(partial.snapshot.source).toBe("[v] [{{{b}}}]");
    expect(partial.expansion.diagnostics.map((item) => item.code)).toEqual([
      "TEMPLATE_NOT_FOUND",
      "UNRESOLVED_DEPENDENCY",
    ]);
  });

  it("normalizes relative titles per calling template", async () => {
    expect((await expand("{{RelA}}{{RelB}}")).snapshot.source).toBe("AB");
  });
});

describe("parser functions", () => {
  it("evaluates #if conditions by trimmed text", async () => {
    expect((await expand("{{#if: |a|b}}")).snapshot.source).toBe("b");
    expect((await expand("{{#if:0|a|b}}")).snapshot.source).toBe("a");
    expect((await expand("{{#if:&nbsp;|a|b}}")).snapshot.source).toBe("a");
    expect((await expand("{{#if:&#32;|a|b}}")).snapshot.source).toBe("a");
    expect((await expand("{{#if:1|ok|{{Missing}}}}")).snapshot.source).toBe("ok");
    expect((await expand("{{#if:{{Missing}}|ok|no}}")).snapshot.source).toBe(
      "{{#if:{{Missing}}|ok|no}}",
    );
  });

  it("compares #ifeq numerically and textually", async () => {
    expect((await expand("{{#ifeq:01|1|y|n}}")).snapshot.source).toBe("y");
    expect((await expand("{{#ifeq:a|a|y|n}}")).snapshot.source).toBe("y");
    expect((await expand("{{#ifeq:a|A|y|n}}")).snapshot.source).toBe("n");
    expect((await expand("{{#ifeq:1|2|y}}")).snapshot.source).toBe("");
  });

  it("supports #switch matching, fall-through and defaults", async () => {
    expect((await expand("{{#switch:a|a|b|c}}")).snapshot.source).toBe("c");
    expect((await expand("{{#switch:a|a|b|c=C}}")).snapshot.source).toBe("C");
    expect((await expand("{{#switch:a|x|y|a|z|#default=d}}")).snapshot.source).toBe("d");
    expect((await expand("{{#switch:a|a=b|#default=d}}")).snapshot.source).toBe("b");
    expect((await expand("{{#switch:a|#default=d}}")).snapshot.source).toBe("d");
    expect((await expand("{{#switch:x|#default|d}}")).snapshot.source).toBe("d");
    expect((await expand("{{#switch:x|a|b}}")).snapshot.source).toBe("b");
    expect((await expand("{{#switch:a|a}}")).snapshot.source).toBe("a");
    expect((await expand("{{#switch:a|a|{{Missing}}=b}}")).snapshot.source).toBe("b");
    expect((await expand("{{#switch:x|{{Missing}}|y}}")).snapshot.source).toBe("y");
    expect((await expand("{{#switch:x|{{Missing}}|#default|d}}")).snapshot.source).toBe("d");
    const lazy = await expand("{{#switch:a|a=b|{{Missing}}}}");
    expect(lazy.snapshot.source).toBe("b");
    expect(lazy.expansion.status).toBe("complete");
    expect(lazy.expansion.diagnostics).toEqual([]);
    const dependency = await expand("{{#switch:{{Missing}}|a|b}}");
    expect(dependency.snapshot.source).toBe("{{#switch:{{Missing}}|a|b}}");
    expect(dependency.expansion.diagnostics.map((item) => item.code)).toEqual([
      "TEMPLATE_NOT_FOUND",
      "UNRESOLVED_DEPENDENCY",
    ]);
  });

  it("does not evaluate unselected function branches", async () => {
    const result = await expand("{{#if: |{{Missing}}|ok}}");
    expect(result.snapshot.source).toBe("ok");
    expect(result.expansion.status).toBe("complete");
    expect(result.expansion.diagnostics).toEqual([]);
  });

  it("ignores comments and raw extensions in conditions", async () => {
    expect((await expand("{{#if:<!--x-->|a|b}}")).snapshot.source).toBe("b");
    expect((await expand("{{#if:<nowiki></nowiki>|a|b}}")).snapshot.source).toBe("b");
    expect((await expand("{{#if:1|<nowiki><!--x--></nowiki>|no}}")).snapshot.source).toBe(
      "<nowiki><!--x--></nowiki>",
    );
  });

  it("detects error markers in #iferror", async () => {
    expect(
      (await expand('{{#iferror:<strong class="error">x</strong>|err|ok}}')).snapshot.source,
    ).toBe("err");
    expect((await expand("{{#iferror:fine|err|ok}}")).snapshot.source).toBe("ok");
    expect((await expand("{{#iferror:fine|err}}")).snapshot.source).toBe("fine");
    expect(
      (await expand('{{#iferror:<nowiki><span class="error">x</span></nowiki>|err|ok}}')).snapshot
        .source,
    ).toBe("ok");
    expect((await expand("{{#iferror:x<nowiki>y</nowiki>}}")).snapshot.source).toBe(
      "x<nowiki>y</nowiki>",
    );
    expect((await expand("{{#iferror:<nowiki>x</nowiki>}}")).snapshot.source).toBe(
      "<nowiki>x</nowiki>",
    );
  });

  it("expands {{!}} and {{=}} as magic words", async () => {
    expect((await expand("a{{!}}b{{=}}c")).snapshot.source).toBe("a|b=c");
  });
});

describe("include filtering", () => {
  it("removes noinclude content and strips includeonly tags", async () => {
    expect((await expand("{{Include}}")).snapshot.source).toBe("abic");
    expect((await expand("{{MixedInclude}}")).snapshot.source).toBe("ac");
    expect((await expand("{{SelfClosing}}")).snapshot.source).toBe("abc");
  });

  it("drops the rest of an unclosed noinclude", async () => {
    expect((await expand("{{OpenNoinclude}}")).snapshot.source).toBe("a");
    expect((await expand("{{InvalidClose}}")).snapshot.source).toBe("a");
  });

  it("pairs noinclude with FIFO order and lets onlyinclude win", async () => {
    expect((await expand("{{NestedNoinclude}}")).snapshot.source).toBe("ad</noinclude>e");
    expect((await expand("{{OnlyInNoinclude}}")).snapshot.source).toBe("c");
    expect((await expand("{{SpaceTag}}")).snapshot.source).toBe("a< noinclude>b");
  });

  it("keeps only onlyinclude segments when present", async () => {
    expect((await expand("{{Only}}")).snapshot.source).toBe("o1o2");
  });

  it("protects comments and nowiki from tag detection", async () => {
    expect((await expand("{{Protection}}")).snapshot.source).toBe(
      "<!--<noinclude>c</noinclude>--><nowiki><noinclude>n</noinclude></nowiki>e",
    );
  });

  it("does not filter include tags in the original page", async () => {
    const source = "a<noinclude>n</noinclude>b<includeonly>i</includeonly>c";
    expect((await expand(source)).snapshot.source).toBe(source);
  });
});

describe("implicit newlines", () => {
  it("inserts LF before structural output after text", async () => {
    expect((await expand("prefix{{List}}")).snapshot.source).toBe("prefix\n* item");
    expect((await expand("{{List}}")).snapshot.source).toBe("* item");
    expect((await expand("line\n{{List}}")).snapshot.source).toBe("line\n* item");
    expect((await expand("prefix{{Table}}")).snapshot.source).toBe("prefix\n{|\n| cell\n|}");
    expect((await expand("prefix{{Head}}")).snapshot.source).toBe("prefix\n==H==");
    expect((await expand("prefix{{CommentList}}")).snapshot.source).toBe("prefix\n<!--c-->*x");
  });

  it("applies the rule to parser function results", async () => {
    expect((await expand("prefix{{#if:1|* item}}")).snapshot.source).toBe("prefix\n* item");
  });

  it("does not apply the rule to argument substitution", async () => {
    expect((await expand("prefix{{ArgBody|* item}}")).snapshot.source).toBe("prefixx* item");
    expect((await expand("{{ArgBody|{{List}}}}")).snapshot.source).toBe("x\n* item");
    expect((await expand("{{ArgBody|{{Head}}}}")).snapshot.source).toBe("x\n==H==");
  });

  it("includes the inserted newline in the record range", async () => {
    const result = await expand("prefix{{List}}");
    expect(result.expansion.records).toEqual([
      {
        kind: "template",
        name: "Template:List",
        originalRange: [6, 14],
        expandedRange: [6, 13],
        status: "expanded",
      },
    ]);
  });
});

describe("records and diagnostics", () => {
  it("records top-level calls nested in other structures", async () => {
    const result = await expand("== {{Echo|a}} ==");
    expect(result.snapshot.source).toBe("== a ==");
    expect(result.expansion.records).toEqual([
      {
        kind: "template",
        name: "Template:Echo",
        originalRange: [3, 13],
        expandedRange: [3, 4],
        status: "expanded",
      },
    ]);
  });

  it("records top-level argument references", async () => {
    const result = await expand("a{{{missing}}}b");
    expect(result.snapshot.source).toBe("a{{{missing}}}b");
    expect(result.expansion.records).toEqual([
      {
        kind: "argument",
        name: "missing",
        originalRange: [1, 14],
        expandedRange: [1, 14],
        status: "preserved",
      },
    ]);
  });

  it("maps nested diagnostics to the top-level record range", async () => {
    const result = await expand("{{Wrap}}");
    expect(result.snapshot.source).toBe("a{{Missing}}b");
    expect(result.expansion.status).toBe("partial");
    expect(result.expansion.records[0]).toMatchObject({
      name: "Template:Wrap",
      originalRange: [0, 8],
      expandedRange: [0, 13],
      status: "expanded",
    });
    const [expansionDiagnostic] = result.expansion.diagnostics;
    expect(expansionDiagnostic).toMatchObject({
      stage: "expand",
      code: "TEMPLATE_NOT_FOUND",
      templateTitle: "Template:Missing",
    });
    // 主位置保留真实失败位置：模板体失败指向模板有效正文，而不是页面调用点。
    if (!expansionDiagnostic?.location) {
      throw new Error("expected the diagnostic to carry a source location");
    }
    expect(expansionDiagnostic.location.sourceId).toMatch(/^effective:/u);
    expect(getSpanText(result.snapshot.graph, expansionDiagnostic.location)).toBe("{{Missing}}");
    const documentDiagnostic = result.snapshot.diagnostics.find(
      (item) => item.code === "TEMPLATE_NOT_FOUND",
    );
    expect(documentDiagnostic).toBe(expansionDiagnostic);
  });
});
