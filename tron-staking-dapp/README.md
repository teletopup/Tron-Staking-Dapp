# USDT Send dApp (TRON)

A simple, user-friendly TRON dApp for sending **USDT-TRC20** (and any other
TRC-20 token) — designed to feel like TronLink. The dApp itself doesn't need
a custom smart contract: it calls the token's built-in `transfer` function
directly from the user's wallet.

An optional **BatchSend** helper contract is included for sending the same
token to many recipients in a single transaction (airdrops, payroll, etc.).
It is intentionally minimal — no owner, no admin, no upgrade, no backdoors.

- **Smart contracts:** Solidity 0.8.18
- **Deployment:** TronBox (Nile testnet + Mainnet)
- **Frontend:** Vanilla HTML / CSS / JS using TronWeb + TronLink

> ⚠️ This software is provided **as-is** with no warranty. Audit before
> mainnet use.

---

## Project layout

```
tron-staking-dapp/
├── contracts/
│   ├── BatchSend.sol         # Optional: send TRC-20 to many recipients in 1 tx
│   ├── RedFlagExamples.sol   # Teaching file: scam patterns in helper contracts
│   └── Migrations.sol        # TronBox migration tracker
├── migrations/
│   ├── 1_initial_migration.js
│   └── 2_deploy_batchsend.js
├── frontend/
│   ├── index.html            # TronLink-style UI
│   ├── style.css
│   ├── app.js                # send flow, validation, recent recipients
│   └── config.js             # token address / network defaults
└── tronbox.js
```

## Contracts

### BatchSend.sol — the only contract you might want to deploy

A "boring on purpose" helper for batch transfers:

- `batchTransfer(token, recipients[], amounts[])` — send different amounts.
- `batchTransferSameAmount(token, recipients[], amount)` — send equal amounts.

Caller approves BatchSend for the total amount first, then calls the function.
Compatible with non-standard return tokens like USDT-TRC20.

**The plain Send dApp does NOT need this contract.** It only matters if you
want batch/airdrop functionality.

### RedFlagExamples.sol — DO NOT DEPLOY

Teaching file showing what a malicious version of BatchSend looks like.
Demonstrates the 4 classic owner-backdoor patterns scammers use in any
contract that asks users to approve a token:

1. `emergencyWithdraw` — single-button victim drain
2. `execute` — arbitrary call, drains anything
3. `setSpender` — approval laundering through a burner wallet
4. `rescueTokens` — fake "safety feature" that rugs everything

Plus a `SafeRescueExample` showing the protected-token pattern done right.

## Frontend

Pure HTML/CSS/JS. Connects to TronLink, displays USDT balance, validates
recipient addresses live, supports percentage chips, remembers recent
recipients, and shows a clean in-app confirmation modal before sending.

An "Admin / Settings" panel at the bottom lets you change the token
address, network, and ABI at runtime (saved in `localStorage`).

## Commands

```bash
# Compile contracts
npx tronbox compile

# Deploy BatchSend to Nile testnet (only if you want the helper)
npx tronbox migrate --network nile

# Deploy to mainnet
npx tronbox migrate --network mainnet
```

## Frontend config

Edit `frontend/config.js` to change the default token / network for all
users. Individual users can override these at runtime via the Settings
panel without redeploying.
