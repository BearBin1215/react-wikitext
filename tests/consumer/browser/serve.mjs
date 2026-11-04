import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.CONSUMER_PORT ?? 4319);
const ROOT = fileURLToPath(new URL("../", import.meta.url));

const ROUTES = {
  "/vite": join(ROOT, "vite/dist"),
  "/webpack": join(ROOT, "webpack/dist"),
  "/view-vite": join(ROOT, "view-only/dist"),
  "/view-webpack": join(ROOT, "view-only/dist-webpack"),
  "/a11y": join(ROOT, "a11y/dist"),
  "/budget": join(ROOT, "../../test-results/budget/site"),
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
};

async function respond(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") {
    await respond(response, 200, "ok");
    return;
  }

  const prefix = Object.keys(ROUTES).find(
    (route) => url.pathname === route || url.pathname.startsWith(`${route}/`),
  );
  if (!prefix) {
    await respond(response, 404, `No consumer site for ${url.pathname}`);
    return;
  }

  const base = ROUTES[prefix];
  const relative = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\/+/u, "");
  let file = resolve(base, relative || "index.html");
  if (!file.startsWith(resolve(base))) {
    await respond(response, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, "index.html");
    }
    const content = await readFile(file);
    await respond(
      response,
      200,
      content,
      MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    );
  } catch {
    await respond(response, 404, `Missing asset: ${url.pathname}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Consumer sites listening on http://127.0.0.1:${PORT}`);
});
