const MockJST = artifacts.require("MockJST");
const Staking = artifacts.require("Staking");

// JST mainnet TRC-20 address (Tron mainnet). Used only on `mainnet`.
const JST_MAINNET = "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9";

// Initial APR in basis points: 12% = 1200
const INITIAL_APR_BPS = 1200;

module.exports = async function (deployer, network) {
  let tokenAddress;

  if (network === "mainnet") {
    tokenAddress = JST_MAINNET;
    console.log("Using real JST on mainnet:", tokenAddress);
  } else {
    await deployer.deploy(MockJST);
    const mock = await MockJST.deployed();
    tokenAddress = mock.address;
    console.log("Deployed MockJST at:", tokenAddress);
  }

  await deployer.deploy(Staking, tokenAddress, INITIAL_APR_BPS);
  const staking = await Staking.deployed();
  console.log("Deployed Staking at:", staking.address);
  console.log("  staking token:", tokenAddress);
  console.log("  APR (bps):    ", INITIAL_APR_BPS);
};
