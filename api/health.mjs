import { jsonResponse, require } from "./_shared.mjs";

const { getHealthPayload } = require("../lib/health");

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    return jsonResponse(200, getHealthPayload());
  }
};
