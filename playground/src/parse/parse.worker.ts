import { serializeParseError } from "./errors";
import { runParse, statsFor } from "./runParse";
import type { ParseRequest, ParseResponse } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("message", async (event: MessageEvent<ParseRequest>) => {
  const request = event.data;
  const started = performance.now();
  try {
    const payload = await runParse(request);
    scope.postMessage({
      id: request.id,
      ok: true,
      ...payload,
      ...statsFor(request, performance.now() - started),
    } satisfies ParseResponse);
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: serializeParseError(error),
      ...statsFor(request, performance.now() - started),
    } satisfies ParseResponse);
  }
});
