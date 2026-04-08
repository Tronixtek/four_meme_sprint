const form = document.getElementById("analyzer-form");
const input = document.getElementById("submission-input");
const submissionLabel = document.getElementById("submission-label");
const screenshotInput = document.getElementById("screenshot-input");
const uploadStatus = document.getElementById("upload-status");
const engineStatus = document.getElementById("engine-status");
const modeButtons = Array.from(document.querySelectorAll(".mode-button"));
const sampleButtons = Array.from(document.querySelectorAll("[data-sample]"));
const copySummaryButton = document.getElementById("copy-summary");
const clearImageButton = document.getElementById("clear-image");
const submitButton = document.getElementById("submit-button");
const outputPanel = document.querySelector(".output-panel");

const verdictLabel = document.getElementById("verdict-label");
const summaryText = document.getElementById("summary-text");
const riskScore = document.getElementById("risk-score");
const modeLabel = document.getElementById("mode-label");
const generatedAt = document.getElementById("generated-at");
const confidencePill = document.getElementById("confidence-pill");
const sourcePill = document.getElementById("source-pill");
const modeSummary = document.getElementById("mode-summary");
const riskMeterFill = document.getElementById("risk-meter-fill");

const claimsList = document.getElementById("claims-list");
const signalsList = document.getElementById("signals-list");
const evidenceList = document.getElementById("evidence-list");
const nextStepsList = document.getElementById("next-steps-list");

const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;

const modeConfig = {
  text: {
    label: "Rumor text",
    badge: "Text",
    button: "Screen Submission",
    summary: "Text claim screening",
    rows: 9,
    placeholder: "Paste the claim exactly as your community saw it. Example: Official support says reconnect your wallet now to avoid suspension."
  },
  url: {
    label: "Link",
    badge: "Link",
    button: "Screen Link",
    summary: "Link risk screening",
    rows: 4,
    placeholder: "Paste the full URL you want screened."
  },
  address: {
    label: "Wallet or contract",
    badge: "Address",
    button: "Inspect Address",
    summary: "On-chain address review",
    rows: 4,
    placeholder: "Paste an EVM or Solana wallet, contract, mint, or program address."
  },
  image: {
    label: "Screenshot note",
    badge: "Screenshot",
    button: "Inspect Screenshot",
    summary: "Screenshot trust review",
    rows: 5,
    placeholder: "Optional note: describe what the screenshot is claiming or what should be verified."
  }
};

const samples = {
  rug: {
    type: "text",
    input:
      "OFFICIAL AIRDROP LIVE NOW!!! Send 1 ETH and receive 2 ETH back instantly. Ends in 10 minutes. DM admin on Telegram for support."
  },
  official: {
    type: "text",
    input:
      "Main site launch note: contract verified, GitHub repo public, docs and audit linked. Presale opens Friday and liquidity wallet is controlled by a multi-sig."
  },
  url: {
    type: "url",
    input: "http://official-meme-bonus-claim.xyz/claim?campaign=lastchance&wallet=connect-now"
  },
  address: {
    type: "address",
    input: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  }
};

let currentMode = "text";
let lastSummary = "";
let attachedImageDataUrl = "";
let attachedImageName = "";

function getModeDetails(mode) {
  return modeConfig[mode] || modeConfig.text;
}

function getDisplayMode(mode) {
  return getModeDetails(mode).badge;
}

function setMode(nextMode) {
  currentMode = nextMode;
  const details = getModeDetails(nextMode);

  for (const button of modeButtons) {
    button.classList.toggle("active", button.dataset.type === nextMode);
  }

  submissionLabel.textContent = details.label;
  submitButton.textContent = details.button;
  input.rows = details.rows;
  input.placeholder = details.placeholder;
}

function formatTimestamp(timestamp) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "Not generated yet";
  }

  return `Generated ${value.toLocaleString()}`;
}

function createTag(content) {
  const element = document.createElement("div");
  element.className = "tag";
  element.textContent = content;
  return element;
}

function createStackItem(title, detail, kind) {
  const element = document.createElement("div");
  element.className = `stack-item ${kind || "info"}`;

  const heading = document.createElement("strong");
  heading.textContent = title;

  const body = document.createElement("span");
  body.textContent = detail;

  element.append(heading, body);
  return element;
}

function fillContainer(container, children, emptyMessage) {
  container.innerHTML = "";

  if (!children.length) {
    container.className = container.id === "claims-list" ? "tag-list empty-state" : "stack-list empty-state";
    container.textContent = emptyMessage;
    return;
  }

  container.className = container.id === "claims-list" ? "tag-list" : "stack-list";
  children.forEach((child) => container.appendChild(child));
}

function applyStatusClass(verdict) {
  outputPanel.classList.remove("status-suspicious", "status-low-risk", "status-needs-evidence");

  if (verdict === "Suspicious") {
    outputPanel.classList.add("status-suspicious");
    return;
  }

  if (verdict === "Low-Risk Pattern") {
    outputPanel.classList.add("status-low-risk");
    return;
  }

  outputPanel.classList.add("status-needs-evidence");
}

function setUploadStatus(message) {
  uploadStatus.textContent = message;
}

function clearAttachedImage() {
  attachedImageDataUrl = "";
  attachedImageName = "";
  screenshotInput.value = "";
  setUploadStatus("No image selected. Add a screenshot to let Proof of Meme inspect visible text and trust cues.");
}

function formatSourceLabel(result) {
  if (result.analysisSource === "openai") {
    return result.chainAnalysis?.available ? "AI + Chain" : "AI Review";
  }

  if (result.chainAnalysis?.available) {
    return "Chain Review";
  }

  if (result.analysisSource === "offline-fallback") {
    return "Fallback Screen";
  }

  return "Local Screen";
}

function getModeSummary(mode) {
  return getModeDetails(mode).summary;
}

function renderResult(result) {
  const summarySuffix = result.fallbackReason
    ? " Live AI review was unavailable, so this proof report used deterministic screening."
    : "";
  const numericRisk = Number.parseInt(result.riskScore, 10);
  const riskValue = Number.isFinite(numericRisk) ? Math.max(0, Math.min(100, numericRisk)) : 0;
  const displayMode = getDisplayMode(result.mode);

  verdictLabel.textContent = result.verdict;
  summaryText.textContent = `${result.summary}${summarySuffix}`;
  riskScore.textContent = Number.isFinite(numericRisk) ? `${riskValue}` : "--";
  modeLabel.textContent = displayMode;
  generatedAt.textContent = formatTimestamp(result.generatedAt);
  confidencePill.textContent = result.confidence ? `${result.confidence}% confidence` : "Waiting";
  sourcePill.textContent = formatSourceLabel(result);
  modeSummary.textContent = getModeSummary(result.mode);
  riskMeterFill.style.width = `${riskValue}%`;

  const strongestSignal = Array.isArray(result.signals) && result.signals.length ? ` | ${result.signals[0].title}` : "";
  lastSummary = `${result.verdict} | Risk ${Number.isFinite(numericRisk) ? riskValue : "--"}/100 | ${result.summary}${strongestSignal}`;

  fillContainer(
    claimsList,
    result.claims.map((claim) => createTag(claim)),
    "No extracted claims yet."
  );

  fillContainer(
    signalsList,
    result.signals.map((signal) => createStackItem(signal.title, signal.detail, signal.kind)),
    "No signals yet."
  );

  fillContainer(
    evidenceList,
    result.evidence.map((item) => createStackItem(item.label, item.detail, item.status)),
    "No evidence trail yet."
  );

  fillContainer(
    nextStepsList,
    result.nextSteps.map((step, index) => createStackItem(`Step ${index + 1}`, step, "info")),
    "No recommended next steps yet."
  );

  applyStatusClass(result.verdict);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

async function handleScreenshotChange() {
  const file = screenshotInput.files[0];

  if (!file) {
    clearAttachedImage();
    return;
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    clearAttachedImage();
    setUploadStatus("Image too large. Keep screenshots under 4 MB for now.");
    return;
  }

  try {
    attachedImageDataUrl = await readFileAsDataUrl(file);
    attachedImageName = file.name;
    setUploadStatus(`Attached: ${file.name}`);
  } catch (error) {
    clearAttachedImage();
    setUploadStatus(error.message);
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const result = await response.json();

    if (!response.ok) {
      throw new Error("Health check failed");
    }

    const coverage = [];
    coverage.push(result.aiConfigured ? "AI review available." : "AI fallback active.");
    coverage.push(result.evmConfigured ? `EVM coverage live on ${result.evmChainLabel}.` : "EVM coverage unavailable.");
    coverage.push(result.solanaConfigured ? `Solana coverage live on ${result.solanaChainLabel}.` : "Solana coverage unavailable.");
    engineStatus.textContent = coverage.join(" ");
  } catch (error) {
    engineStatus.textContent = "Coverage details are temporarily unavailable. Local screening is still ready.";
  }
}

function hasSubmission() {
  return Boolean(input.value.trim() || attachedImageDataUrl);
}

async function analyzeSubmission(event) {
  event.preventDefault();

  if (!hasSubmission()) {
    if (currentMode === "image") {
      screenshotInput.focus();
    } else {
      input.focus();
    }
    return;
  }

  const payload = {
    type: currentMode,
    input: input.value.trim(),
    imageDataUrl: attachedImageDataUrl,
    imageName: attachedImageName
  };

  verdictLabel.textContent = "Analyzing...";
  summaryText.textContent = "Screening the submission and building a proof report.";
  riskScore.textContent = "--";
  confidencePill.textContent = "Working";
  sourcePill.textContent = "In Progress";
  modeSummary.textContent = "Analysis in progress";
  riskMeterFill.style.width = "22%";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Analysis failed");
    }

    renderResult(result);
  } catch (error) {
    verdictLabel.textContent = "Analysis Unavailable";
    summaryText.textContent = error.message || "We could not complete this screening right now.";
    riskScore.textContent = "--";
    confidencePill.textContent = "Retry";
    sourcePill.textContent = "Unavailable";
    modeSummary.textContent = "Analysis failed";
    riskMeterFill.style.width = "0%";
  }
}

async function copySummary() {
  if (!lastSummary) {
    return;
  }

  try {
    await navigator.clipboard.writeText(lastSummary);
    copySummaryButton.textContent = "Copied";
    window.setTimeout(() => {
      copySummaryButton.textContent = "Copy Proof Summary";
    }, 1200);
  } catch (error) {
    copySummaryButton.textContent = "Clipboard blocked";
    window.setTimeout(() => {
      copySummaryButton.textContent = "Copy Proof Summary";
    }, 1200);
  }
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.type));
});

sampleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const sample = samples[button.dataset.sample];
    if (!sample) {
      return;
    }

    setMode(sample.type);
    input.value = sample.input;
  });
});

screenshotInput.addEventListener("change", handleScreenshotChange);
clearImageButton.addEventListener("click", clearAttachedImage);
form.addEventListener("submit", analyzeSubmission);
copySummaryButton.addEventListener("click", copySummary);

setMode(currentMode);
clearAttachedImage();

renderResult({
  verdict: "Needs More Evidence",
  riskScore: "--",
  confidence: 0,
  summary:
    "Run an analysis to turn raw claims into a verdict, a signal breakdown, and recommended next steps.",
  mode: "text",
  generatedAt: null,
  claims: [],
  signals: [],
  evidence: [],
  nextSteps: [],
  analysisSource: "offline",
  sourceLabel: "Engine"
});

loadHealth();
