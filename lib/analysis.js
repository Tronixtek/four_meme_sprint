const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const URL_REGEX = /^https?:\/\//i;

const suspiciousTlds = new Set([
  ".click",
  ".gq",
  ".icu",
  ".lol",
  ".monster",
  ".rest",
  ".shop",
  ".top",
  ".vip",
  ".xyz"
]);

const riskPatterns = [
  {
    test: /\b(act now|ends in|expiring|limited time|only today|urgent|last chance)\b/i,
    score: 18,
    title: "Urgency-heavy language",
    detail: "The message pushes fast action, which is common in scam campaigns."
  },
  {
    test: /\b(guaranteed|risk-free|double your|100x|instant profit|send .* receive)\b/i,
    score: 24,
    title: "Unrealistic financial promise",
    detail: "Claims of guaranteed upside are a strong scam indicator."
  },
  {
    test: /\b(seed phrase|private key|wallet recovery|secret phrase)\b/i,
    score: 35,
    title: "Credential harvesting language",
    detail: "Requests for wallet credentials should be treated as malicious."
  },
  {
    test: /\b(dm me|telegram me|contact admin|support in dm)\b/i,
    score: 10,
    title: "Off-platform redirection",
    detail: "Moving support or access into direct messages reduces transparency."
  },
  {
    test: /\b(airdrop|presale|mint|whitelist|claim)\b/i,
    score: 6,
    title: "Event-triggered token language",
    detail: "Launch-style prompts deserve extra scrutiny, especially when paired with urgency."
  }
];

const trustPatterns = [
  {
    test: /\b(github|docs|whitepaper|audit|contract verified|multi-sig)\b/i,
    score: -8,
    title: "Project transparency cues",
    detail: "The submission references materials a reviewer can inspect."
  },
  {
    test: /\b(main site|official account|official docs|public repo)\b/i,
    score: -6,
    title: "Claims of official provenance",
    detail: "Official references help, but still need verification against known sources."
  },
  {
    test: /\b(open source|apache|mit license|public roadmap)\b/i,
    score: -5,
    title: "Open-source posture",
    detail: "Open delivery artifacts make a project easier to audit."
  }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function detectType(input, preferredType) {
  if (preferredType && preferredType !== "auto") {
    return preferredType;
  }

  if (ADDRESS_REGEX.test(input)) {
    return "address";
  }

  if (SOLANA_ADDRESS_REGEX.test(input)) {
    return "address";
  }

  if (URL_REGEX.test(input)) {
    return "url";
  }

  return "text";
}

function extractClaims(input, type) {
  if (type === "address") {
    return [
      "A wallet or contract address was submitted for trust screening.",
      "Address syntax can be validated immediately, but ownership, deployment history, and provenance still need live verification."
    ];
  }

  if (type === "url") {
    return [
      "A link was submitted for destination and language risk analysis.",
      "Domain legitimacy, page integrity, and official ownership still require source verification."
    ];
  }

  const segments = input
    .split(/[\n\r.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const claimLike = segments.filter((segment) =>
    /\b(is|are|will|launched|verified|official|partnership|airdrop|mint|claim|send|join)\b/i.test(segment)
  );

  return (claimLike.length ? claimLike : segments).slice(0, 4);
}

function analyzeUrl(input, evidence, signals) {
  let score = 0;

  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const tld = `.${host.split(".").pop()}`;

    evidence.push({
      status: "info",
      label: "Destination host",
      detail: host
    });

    if (url.protocol !== "https:") {
      score += 18;
      signals.push({
        kind: "risk",
        title: "Link is not using HTTPS",
        detail: "Unencrypted pages are easier to impersonate and intercept."
      });
    }

    if (host.includes("xn--")) {
      score += 18;
      signals.push({
        kind: "risk",
        title: "Possible punycode or lookalike domain",
        detail: "This host may be designed to visually imitate a trusted brand."
      });
    }

    if ((host.match(/-/g) || []).length >= 3) {
      score += 8;
      signals.push({
        kind: "risk",
        title: "Overly complex host pattern",
        detail: "Multiple hyphens often appear in throwaway campaign domains."
      });
    }

    if (suspiciousTlds.has(tld)) {
      score += 10;
      signals.push({
        kind: "risk",
        title: `High-risk domain suffix ${tld}`,
        detail: "This suffix shows up frequently in low-trust promotion funnels."
      });
    }

    if (url.search.length > 60) {
      score += 7;
      signals.push({
        kind: "risk",
        title: "Tracking-heavy query string",
        detail: "Long query parameters can hide redirect or affiliate behavior."
      });
    }
  } catch (error) {
    score += 25;
    signals.push({
      kind: "risk",
      title: "Malformed URL",
      detail: "The link format is invalid or incomplete."
    });
  }

  return score;
}

function analyzeAddress(input, evidence, signals) {
  let score = 0;

  if (ADDRESS_REGEX.test(input)) {
    evidence.push({
      status: "positive",
      label: "EVM syntax check",
      detail: "Address format is valid."
    });

    signals.push({
      kind: "positive",
      title: "Valid address structure",
      detail: "The checksum was not verified, but the address matches an EVM-style pattern."
    });
  } else if (SOLANA_ADDRESS_REGEX.test(input)) {
    evidence.push({
      status: "positive",
      label: "Solana syntax check",
      detail: "Address format is valid."
    });

    signals.push({
      kind: "positive",
      title: "Valid address structure",
      detail: "The address matches a Solana-style base58 pattern."
    });
  } else {
    score += 30;
    signals.push({
      kind: "risk",
      title: "Invalid address format",
      detail: "This does not match a recognized EVM or Solana address pattern."
    });
  }

  evidence.push({
    status: "unknown",
    label: "Chain activity",
    detail: "Transaction history, deployer checks, and holder distribution need a live RPC or explorer API."
  });

  return score;
}

function analyzeText(input, evidence, signals) {
  let score = 0;

  for (const pattern of riskPatterns) {
    if (pattern.test.test(input)) {
      score += pattern.score;
      signals.push({
        kind: "risk",
        title: pattern.title,
        detail: pattern.detail
      });
    }
  }

  for (const pattern of trustPatterns) {
    if (pattern.test.test(input)) {
      score += pattern.score;
      signals.push({
        kind: "positive",
        title: pattern.title,
        detail: pattern.detail
      });
    }
  }

  const uppercaseRatio = input.replace(/[^A-Z]/g, "").length / Math.max(input.replace(/[^A-Za-z]/g, "").length, 1);
  if (uppercaseRatio > 0.35 && input.length > 32) {
    score += 9;
    signals.push({
      kind: "risk",
      title: "High-emphasis formatting",
      detail: "Heavy capitalization is often used to pressure attention."
    });
  }

  const exclamationCount = (input.match(/!/g) || []).length;
  if (exclamationCount >= 3) {
    score += 6;
    signals.push({
      kind: "risk",
      title: "Excessive exclamation pressure",
      detail: "Repeated punctuation often appears in hype-first campaigns."
    });
  }

  evidence.push({
    status: "info",
    label: "Claim extraction",
    detail: "Language screening completed locally."
  });

  return score;
}

function buildSummary(verdict, type, score) {
  const intros = {
    address: "This address looks structurally valid, but live chain evidence is still missing.",
    text: "The submitted claim contains signals we can pre-screen before deeper verification.",
    url: "The submitted link has been screened for destination and language-based risk signals."
  };

  const endings = {
    Suspicious: "Treat this as high risk until it is confirmed against official sources and on-chain records.",
    "Needs More Evidence": "There is not enough live evidence yet to prove or dismiss the claim with confidence.",
    "Low-Risk Pattern": "Nothing obviously malicious stood out in the offline pass, but that is not the same as proof."
  };

  return `${intros[type] || intros.text} Risk score: ${score}/100. ${endings[verdict]}`;
}

function buildNextSteps(type, verdict) {
  const base = [
    "Check the official website, docs, or verified social account before acting.",
    "Cross-check any wallet or contract against an explorer and known deployer history.",
    "Do not sign transactions, reveal secrets, or send funds based only on a screenshot or post."
  ];

  if (type === "url") {
    base.unshift("Open the link in an isolated browser profile and inspect redirects before connecting a wallet.");
  }

  if (type === "address") {
    base.unshift("Inspect deployment date, first funder, and holder concentration on-chain.");
  }

  if (verdict === "Suspicious") {
    base.unshift("Pause distribution and flag this claim for manual review in your community channel.");
  }

  return base.slice(0, 4);
}

function buildEvidence(type, input, evidence) {
  if (type === "text" && input.length < 18) {
    evidence.push({
      status: "unknown",
      label: "Context depth",
      detail: "Short inputs give the model less context, which lowers confidence."
    });
  }

  evidence.push({
    status: "unknown",
    label: "Live verification",
    detail: "Live source verification is not yet available in this screening pass, so treat this as a first-pass report rather than final proof."
  });

  return evidence;
}

function analyzeSubmission(payload = {}) {
  const rawInput = typeof payload.input === "string" ? payload.input.trim() : "";

  if (!rawInput) {
    throw new Error("Input is required");
  }

  const type = detectType(rawInput, payload.type);
  const evidence = [];
  const signals = [];
  const claims = extractClaims(rawInput, type);

  let score = 18;

  if (type === "url") {
    score += analyzeUrl(rawInput, evidence, signals);
  }

  if (type === "address") {
    score += analyzeAddress(rawInput, evidence, signals);
  }

  if (type === "text" || type === "url") {
    score += analyzeText(rawInput, evidence, signals);
  }

  score = clamp(score, 0, 100);

  let verdict = "Needs More Evidence";
  if (score >= 60) {
    verdict = "Suspicious";
  } else if (score <= 28) {
    verdict = "Low-Risk Pattern";
  }

  const confidence = clamp(40 + signals.length * 7, 42, 89);

  return {
    mode: type,
    verdict,
    riskScore: score,
    confidence,
    summary: buildSummary(verdict, type, score),
    claims,
    signals,
    evidence: buildEvidence(type, rawInput, evidence),
    nextSteps: buildNextSteps(type, verdict),
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  analyzeSubmission
};
