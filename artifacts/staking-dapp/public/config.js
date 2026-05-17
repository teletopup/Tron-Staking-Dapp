// ---------------------------------------------------------------------------
// USDT Send dApp config
// ---------------------------------------------------------------------------
// TOKEN_ADDRESS is the TRC-20 token contract you want to send. Default is
// USDT on TRON mainnet. For Nile testnet, deploy MockUSDT or use a faucet.
// Addresses use the base58 form (start with "T...").
// ---------------------------------------------------------------------------

window.APP_CONFIG = {
  NETWORK: "mainnet", // "nile" | "mainnet" — defaults to mainnet so USDT balance reads work out of the box
  TRONSCAN_BASE: "https://tronscan.org", // mainnet: https://tronscan.org · nile: https://nile.tronscan.org
  TOKEN_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // USDT-TRC20 mainnet
  TOKEN_SYMBOL: "USDT",
  TOKEN_DECIMALS: 6, // USDT on TRON uses 6 decimals
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
];
