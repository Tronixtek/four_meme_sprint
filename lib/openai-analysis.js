const { analyzeSubmission } = require("./analysis");
const { getEvmChainLabel, getEvmRpcSourceLabel, isEvmAddress, isEvmRpcReady, lookupEvmAddress } = require("./evm-rpc");
const { getSolanaChainLabel, getSolanaRpcSourceLabel, isSolanaAddress, isSolanaRpcReady, lookupSolanaAddress } = require("./solana-rpc");

const VALID_EVIDENCE_STATUS = new Set(["positive", "info", "warning", "unknown"]);
const VALID_MODES = new Set(["text", "url", "address", "image"]);
const VALID_SIGNAL_KIND = new Set(["positive", "risk", "info", "unknown"]);
const VALID_VERDICTS = new Set(["Suspicious", "Needs More Evidence", "Low-Risk Pattern"]);
const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;

const ANALYSIS_INSTRUCTIONS = `
You are Proof of Meme, a cautious AI trust analyst for Web3 communities and internet-native rumor cycles.

Your job is to assess claims, screenshots, links, wallets, and token launch messages without inventing facts.

Rules:
- Return JSON only. No markdown fences.
- Never claim that on-chain history, account ownership, or domain legitimacy is verified unless the provided evidence directly proves it.
- Distinguish between what is visible, what is claimed, and what still needs verification.
- If an image is provided, extract the visible text and trust cues from the image before scoring risk.
- Use "Needs More Evidence" when the submission is incomplete or authenticity cannot be confirmed.
- Focus on scam patterns such as urgency, credential harvesting, fake support, unrealistic returns, impersonation, spoofed links, and manipulative launch language.

Return this exact JSON shape:
{
  "mode": "text | url | address | image",
  "verdict": "Suspicious | Needs More Evidence | Low-Risk Pattern",
  "riskScore": 0,
  "confidence": 0,
  "summary": "short summary",
  "claims": ["claim 1"],
  "signals": [
    { "kind": "risk | positive | info | unknown", "title": "short title", "detail": "short detail" }
  ],
  "evidence": [
    { "status": "positive | info | warning | unknown", "label": "short label", "detail": "short detail" }
  ],
  "nextSteps": ["step 1"]
}
`.trim();

function getOpenAIBaseUrl() {
  return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
}

function getOpenAIModel() {
  return process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildOfflineImageResult(payload) {
  return {
    mode: "image",
    verdict: "Needs More Evidence",
    riskScore: 36,
    confidence: 44,
    summary:
      "A screenshot was submitted, but visual text extraction and authenticity checks are temporarily unavailable in this pass.",
    claims: [
      payload.imageName ? `Screenshot submitted: ${payload.imageName}.` : "A screenshot was submitted for inspection.",
      "Visual text, branding, and authenticity cues need an AI-powered OCR and vision pass."
    ],
    signals: [
      {
        kind: "info",
        title: "Screenshot present",
        detail: "The app received image evidence, but this pass can only acknowledge it rather than inspect it."
      }
    ],
    evidence: [
      {
        status: "info",
        label: "Image evidence attached",
        detail: payload.imageName || "Unnamed screenshot"
      },
      {
        status: "unknown",
        label: "Visual authenticity",
        detail: "Logo spoofing, fake profile UI, and screenshot manipulation require a live multimodal pass."
      }
    ],
    nextSteps: [
      "Compare the screenshot against the official account, website, or channel.",
      "Verify any addresses, links, or usernames manually before acting.",
      "Run the screenshot through the full AI review path before making a final trust decision."
    ],
    generatedAt: new Date().toISOString()
  };
}

function buildOfflineFallback(payload = {}) {
  const input = typeof payload.input === "string" ? payload.input.trim() : "";
  const hasImage = Boolean(payload.imageDataUrl);

  if (!input && hasImage) {
    return buildOfflineImageResult(payload);
  }

  if (!input) {
    throw new Error("Input or image is required");
  }

  const fallbackType = payload.type === "image" ? "text" : payload.type;
  const result = analyzeSubmission({
    input,
    type: fallbackType
  });

  if (hasImage) {
    result.mode = payload.type === "image" ? "image" : result.mode;
    result.summary = `${result.summary} A screenshot was attached but not visually inspected in this pass.`;
    result.evidence.unshift({
      status: "info",
      label: "Image evidence attached",
      detail: payload.imageName || "Unnamed screenshot"
    });
    result.evidence.push({
      status: "unknown",
      label: "Visual verification pending",
      detail: "Screenshot text, layout, and impersonation cues still need a full visual review."
    });
  }

  return result;
}

function extractOutputText(response) {
  const output = Array.isArray(response.output) ? response.output : [];

  for (const item of output) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const part of item.content) {
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }

  throw new Error("OpenAI response did not include output text");
}

function extractJson(text) {
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Model output did not contain valid JSON");
  }

  return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
}

function toClampedNumber(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeTextList(list, fallback, limit) {
  if (!Array.isArray(list)) {
    return fallback;
  }

  const sanitized = list
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);

  return sanitized.length ? sanitized : fallback;
}

function sanitizeSignals(list, fallback) {
  if (!Array.isArray(list)) {
    return fallback;
  }

  const sanitized = list
    .map((item) => ({
      kind: VALID_SIGNAL_KIND.has(item?.kind) ? item.kind : "info",
      title: typeof item?.title === "string" ? item.title.trim() : "",
      detail: typeof item?.detail === "string" ? item.detail.trim() : ""
    }))
    .filter((item) => item.title && item.detail)
    .slice(0, 8);

  return sanitized.length ? sanitized : fallback;
}

function sanitizeEvidence(list, fallback) {
  if (!Array.isArray(list)) {
    return fallback;
  }

  const sanitized = list
    .map((item) => ({
      status: VALID_EVIDENCE_STATUS.has(item?.status) ? item.status : "info",
      label: typeof item?.label === "string" ? item.label.trim() : "",
      detail: typeof item?.detail === "string" ? item.detail.trim() : ""
    }))
    .filter((item) => item.label && item.detail)
    .slice(0, 8);

  return sanitized.length ? sanitized : fallback;
}

function normalizeAiResult(candidate, fallback, payload) {
  const verdict = VALID_VERDICTS.has(candidate?.verdict) ? candidate.verdict : fallback.verdict;
  const mode = VALID_MODES.has(candidate?.mode) ? candidate.mode : fallback.mode;
  const result = {
    mode,
    verdict,
    riskScore: toClampedNumber(candidate?.riskScore, fallback.riskScore),
    confidence: toClampedNumber(candidate?.confidence, fallback.confidence),
    summary: typeof candidate?.summary === "string" && candidate.summary.trim() ? candidate.summary.trim() : fallback.summary,
    claims: sanitizeTextList(candidate?.claims, fallback.claims, 6),
    signals: sanitizeSignals(candidate?.signals, fallback.signals),
    evidence: sanitizeEvidence(candidate?.evidence, fallback.evidence),
    nextSteps: sanitizeTextList(candidate?.nextSteps, fallback.nextSteps, 5),
    generatedAt: new Date().toISOString()
  };

  if (payload.imageDataUrl) {
    result.evidence.unshift({
      status: "info",
      label: "Image evidence attached",
      detail: payload.imageName || "Unnamed screenshot"
    });
  }

  return result;
}

function buildInputContent(payload) {
  const input = typeof payload.input === "string" ? payload.input.trim() : "";
  const promptLines = [
    "Analyze this submission for trust, scam, or impersonation risk.",
    `Requested mode: ${payload.type || "auto"}`,
    `Typed input: ${input || "(none)"}`,
    `Image attached: ${payload.imageDataUrl ? "yes" : "no"}`
  ];

  if (payload.imageName) {
    promptLines.push(`Image filename: ${payload.imageName}`);
  }

  const content = [
    {
      type: "input_text",
      text: promptLines.join("\n")
    }
  ];

  if (payload.imageDataUrl) {
    if (payload.imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      throw new Error("Image is too large. Keep uploads under about 4 MB.");
    }

    content.push({
      type: "input_image",
      image_url: payload.imageDataUrl
    });
  }

  return content;
}

async function analyzeWithOpenAI(payload, fallback) {
  const response = await fetch(`${getOpenAIBaseUrl()}/responses`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: getOpenAIModel(),
      store: false,
      instructions: ANALYSIS_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: buildInputContent(payload)
        }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed with status ${response.status}`);
  }

  const outputText = extractOutputText(data);
  const parsed = extractJson(outputText);
  return normalizeAiResult(parsed, fallback, payload);
}

function isAddressPayload(payload) {
  return payload?.type === "address" || isEvmAddress(payload?.input) || isSolanaAddress(payload?.input);
}

function computeAddressVerdict(score, intel) {
  if (score >= 60) {
    return "Suspicious";
  }

  if (intel.isContract) {
    if (score <= 24 && intel.token?.isTokenLike) {
      return "Low-Risk Pattern";
    }

    return "Needs More Evidence";
  }

  if (intel.transactionCount === 0) {
    return "Needs More Evidence";
  }

  if (score <= 28 && intel.transactionCount >= 5) {
    return "Low-Risk Pattern";
  }

  return "Needs More Evidence";
}

function buildAddressSummary(intel, verdict, score) {
  const identity = intel.isContract
    ? intel.token?.symbol
      ? `This contract appears live on ${intel.chainLabel} and exposes token metadata for ${intel.token.name || "an asset"}${intel.token.symbol ? ` (${intel.token.symbol})` : ""}.`
      : `This contract is deployed on ${intel.chainLabel}, but token metadata is limited.`
    : `This address behaves like a wallet on ${intel.chainLabel}.`;

  const activity = intel.isContract
    ? `Observed contract nonce: ${intel.transactionCount}. Current balance: ${intel.balanceDisplay}.`
    : intel.transactionCount === 0
      ? "No wallet transactions were observed from the current RPC snapshot."
      : `Observed wallet transaction count: ${intel.transactionCount}. Current balance: ${intel.balanceDisplay}.`;

  const ending = {
    Suspicious: "Treat any trust claims around it carefully until deployer and source ownership are verified.",
    "Needs More Evidence": "There is useful chain data now, but not enough provenance to mark it as trustworthy on its own.",
    "Low-Risk Pattern": "Nothing obviously dangerous stood out in this chain pass, though provenance still matters."
  };

  return `${identity} ${activity} Risk score: ${score}/100. ${ending[verdict]}`;
}

function enrichAddressResult(baseResult, intel) {
  const claims = [...baseResult.claims];
  const signals = [...baseResult.signals];
  const evidence = baseResult.evidence.filter((item) => item.label !== "Live verification");
  const nextSteps = [...baseResult.nextSteps];

  let riskScore = baseResult.riskScore;

  evidence.unshift({
    status: "info",
    label: "Live chain source",
    detail: `${intel.chainLabel} via ${intel.rpcSource}`
  });

  evidence.unshift({
    status: intel.isContract ? "positive" : "info",
    label: "Address type",
    detail: intel.isContract ? `Contract bytecode detected (${intel.codeBytes} bytes).` : "No bytecode detected. This looks like a wallet/EOA."
  });

  evidence.push({
    status: "info",
    label: "Current balance",
    detail: intel.balanceDisplay
  });

  evidence.push({
    status: "info",
    label: intel.isContract ? "Contract nonce" : "Wallet transaction count",
    detail: `${intel.transactionCount}`
  });

  evidence.push({
    status: "unknown",
    label: "Additional verification needed",
    detail: "Deployer provenance, holder distribution, and official source matching still need explorer or project-source checks."
  });

  claims.push(
    intel.isContract
      ? "Live chain lookup confirms this address has deployed bytecode."
      : "Live chain lookup shows no deployed bytecode, which is typical for a wallet."
  );

  if (intel.isContract) {
    signals.push({
      kind: "positive",
      title: "Deployed contract detected",
      detail: "The address has live bytecode on-chain."
    });
  } else {
    signals.push({
      kind: "info",
      title: "Wallet-style address",
      detail: "No contract bytecode was found at this address."
    });
  }

  if (!intel.isContract) {
    if (intel.transactionCount === 0) {
      riskScore += 14;
      signals.push({
        kind: "risk",
        title: "No wallet history observed",
        detail: "Fresh or inactive wallets deserve extra scrutiny before being treated as official."
      });
    } else if (intel.transactionCount < 3) {
      riskScore += 7;
      signals.push({
        kind: "info",
        title: "Very limited wallet history",
        detail: "This wallet has only a small amount of observed outgoing activity."
      });
    } else if (intel.transactionCount >= 25) {
      riskScore -= 8;
      signals.push({
        kind: "positive",
        title: "Established wallet activity",
        detail: "The wallet has a meaningful history of transactions."
      });
    }
  } else if (intel.transactionCount <= 1) {
    signals.push({
      kind: "info",
      title: "Low contract nonce",
      detail: "Contract nonce is not a proxy for popularity, but this value suggests limited outbound contract-created transactions."
    });
  }

  if (!intel.isContract && intel.balanceWei === 0n && intel.transactionCount === 0) {
    riskScore += 5;
    evidence.push({
      status: "warning",
      label: "Funding status",
      detail: "This address is currently unfunded and unused on the observed chain."
    });
  }

  if (intel.token?.isTokenLike) {
    riskScore -= 4;
    signals.push({
      kind: "positive",
      title: "Token-style metadata detected",
      detail: "The contract responded to one or more standard token metadata calls."
    });

    evidence.push({
      status: "positive",
      label: "Token metadata",
      detail: `${intel.token.name || "Unknown name"}${intel.token.symbol ? ` (${intel.token.symbol})` : ""}${intel.token.decimals !== null ? `, ${intel.token.decimals} decimals` : ""}`
    });

    if (intel.token.totalSupply) {
      evidence.push({
        status: "info",
        label: "Reported total supply",
        detail: intel.token.totalSupply
      });
    }
  } else if (intel.isContract) {
    signals.push({
      kind: "info",
      title: "Contract metadata not confirmed",
      detail: "The contract did not cleanly expose standard token metadata through the current RPC checks."
    });
  }

  riskScore = clamp(riskScore, 0, 100);
  const verdict = computeAddressVerdict(riskScore, intel);
  const summary = buildAddressSummary(intel, verdict, riskScore);

  if (!nextSteps.some((step) => step.includes("explorer"))) {
    nextSteps.unshift("Inspect the address on a block explorer and confirm who first funded or deployed it.");
  }

  if (intel.isContract) {
    nextSteps.unshift("Check whether liquidity, ownership, and upgrade permissions are still controlled by a trusted party.");
  }

  return {
    ...baseResult,
    mode: "address",
    verdict,
    riskScore,
    confidence: clamp(Math.max(baseResult.confidence, 64), 0, 100),
    summary,
    claims: claims.slice(0, 6),
    signals: signals.slice(0, 8),
    evidence: evidence.slice(0, 8),
    nextSteps: nextSteps.slice(0, 5),
    chainAnalysis: {
      available: true,
      chainType: "evm",
      chainLabel: intel.chainLabel,
      rpcSource: intel.rpcSource
    }
  };
}

function computeSolanaVerdict(score, intel) {
  if (score >= 60) {
    return "Suspicious";
  }

  if (intel.tokenMint?.isTokenMint) {
    if (score <= 24) {
      return "Low-Risk Pattern";
    }

    return "Needs More Evidence";
  }

  if (intel.recentSignatureCount === 0) {
    return "Needs More Evidence";
  }

  if (score <= 28 && intel.recentSignatureCount >= 5) {
    return "Low-Risk Pattern";
  }

  return "Needs More Evidence";
}

function buildSolanaSummary(intel, verdict, score) {
  const identity = intel.tokenMint?.isTokenMint
    ? `This Solana address appears to be a live token mint on ${intel.chainLabel}.`
    : intel.executable
      ? `This Solana address appears to be an executable program on ${intel.chainLabel}.`
      : `This Solana address appears to be a regular account on ${intel.chainLabel}.`;

  const activity =
    intel.recentSignatureCount === 0
      ? "No recent signatures were returned in the current RPC sample."
      : `Recent signatures observed: ${intel.recentSignatureCount} (sample of up to 20). Current balance: ${intel.balanceDisplay}.`;

  const ending = {
    Suspicious: "Treat claims around it carefully until provenance and official source matching are confirmed.",
    "Needs More Evidence": "There is useful Solana state here, but not enough provenance to trust it on name alone.",
    "Low-Risk Pattern": "Nothing obviously dangerous stood out in this Solana pass, though provenance still matters."
  };

  return `${identity} ${activity} Risk score: ${score}/100. ${ending[verdict]}`;
}

function enrichSolanaAddressResult(baseResult, intel) {
  const claims = [...baseResult.claims];
  const signals = [...baseResult.signals];
  const evidence = baseResult.evidence.filter((item) => item.label !== "Live verification");
  const nextSteps = [...baseResult.nextSteps];

  let riskScore = baseResult.riskScore;

  evidence.unshift({
    status: intel.executable ? "positive" : "info",
    label: "Account type",
    detail: intel.executable ? "Executable program account detected." : "Non-executable account detected."
  });

  evidence.unshift({
    status: "info",
    label: "Live chain source",
    detail: `${intel.chainLabel} via ${intel.rpcSource}`
  });

  evidence.push({
    status: "info",
    label: "Current balance",
    detail: intel.balanceDisplay
  });

  evidence.push({
    status: "info",
    label: "Recent signature sample",
    detail: `${intel.recentSignatureCount} recent signatures observed`
  });

  evidence.push({
    status: "info",
    label: "Account owner",
    detail: intel.owner
  });

  evidence.push({
    status: "unknown",
    label: "Additional verification needed",
    detail: "Mint authority, freeze authority, deployment provenance, and official source matching still need explorer or project-source checks."
  });

  claims.push(
    intel.tokenMint?.isTokenMint
      ? "Live chain lookup indicates this address behaves like a token mint."
      : intel.executable
        ? "Live chain lookup indicates this address is an executable Solana program."
        : "Live chain lookup indicates this address is a regular Solana account."
  );

  if (intel.tokenMint?.isTokenMint) {
    signals.push({
      kind: "positive",
      title: "Token mint behavior detected",
      detail: "The address responded to Solana token mint supply queries."
    });
  } else if (intel.executable) {
    signals.push({
      kind: "positive",
      title: "Executable program detected",
      detail: "The address is marked executable on Solana."
    });
  } else {
    signals.push({
      kind: "info",
      title: "Regular account detected",
      detail: "This Solana address is not marked executable."
    });
  }

  if (intel.recentSignatureCount === 0) {
    riskScore += 12;
    signals.push({
      kind: "risk",
      title: "No recent signature activity",
      detail: "Fresh or inactive Solana accounts deserve extra scrutiny before being treated as official."
    });
  } else if (intel.recentSignatureCount < 3) {
    riskScore += 6;
    signals.push({
      kind: "info",
      title: "Limited recent activity",
      detail: "Only a small amount of recent signature activity was observed."
    });
  } else if (intel.recentSignatureCount >= 10) {
    riskScore -= 6;
    signals.push({
      kind: "positive",
      title: "Visible recent activity",
      detail: "The account shows a meaningful amount of recent Solana activity."
    });
  }

  if (intel.isSystemOwned && !intel.executable && intel.recentSignatureCount >= 5) {
    riskScore -= 4;
    signals.push({
      kind: "positive",
      title: "System-owned account",
      detail: "The account is owned by the Solana system program, consistent with a regular wallet account."
    });
  }

  if (intel.tokenMint?.isTokenMint) {
    evidence.push({
      status: "positive",
      label: "Token mint metadata",
      detail: `${intel.tokenMint.supplyDisplay} total supply, ${intel.tokenMint.decimals} decimals`
    });

    if (intel.tokenMint.topHolderShare) {
      evidence.push({
        status: "info",
        label: "Top holder share",
        detail: intel.tokenMint.topHolderShare
      });
    }

    if (intel.tokenMint.top3HolderShare) {
      evidence.push({
        status: "info",
        label: "Top 3 holder share",
        detail: intel.tokenMint.top3HolderShare
      });
    }

    if (intel.tokenMint.topHolderShare) {
      const topHolderNumeric = Number(intel.tokenMint.topHolderShare.replace("%", ""));
      if (Number.isFinite(topHolderNumeric) && topHolderNumeric >= 50) {
        riskScore += 12;
        signals.push({
          kind: "risk",
          title: "High holder concentration",
          detail: "A single holder appears to control at least half of the sampled token supply."
        });
      }
    }
  }

  riskScore = clamp(riskScore, 0, 100);
  const verdict = computeSolanaVerdict(riskScore, intel);
  const summary = buildSolanaSummary(intel, verdict, riskScore);

  if (intel.tokenMint?.isTokenMint) {
    nextSteps.unshift("Check mint authority, freeze authority, and top-holder concentration in a Solana explorer.");
  } else if (intel.executable) {
    nextSteps.unshift("Verify the program ID against the official project docs or repository before trusting it.");
  } else {
    nextSteps.unshift("Confirm the wallet address against an official project profile or signed message before trusting it.");
  }

  return {
    ...baseResult,
    mode: "address",
    verdict,
    riskScore,
    confidence: clamp(Math.max(baseResult.confidence, 64), 0, 100),
    summary,
    claims: claims.slice(0, 6),
    signals: signals.slice(0, 8),
    evidence: evidence.slice(0, 8),
    nextSteps: nextSteps.slice(0, 5),
    chainAnalysis: {
      available: true,
      chainType: "solana",
      chainLabel: intel.chainLabel,
      rpcSource: intel.rpcSource
    }
  };
}

async function maybeEnrichAddressAnalysis(result, payload) {
  if (!isAddressPayload(payload)) {
    return result;
  }

  try {
    const rawInput = payload.input.trim();
    let enriched = result;

    if (isEvmAddress(rawInput) && isEvmRpcReady()) {
      const intel = await lookupEvmAddress(rawInput);
      enriched = enrichAddressResult(result, intel);
    } else if (isSolanaAddress(rawInput) && isSolanaRpcReady()) {
      const intel = await lookupSolanaAddress(rawInput);
      enriched = enrichSolanaAddressResult(result, intel);
    } else {
      return result;
    }

    const currentSource = enriched.sourceLabel || "Engine";
    return {
      ...enriched,
      sourceLabel: `${currentSource} + Chain`
    };
  } catch (error) {
    const evidence = [...(result.evidence || [])];
    evidence.unshift({
      status: "unknown",
      label: "Chain lookup unavailable",
      detail: error.message
    });

    return {
      ...result,
      evidence: evidence.slice(0, 8),
      chainAnalysis: {
        available: false,
        chainType: isSolanaAddress(payload.input) ? "solana" : "evm",
        chainLabel: isSolanaAddress(payload.input) ? getSolanaChainLabel() : getEvmChainLabel(),
        rpcSource: isSolanaAddress(payload.input) ? getSolanaRpcSourceLabel() : getEvmRpcSourceLabel(),
        error: error.message
      }
    };
  }
}

async function analyzeWithBestAvailable(payload = {}) {
  const fallback = buildOfflineFallback(payload);

  if (isAddressPayload(payload)) {
    return maybeEnrichAddressAnalysis({
      ...fallback,
      analysisSource: "offline",
      sourceLabel: "Deterministic address engine",
      model: null
    }, payload);
  }

  if (!isOpenAIConfigured()) {
    return maybeEnrichAddressAnalysis({
      ...fallback,
      analysisSource: "offline",
      sourceLabel: "Offline engine",
      model: null
    }, payload);
  }

  try {
    const aiResult = await analyzeWithOpenAI(payload, fallback);
    return maybeEnrichAddressAnalysis({
      ...aiResult,
      analysisSource: "openai",
      sourceLabel: `AI ${getOpenAIModel()}`,
      model: getOpenAIModel()
    }, payload);
  } catch (error) {
    return maybeEnrichAddressAnalysis({
      ...fallback,
      analysisSource: "offline-fallback",
      sourceLabel: "Offline fallback",
      model: null,
      fallbackReason: error.message
    }, payload);
  }
}

module.exports = {
  analyzeWithBestAvailable,
  getOpenAIModel,
  isOpenAIConfigured
};
