const worker = new Worker(new URL("./worker.js", import.meta.url));

worker.addEventListener("message", (event) => {
  globalThis.consumerResult = event.data;
});

worker.addEventListener("error", (event) => {
  globalThis.consumerResult = { type: "error", message: event.message };
});
