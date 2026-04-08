const fs = require("fs");
const path = require("path");

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!key) {
    return null;
  }

  let value = trimmed.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadEnvFile(filePath, protectedKeys) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    if (protectedKeys.has(parsed.key)) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
  }
}

function loadLocalEnvFiles(rootDir) {
  const protectedKeys = new Set(Object.keys(process.env));
  const envFiles = [".env", ".env.local"];

  for (const filename of envFiles) {
    loadEnvFile(path.join(rootDir, filename), protectedKeys);
  }
}

module.exports = {
  loadLocalEnvFiles
};
