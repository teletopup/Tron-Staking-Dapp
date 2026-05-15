require("dotenv").config();

const PK_NILE = process.env.PRIVATE_KEY_NILE || "";
const PK_MAINNET = process.env.PRIVATE_KEY_MAINNET || "";

module.exports = {
  networks: {
    mainnet: {
      privateKey: PK_MAINNET,
      userFeePercentage: 100,
      feeLimit: 1_000_000_000,
      fullHost: "https://api.trongrid.io",
      network_id: "1",
    },
    nile: {
      privateKey: PK_NILE,
      userFeePercentage: 100,
      feeLimit: 1_000_000_000,
      fullHost: "https://api.nileex.io",
      network_id: "3",
    },
    development: {
      privateKey:
        "0000000000000000000000000000000000000000000000000000000000000001",
      userFeePercentage: 0,
      feeLimit: 1_000_000_000,
      fullHost: "http://127.0.0.1:9090",
      network_id: "9",
    },
    compilers: {
      solc: {
        version: "0.8.18",
      },
    },
  },
  compilers: {
    solc: {
      version: "0.8.18",
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "istanbul",
      },
    },
  },
};
