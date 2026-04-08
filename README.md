# Proof of Meme

Proof of Meme is an MVP for a trust-screening product aimed at Web3 communities, token launches, meme ecosystems, and internet-native rumor cycles.

## What it does

- Accepts rumor text, URLs, wallet addresses, and contract addresses
- Produces a verdict, risk score, confidence estimate, and structured evidence trail
- Generates a shareable proof-style result that is easy to paste into community workflows

## Why this is a strong hackathon direction

- Uncommon product angle compared with standard chatbots and meme generators
- Immediate value for communities dealing with scams, fake announcements, and impersonation
- Clear path to deeper AI and on-chain integrations without changing the UX

## Current MVP scope

- Local Node server with a JSON analysis endpoint at `/api/analyze`
- Static frontend with a polished demo interface
- Offline heuristic analysis for text, links, and EVM-style addresses
- Optional OpenAI-backed screenshot and multimodal analysis when `OPENAI_API_KEY` is set
- Live EVM address checks over JSON-RPC for contract detection, balance, tx count, and token metadata
- Live Solana address checks for program/account detection, recent signature activity, and token mint signals

## Next integrations

1. Add OpenAI Vision to extract claims from screenshots and social posts.
2. Add live chain reads for deployer history, holder concentration, and liquidity signals.
3. Add source verification against official sites, docs, and social accounts.
4. Add proof report export for Telegram, Discord, and X.

## Run locally

```bash
npm start
```

Then open `http://localhost:3000`.

## Deploy on Vercel

This repo is now Vercel-ready:

- Static files are served from [`public`](./public)
- Vercel Functions live in [`api`](./api)
- [`vercel.json`](./vercel.json) points the output directory at `public`

Recommended setup in Vercel:

1. Import the GitHub repository.
2. Set the Framework Preset to `Other`.
3. Leave the build command empty.
4. Confirm the output directory is `public`.
5. Add the environment variables listed below in the Vercel dashboard.

The local `server.js` is still useful for development, but Vercel deploys the file-based functions under `/api/*`.

## Enable AI analysis

Set environment variables before running the app:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.4-mini
EVM_RPC_URL=https://eth.llamarpc.com
EVM_CHAIN_LABEL=Ethereum Mainnet
SOLANA_RPC_URL=https://solana-rpc.publicnode.com
SOLANA_CHAIN_LABEL=Solana Mainnet
```

You can also create a local `.env.local` file at the repo root. The server now loads `.env` and `.env.local` automatically, and both are git-ignored.
