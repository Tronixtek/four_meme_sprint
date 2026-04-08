import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const apiDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(apiDir, "..");
const { loadLocalEnvFiles } = require("../lib/env");

loadLocalEnvFiles(rootDir);

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function readJsonBody(request) {
  const raw = await request.text();

  if (!raw) {
    return {};
  }

  if (raw.length > 8_000_000) {
    throw new Error("Payload too large");
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid JSON");
  }
}

export {
  jsonResponse,
  readJsonBody,
  require
};
