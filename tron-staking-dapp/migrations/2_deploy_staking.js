const MockUSDT = artifacts.require("MockUSDT");
const Staking = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");

// USDT-TRC20 mainnet address (Tron mainnet). Used only on `mainnet`.
// 6 decimals.
const USDT_MAINNET = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

// Initial APR in basis points: 12% = 1200
const INITIAL_APR_BPS = 1200;

module.exports = async function (deployer, network) {
  // 1. Resolve the staking token.
  let tokenAddress;
  if (network === "mainnet") {
    tokenAddress = USDT_MAINNET;
    console.log("Using real USDT on mainnet:", tokenAddress);
  } else {
    await deployer.deploy(MockUSDT);
    const mock = await MockUSDT.deployed();
    tokenAddress = mock.address;
    console.log("Deployed MockUSDT at:", tokenAddress);
  }

  // 2. Deploy the implementation (constructor disables initializers — safe).
  await deployer.deploy(Staking);
  const impl = await Staking.deployed();
  console.log("Deployed Staking implementation at:", impl.address);

  // 3. Encode the initializer call: initialize(address,uint256).
  const initData = tronWeb.utils.abi.encodeParamsV2ByABI(
    {
      name: "initialize",
      type: "function",
      inputs: [
        { type: "address", name: "_stakingToken" },
        { type: "uint256", name: "_aprBps" },
      ],
    },
    [tokenAddress, INITIAL_APR_BPS],
  );
  const selector = tronWeb.sha3("initialize(address,uint256)").slice(0, 10);
  const calldata = selector + initData.replace(/^0x/, "");

  // 4. Deploy the ERC1967 proxy pointing at the implementation, with init data.
  await deployer.deploy(StakingProxy, impl.address, calldata);
  const proxy = await StakingProxy.deployed();
  console.log("Deployed StakingProxy at:", proxy.address);
  console.log("");
  console.log("==============================================");
  console.log("FRONTEND CONFIG VALUES");
  console.log("  TOKEN_ADDRESS   :", tokenAddress);
  console.log("  STAKING_ADDRESS :", proxy.address, "  <-- use the PROXY here");
  console.log("  TOKEN_SYMBOL    : USDT");
  console.log("  TOKEN_DECIMALS  : 6");
  console.log("==============================================");
  console.log("");
  console.log("To upgrade later: deploy a new Staking implementation, then call");
  console.log("`upgradeTo(newImpl)` on the proxy address (owner only).");
};
