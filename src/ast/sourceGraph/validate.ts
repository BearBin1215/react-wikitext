import { WikitextError } from "../errors";
import { isSpanWithin } from "./span";
import {
  SOURCE_GRAPH_VERSION,
  type WikitextInvocation,
  type WikitextSourceGraph,
  type WikitextTextSource,
} from "./types";

const ROLES: ReadonlySet<string> = new Set([
  "input",
  "normalized",
  "template",
  "effective",
  "expanded",
]);
const KINDS: ReadonlySet<string> = new Set(["template", "parserFunction", "argument"]);
const STATUSES: ReadonlySet<string> = new Set(["expanded", "preserved", "failed"]);
const SEGMENT_KINDS: ReadonlySet<string> = new Set([
  "copy",
  "normalize",
  "delete",
  "generated",
  "invocation",
  "value",
]);
const PRECISIONS: ReadonlySet<string> = new Set(["exact", "enclosing-invocation"]);

function invalid(message: string): never {
  throw new WikitextError("INVALID_DOCUMENT", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSink(
  value: unknown,
  sources: ReadonlyMap<string, WikitextTextSource>,
  label: string,
): void {
  if (!isRecord(value)) {
    invalid(`${label} is not an object.`);
  }
  if (typeof value.sourceId !== "string" || !sources.has(value.sourceId)) {
    invalid(`${label} references an unknown source.`);
  }
  const source = sources.get(value.sourceId as string)!;
  if (!isSpanWithin(value, source.text.length)) {
    invalid(`${label} is outside its source.`);
  }
}

function assertSegment(value: unknown, sources: ReadonlyMap<string, WikitextTextSource>): void {
  if (!isRecord(value)) {
    invalid("Source graph segment is not an object.");
  }
  if (typeof value.kind !== "string" || !SEGMENT_KINDS.has(value.kind)) {
    invalid("Source graph segment kind is invalid.");
  }
  if (typeof value.precision !== "string" || !PRECISIONS.has(value.precision)) {
    invalid("Source graph segment precision is invalid.");
  }
  if (value.from === undefined && value.to === undefined) {
    invalid("Source graph segment has neither side.");
  }
  if (value.kind === "delete" && value.to !== undefined) {
    invalid("A delete segment cannot have an output range.");
  }
  if (value.kind === "generated" && (value.from !== undefined || value.to === undefined)) {
    invalid("A generated segment must only have an output range.");
  }
  if (value.from !== undefined) {
    assertSink(value.from, sources, "Source graph segment from");
  }
  if (value.to !== undefined) {
    assertSink(value.to, sources, "Source graph segment to");
  }
}

function assertInvocation(value: unknown, sources: ReadonlyMap<string, WikitextTextSource>): void {
  if (!isRecord(value)) {
    invalid("Source graph invocation is not an object.");
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    invalid("Source graph invocation is missing an id.");
  }
  if (typeof value.kind !== "string" || !KINDS.has(value.kind)) {
    invalid("Source graph invocation kind is invalid.");
  }
  if (typeof value.status !== "string" || !STATUSES.has(value.status)) {
    invalid("Source graph invocation status is invalid.");
  }
  if (typeof value.name !== "string" || typeof value.scopeId !== "string") {
    invalid("Source graph invocation is missing its name or scope.");
  }
  if (typeof value.sourceId !== "string" || !sources.has(value.sourceId)) {
    invalid("Source graph invocation references an unknown source.");
  }
  const source = sources.get(value.sourceId)!;
  if (!isSpanWithin(value, source.text.length)) {
    invalid("Source graph invocation range is invalid.");
  }
  if (!Array.isArray(value.outputs)) {
    invalid("Source graph invocation outputs is not an array.");
  }
  for (const output of value.outputs) {
    assertSink(output, sources, "Source graph invocation output");
  }
  if (value.parentId !== undefined && typeof value.parentId !== "string") {
    invalid("Source graph invocation parentId is invalid.");
  }
  if (value.templateTitle !== undefined && typeof value.templateTitle !== "string") {
    invalid("Source graph invocation templateTitle is invalid.");
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    invalid("Source graph invocation reason is invalid.");
  }
}

/**
 * 校验来源图：版本、源目录、片段与调用引用。
 * @param value 来自序列化快照或等价结构的数据。
 */
export function validateSourceGraph(value: unknown): asserts value is WikitextSourceGraph {
  if (!isRecord(value)) {
    invalid("Source graph is not an object.");
  }
  if (value.version !== SOURCE_GRAPH_VERSION) {
    invalid(`Unsupported source graph version: ${String(value.version)}.`);
  }
  if (
    !Array.isArray(value.sources) ||
    !Array.isArray(value.segments) ||
    !Array.isArray(value.invocations)
  ) {
    invalid("Source graph is missing its catalog or relations.");
  }
  const sources = new Map<string, WikitextTextSource>();
  for (const entry of value.sources) {
    if (!isRecord(entry)) {
      invalid("Source graph source is not an object.");
    }
    if (typeof entry.id !== "string" || typeof entry.key !== "string") {
      invalid("Source graph source is missing its identity.");
    }
    if (typeof entry.revision !== "string" || typeof entry.text !== "string") {
      invalid("Source graph source is missing its revision or text.");
    }
    if (typeof entry.role !== "string" || !ROLES.has(entry.role)) {
      invalid("Source graph source role is invalid.");
    }
    if (entry.title !== undefined && typeof entry.title !== "string") {
      invalid("Source graph source title is invalid.");
    }
    if (sources.has(entry.id)) {
      invalid(`Source graph source id "${entry.id}" is duplicated.`);
    }
    sources.set(entry.id, entry as unknown as WikitextTextSource);
  }
  for (const segment of value.segments) {
    assertSegment(segment, sources);
  }
  const ids = new Set<string>();
  for (const invocation of value.invocations) {
    assertInvocation(invocation, sources);
    const entry = invocation as unknown as WikitextInvocation;
    if (ids.has(entry.id)) {
      invalid(`Source graph invocation id "${entry.id}" is duplicated.`);
    }
    ids.add(entry.id);
  }
  for (const invocation of value.invocations as unknown as WikitextInvocation[]) {
    if (invocation.parentId !== undefined && !ids.has(invocation.parentId)) {
      invalid(`Source graph invocation "${invocation.id}" has an unknown parent.`);
    }
  }
}
