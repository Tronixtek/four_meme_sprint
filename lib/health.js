const { getOpenAIModel, isOpenAIConfigured } = require("./openai-analysis");
const { getEvmChainLabel, getEvmRpcSourceLabel, isEvmRpcReady } = require("./evm-rpc");
const { getSolanaChainLabel, getSolanaRpcSourceLabel, isSolanaRpcReady } = require("./solana-rpc");

function getHealthPayload() {
  return {
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
  };
}

module.exports = {
  getHealthPayload
};
