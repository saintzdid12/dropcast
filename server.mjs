import http from "node:http";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initialState, validateState } from "./public/model.js";

const root = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({
  dataFile = path.join(root, ".dropcast", "show.json"),
} = {}) {
  let state = initialState();
  try {
    state = validateState(JSON.parse(await readFile(dataFile, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(`Cannot load saved show: ${error.message}`);
  }
  const clients = new Set();
  let writing = false;
  const sendState = (response) =>
    response.write(`data: ${JSON.stringify(state)}\n\n`);
  const server = http.createServer(async (request, response) => {
    const json = (status, data) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(data));
    };
    try {
      // Loopback-only binding plus Host/Origin checks protects the local operator API from browser cross-origin requests.
      if (
        !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
          request.headers.host || "",
        )
      )
        return json(403, { error: "Local connections only." });
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/api/state" && request.method === "GET")
        return json(200, state);
      if (url.pathname === "/api/events" && request.method === "GET") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        clients.add(response);
        sendState(response);
        const heartbeat = setInterval(
          () => response.write(": keepalive\n\n"),
          15000,
        );
        request.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(response);
        });
        return;
      }
      if (url.pathname === "/api/state" && request.method === "PUT") {
        if (
          request.headers.origin &&
          request.headers.origin !== `http://${request.headers.host}`
        )
          return json(403, { error: "Cross-origin writes are blocked." });
        if (request.headers["content-type"] !== "application/json")
          return json(415, { error: "Use application/json." });
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 262144)
            return json(413, { error: "Show file is too large." });
        }
        const next = validateState(JSON.parse(body));
        if (writing || next.revision !== state.revision)
          return json(409, {
            error: "Another operator changed the show. Reload before editing.",
          });
        writing = true;
        try {
          next.revision++;
          await mkdir(path.dirname(dataFile), { recursive: true });
          await writeFile(`${dataFile}.tmp`, JSON.stringify(next, null, 2));
          await rename(`${dataFile}.tmp`, dataFile);
          state = next;
          for (const client of clients) sendState(client);
          return json(200, state);
        } finally {
          writing = false;
        }
      }
      if (request.method !== "GET")
        return json(405, { error: "Method not allowed." });
      const files = {
        "/": "index.html",
        "/overlay": "overlay.html",
        "/app.js": "app.js",
        "/model.js": "model.js",
        "/clutch-snapshot.js": "clutch-snapshot.js",
        "/assets/gameplay.webp": "assets/gameplay.webp",
        "/style.css": "style.css",
      };
      const file = files[url.pathname];
      if (!file) return json(404, { error: "Not found." });
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".webp": "image/webp",
      };
      response.writeHead(200, {
        "Content-Type": `${types[path.extname(file)]}; charset=utf-8`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' https: http:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'",
      });
      response.end(await readFile(path.join(root, "public", file)));
    } catch (error) {
      json(
        error instanceof SyntaxError ||
          /must|Provide|Expected|Choose|cannot|required|exist|unique|Logo/.test(
            error.message,
          )
          ? 400
          : 500,
        { error: error.message },
      );
    }
  });
  server.on("close", () => {
    for (const client of clients) client.end();
  });
  return server;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3210);
  const server = await createApp();
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Dropcast operator: http://127.0.0.1:${port}\nOBS browser source: http://127.0.0.1:${port}/overlay`,
    ),
  );
}
