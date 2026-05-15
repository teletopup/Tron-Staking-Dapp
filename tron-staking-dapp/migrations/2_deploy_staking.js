const MockJST = artifacts.require("MockJST");
const Staking = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");

// JST mainnet TRC-20 address (Tron mainnet). Used only on `mainnet`.
const JST_MAINNET = "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9";

// Initial APR in basis points: 12% = 1200
const INITIAL_APR_BPS = 1200;

module.exports = async function (deployer, network) {
  // 1. Resolve the staking token.
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

  // 2. Deploy the implementation (constructor disables initializers — safe).
  await deployer.deploy(Staking);
  const impl = await Staking.deployed();
  console.log("Deployed Staking implementation at:", impl.address);

  // 3. Encode the initializer call: initialize(address,uint256).
  //    TronWeb is exposed as `tronWeb` inside the migration runtime.
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
  // Prepend the function selector for `initialize(address,uint256)`.
  const selector = tronWeb.sha3("initialize(address,uint256)").slice(0, 10); // "0x" + 8 hex
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
  console.log("==============================================");
  console.log("");
  console.log("To upgrade later: deploy a new Staking implementation, then call");
  console.log("`upgradeTo(newImpl)` on the proxy address (owner only).");
};
