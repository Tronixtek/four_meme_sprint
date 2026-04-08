import { jsonResponse, readJsonBody, require } from "./_shared.mjs";

const { analyzeWithBestAvailable } = require("../lib/openai-analysis");

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    try {
      const body = await readJsonBody(request);
      const result = await analyzeWithBestAvailable(body);
      return jsonResponse(200, result);
    } catch (error) {
      const statusCode = error.message === "Payload too large" ? 413 : 400;
      return jsonResponse(statusCode, { error: error.message });
    }
  }
};
