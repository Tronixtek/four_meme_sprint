const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const ERC20_SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd"
};
const DEFAULT_EVM_CHAIN_LABEL = "Ethereum Mainnet";
const DEFAULT_PUBLIC_RPC_CANDIDATES = [
  "https://ethereum.publicnode.com",
  "https://cloudflare-eth.com",
  "https://eth.llamarpc.com"
];

function isEvmAddress(value) {
  return typeof value === "string" && ADDRESS_REGEX.test(value.trim());
}

function getEvmChainLabel() {
  return process.env.EVM_CHAIN_LABEL || DEFAULT_EVM_CHAIN_LABEL;
}

function getEvmRpcUrl() {
  return process.env.EVM_RPC_URL || DEFAULT_PUBLIC_RPC_CANDIDATES[0];
}

function getEvmRpcSourceLabel() {
  return process.env.EVM_RPC_URL ? "Custom RPC" : "Public RPC fallback pool";
}

function isEvmRpcReady() {
  return Boolean(process.env.EVM_RPC_URL || DEFAULT_PUBLIC_RPC_CANDIDATES.length);
}

function getRpcCandidates() {
  if (process.env.EVM_RPC_URL) {
    return [process.env.EVM_RPC_URL];
  }

  return DEFAULT_PUBLIC_RPC_CANDIDATES;
}

async function rpcRequest(method, params) {
  const candidates = getRpcCandidates();
  let lastError = new Error("No RPC endpoints configured");

  for (const rpcUrl of candidates) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method,
          params
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(`RPC request failed with status ${response.status}`);
      }

      if (payload.error) {
        throw new Error(payload.error.message || `RPC error for ${method}`);
      }

      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function hexToBigInt(value) {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return 0n;
  }

  return BigInt(value);
}

function formatEth(wei) {
  const negative = wei < 0n;
  const absolute = negative ? -wei : wei;
  const whole = absolute / 1000000000000000000n;
  const fraction = absolute % 1000000000000000000n;
  const fractionString = fraction.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  const formatted = fractionString ? `${whole.toString()}.${fractionString}` : whole.toString();
  return `${negative ? "-" : ""}${formatted} ETH`;
}

function decodeBytes32Ascii(hex) {
  const value = hex.replace(/^0x/, "");
  if (value.length !== 64) {
    return null;
  }

  let output = "";
  for (let index = 0; index < value.length; index += 2) {
    const byte = parseInt(value.slice(index, index + 2), 16);
    if (!byte) {
      continue;
    }

    if (byte < 32 || byte > 126) {
      return null;
    }

    output += String.fromCharCode(byte);
  }

  return output.trim() || null;
}

function decodeAbiString(hex) {
  if (typeof hex !== "string" || hex === "0x") {
    return null;
  }

  const raw = hex.replace(/^0x/, "");
  const bytes32 = decodeBytes32Ascii(hex);
  if (bytes32) {
    return bytes32;
  }

  if (raw.length < 128) {
    return null;
  }

  const offset = Number.parseInt(raw.slice(0, 64), 16);
  const lengthIndex = offset * 2;
  const lengthHex = raw.slice(lengthIndex, lengthIndex + 64);
  if (!lengthHex) {
    return null;
  }

  const textLength = Number.parseInt(lengthHex, 16);
  if (!Number.isFinite(textLength) || textLength <= 0) {
    return null;
  }

  const textStart = lengthIndex + 64;
  const textHex = raw.slice(textStart, textStart + textLength * 2);
  if (!textHex) {
    return null;
  }

  let output = "";
  for (let index = 0; index < textHex.length; index += 2) {
    const byte = parseInt(textHex.slice(index, index + 2), 16);
    if (byte >= 32 && byte <= 126) {
      output += String.fromCharCode(byte);
    }
  }

  return output.trim() || null;
}

function decodeUint(hex) {
  if (typeof hex !== "string" || hex === "0x") {
    return null;
  }

  try {
    return BigInt(hex);
  } catch (error) {
    return null;
  }
}

async function safeEthCall(address, data) {
  try {
    const result = await rpcRequest("eth_call", [{ to: address, data }, "latest"]);
    return result;
  } catch (error) {
    return null;
  }
}

function formatTokenSupply(totalSupply, decimals) {
  if (typeof totalSupply !== "bigint") {
    return null;
  }

  const decimalsValue = typeof decimals === "number" ? decimals : 0;
  const divisor = 10n ** BigInt(Math.max(0, decimalsValue));
  const whole = divisor === 0n ? totalSupply : totalSupply / divisor;
  const fraction = divisor === 0n ? 0n : totalSupply % divisor;
  const precision = Math.min(decimalsValue, 4);
  const fractionString = precision
    ? fraction
        .toString()
        .padStart(decimalsValue, "0")
        .slice(0, precision)
        .replace(/0+$/, "")
    : "";
  return fractionString ? `${whole.toString()}.${fractionString}` : whole.toString();
}

async function fetchTokenMetadata(address) {
  const [nameHex, symbolHex, decimalsHex, totalSupplyHex] = await Promise.all([
    safeEthCall(address, ERC20_SELECTORS.name),
    safeEthCall(address, ERC20_SELECTORS.symbol),
    safeEthCall(address, ERC20_SELECTORS.decimals),
    safeEthCall(address, ERC20_SELECTORS.totalSupply)
  ]);

  const name = decodeAbiString(nameHex);
  const symbol = decodeAbiString(symbolHex);
  const decimalsRaw = decodeUint(decimalsHex);
  const totalSupplyRaw = decodeUint(totalSupplyHex);
  const decimals = decimalsRaw !== null ? Number(decimalsRaw) : null;
  const totalSupply = totalSupplyRaw !== null ? formatTokenSupply(totalSupplyRaw, decimals ?? 0) : null;

  return {
    isTokenLike: Boolean(symbol || name || decimals !== null || totalSupply !== null),
    name,
    symbol,
    decimals,
    totalSupply
  };
}

async function lookupEvmAddress(address) {
  if (!isEvmAddress(address)) {
    throw new Error("Invalid EVM address");
  }

  const [blockNumberHex, code, balanceHex, transactionCountHex] = await Promise.all([
    rpcRequest("eth_blockNumber", []),
    rpcRequest("eth_getCode", [address, "latest"]),
    rpcRequest("eth_getBalance", [address, "latest"]),
    rpcRequest("eth_getTransactionCount", [address, "latest"])
  ]);

  const isContract = typeof code === "string" && code !== "0x";
  const codeBytes = isContract ? (code.length - 2) / 2 : 0;
  const balanceWei = hexToBigInt(balanceHex);
  const transactionCount = Number(hexToBigInt(transactionCountHex));
  const blockNumber = Number(hexToBigInt(blockNumberHex));
  const token = isContract ? await fetchTokenMetadata(address) : null;

  return {
    address,
    chainLabel: getEvmChainLabel(),
    rpcSource: getEvmRpcSourceLabel(),
    blockNumber,
    isContract,
    codeBytes,
    balanceWei,
    balanceDisplay: formatEth(balanceWei),
    transactionCount,
    token
  };
}

module.exports = {
  getEvmChainLabel,
  getEvmRpcSourceLabel,
  getEvmRpcUrl,
  isEvmAddress,
  isEvmRpcReady,
  lookupEvmAddress
};
