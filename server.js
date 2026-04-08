const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadLocalEnvFiles } = require("./lib/env");
const { analyzeWithBestAvailable, isOpenAIConfigured, getOpenAIModel } = require("./lib/openai-analysis");
const { getEvmChainLabel, getEvmRpcSourceLabel, isEvmRpcReady } = require("./lib/evm-rpc");
const { getSolanaChainLabel, getSolanaRpcSourceLabel, isSolanaRpcReady } = require("./lib/solana-rpc");

loadLocalEnvFiles(__dirname);

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function serveFile(filePath, response) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Server error");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600"
    });
    response.end(content);
  });
}

function getBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;

      if (raw.length > 8_000_000) {
        reject(new Error("Payload too large"));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });

    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "proof-of-meme",
      aiConfigured: isOpenAIConfigured(),
      model: getOpenAIModel(),
      evmConfigured: isEvmRpcReady(),
      evmChainLabel: getEvmChainLabel(),
      evmRpcSource: getEvmRpcSourceLabel(),
      solanaConfigured: isSolanaRpcReady(),
      solanaChainLabel: getSolanaChainLabel(),
      solanaRpcSource: getSolanaRpcSourceLabel()
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/analyze") {
    try {
      const body = await getBody(request);
      const result = await analyzeWithBestAvailable(body);
      sendJson(response, 200, result);
    } catch (error) {
      const statusCode = error.message === "Payload too large" ? 413 : 400;
      sendJson(response, statusCode, { error: error.message });
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  const relativePath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(publicDir, relativePath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  serveFile(filePath, response);
});

server.listen(PORT, () => {
  console.log(`Proof of Meme running at http://localhost:${PORT}`);
});
