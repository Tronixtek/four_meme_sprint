const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const DEFAULT_SOLANA_CHAIN_LABEL = "Solana Mainnet";
const DEFAULT_PUBLIC_RPC_CANDIDATES = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com"
];
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isSolanaAddress(value) {
  return typeof value === "string" && SOLANA_ADDRESS_REGEX.test(value.trim());
}

function getSolanaChainLabel() {
  return process.env.SOLANA_CHAIN_LABEL || DEFAULT_SOLANA_CHAIN_LABEL;
}

function getSolanaRpcUrl() {
  return process.env.SOLANA_RPC_URL || DEFAULT_PUBLIC_RPC_CANDIDATES[0];
}

function getSolanaRpcSourceLabel() {
  return process.env.SOLANA_RPC_URL ? "Custom Solana RPC" : "Public Solana RPC fallback pool";
}

function isSolanaRpcReady() {
  return Boolean(process.env.SOLANA_RPC_URL || DEFAULT_PUBLIC_RPC_CANDIDATES.length);
}

function getRpcCandidates() {
  if (process.env.SOLANA_RPC_URL) {
    return [process.env.SOLANA_RPC_URL];
  }

  return DEFAULT_PUBLIC_RPC_CANDIDATES;
}

async function rpcRequest(method, params) {
  const candidates = getRpcCandidates();
  let lastError = new Error("No Solana RPC endpoints configured");

  for (const rpcUrl of candidates) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(`Solana RPC request failed with status ${response.status}`);
      }

      if (payload.error) {
        throw new Error(payload.error.message || `Solana RPC error for ${method}`);
      }

      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function lamportsToSol(lamports) {
  const value = typeof lamports === "number" ? BigInt(lamports) : BigInt(lamports || 0);
  const whole = value / 1000000000n;
  const fraction = value % 1000000000n;
  const fractionString = fraction.toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return fractionString ? `${whole.toString()}.${fractionString} SOL` : `${whole.toString()} SOL`;
}

function percentString(numerator, denominator) {
  if (denominator <= 0n) {
    return null;
  }

  const scaled = (numerator * 1000n) / denominator;
  const whole = scaled / 10n;
  const decimal = scaled % 10n;
  return `${whole.toString()}.${decimal.toString()}%`;
}

async function safeRpc(method, params) {
  try {
    return await rpcRequest(method, params);
  } catch (error) {
    return null;
  }
}

async function fetchTokenMintIntel(address) {
  const tokenSupplyResult = await safeRpc("getTokenSupply", [address, { commitment: "finalized" }]);
  if (!tokenSupplyResult?.value) {
    return null;
  }

  const largestAccounts = await safeRpc("getTokenLargestAccounts", [address, { commitment: "finalized" }]);
  const supplyAmount = BigInt(tokenSupplyResult.value.amount || "0");
  const holders = Array.isArray(largestAccounts?.value) ? largestAccounts.value : [];
  const top1Amount = holders[0]?.amount ? BigInt(holders[0].amount) : 0n;
  const top3Amount = holders.slice(0, 3).reduce((total, holder) => total + BigInt(holder.amount || "0"), 0n);

  return {
    isTokenMint: true,
    decimals: tokenSupplyResult.value.decimals,
    supplyAmount: tokenSupplyResult.value.amount,
    supplyDisplay: tokenSupplyResult.value.uiAmountString || tokenSupplyResult.value.amount,
    topHolderCountSample: holders.length,
    topHolderShare: percentString(top1Amount, supplyAmount),
    top3HolderShare: percentString(top3Amount, supplyAmount)
  };
}

async function lookupSolanaAddress(address) {
  if (!isSolanaAddress(address)) {
    throw new Error("Invalid Solana address");
  }

  const [accountInfo, balanceInfo, signatures, slot] = await Promise.all([
    rpcRequest("getAccountInfo", [address, { commitment: "finalized", encoding: "base64" }]),
    rpcRequest("getBalance", [address, { commitment: "finalized" }]),
    rpcRequest("getSignaturesForAddress", [address, { commitment: "finalized", limit: 20 }]),
    rpcRequest("getSlot", [{ commitment: "finalized" }])
  ]);

  const value = accountInfo?.value;
  if (!value) {
    throw new Error("Account does not exist on the observed Solana RPC");
  }

  const recentSignatures = Array.isArray(signatures) ? signatures : [];
  const tokenMint = await fetchTokenMintIntel(address);

  return {
    address,
    chainLabel: getSolanaChainLabel(),
    rpcSource: getSolanaRpcSourceLabel(),
    slot: typeof slot === "number" ? slot : 0,
    lamports: value.lamports,
    balanceDisplay: lamportsToSol(balanceInfo?.value ?? value.lamports ?? 0),
    owner: value.owner,
    executable: Boolean(value.executable),
    space: value.space ?? 0,
    recentSignatureCount: recentSignatures.length,
    recentSuccessCount: recentSignatures.filter((item) => item && item.err === null).length,
    tokenMint,
    isSystemOwned: value.owner === SYSTEM_PROGRAM,
    isTokenProgramOwned: value.owner === TOKEN_PROGRAM || value.owner === TOKEN_2022_PROGRAM
  };
}

module.exports = {
  getSolanaChainLabel,
  getSolanaRpcSourceLabel,
  getSolanaRpcUrl,
  isSolanaAddress,
  isSolanaRpcReady,
  lookupSolanaAddress
};
