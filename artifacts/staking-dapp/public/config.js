// ---------------------------------------------------------------------------
// USDT Send dApp config — MAINNET ONLY
// ---------------------------------------------------------------------------
// TOKEN_ADDRESS is the TRC-20 token contract you want to send. Defaults to
// real USDT (Tether) on TRON mainnet. Addresses use base58 form ("T...").
// ---------------------------------------------------------------------------

window.APP_CONFIG = {
  NETWORK: "mainnet",
  TRONSCAN_BASE: "https://tronscan.org",
  // Tether USDT on TRON mainnet (TRC-20).
  TOKEN_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  TOKEN_SYMBOL: "USDT",
  TOKEN_DECIMALS: 6,
  REFRESH_INTERVAL_MS: 10_000,
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
