import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./src/security.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");

await loadEnv(join(root, ".env"));
const { handleApiRequest } = await import("./src/api-core.mjs");

const PORT = Number(process.env.PORT || 4173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

const server = createServer(async (request, response) => {
  try {
    for (const [key, value] of Object.entries(securityHeaders)) response.setHeader(key, value);
    const url = new URL(request.url || "/", `http://127.0.0.1:${PORT}`);

    if (url.pathname.startsWith("/api/")) {
      const result = await handleApiRequest({
        method: request.method || "GET",
        pathname: url.pathname,
        searchParams: url.searchParams,
        headers: request.headers,
        clientId: request.socket.remoteAddress
      });
      return sendJson(response, result.status, result.body, result.headers);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error("[server] request failed", error);
    return sendJson(response, 500, {
      error: "서버에서 요청을 처리하지 못했습니다."
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Rift Record running at http://127.0.0.1:${PORT}`);
  if (!process.env.RIOT_API_KEY) {
    console.log("RIOT_API_KEY is not configured. Copy .env.example to .env.");
  }
});

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/"
    ? "index.html"
    : normalize(decodeURIComponent(pathname.slice(1)));
  const filePath = join(publicRoot, requestedPath);
  const relativePath = relative(publicRoot, filePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath) || requestedPath.split(/[\\/]/).some((part) => part.startsWith("."))) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(content);
  } catch {
    if (extname(requestedPath)) {
      return sendJson(response, 404, { error: "파일을 찾을 수 없습니다." });
    }

    const index = await readFile(join(publicRoot, "index.html"));
    response.writeHead(200, {
      "Content-Type": mimeTypes[".html"],
      "Cache-Control": "no-cache"
    });
    response.end(index);
  }
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

async function loadEnv(path) {
  try {
    const content = await readFile(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env is optional. The health endpoint reports missing configuration.
  }
}

export { server };
