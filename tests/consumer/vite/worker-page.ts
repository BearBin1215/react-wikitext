const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  (globalThis as { consumerResult?: unknown }).consumerResult = event.data;
});

worker.addEventListener("error", (event) => {
  (globalThis as { consumerResult?: unknown }).consumerResult = {
    type: "error",
    message: event.message,
  };
});
