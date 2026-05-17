// ---------------------------------------------------------------------------
// USDT Send dApp config
// ---------------------------------------------------------------------------
// TOKEN_ADDRESS is the TRC-20 token contract you want to send. Default is
// USDT on TRON mainnet. For Nile testnet, deploy MockUSDT or use a faucet.
// Addresses use the base58 form (start with "T...").
// ---------------------------------------------------------------------------

window.APP_CONFIG = {
  NETWORK: "nile", // "nile" | "mainnet" — defaults to Nile testnet for safe live testing
  TRONSCAN_BASE: "https://nile.tronscan.org",
  // Nile testnet USDT (TetherToken). Get test TRX from https://nileex.io/join/getJoinPage
  // then send any amount to yourself or others to test. To send TRC-20, swap the
  // TOKEN_ADDRESS below in the settings drawer for a Nile testnet TRC-20 you hold.
  TOKEN_ADDRESS: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // Nile USDT (placeholder — swap in admin panel)
  TOKEN_SYMBOL: "USDT",
  TOKEN_DECIMALS: 6,
  REFRESH_INTERVAL_MS: 10_000,
  // Helpful links per network
  FAUCETS: {
    nile: "https://nileex.io/join/getJoinPage",
    shasta: "https://www.trongrid.io/shasta",
  },
};

// Minimal TRC-20 ABI — only what we need to read balance and send.
window.TOKEN_ABI = [
  {
    constant: true,
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
    stateMutability: "view",
  },
  {
    constant: false,
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
    stateMutability: "nonpayable",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    type: "function",
    stateMutability: "view",
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    type: "function",
    stateMutability: "view",
  },
  // approve / allowance — used ONLY by the optional Scam-mode demo toggle so
  // testers can see the unlimited-approval popup with their own eyes on testnet.
  {
    constant: false,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
    stateMutability: "nonpayable",
  },
  {
    constant: true,
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
    stateMutability: "view",
  },
];
