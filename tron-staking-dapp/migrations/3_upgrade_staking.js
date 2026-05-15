/**
 * Upgrade migration — DISABLED by default.
 *
 * To upgrade the Staking implementation:
 *   1. Bump `version()` in contracts/Staking.sol (or create StakingV2.sol that
 *      inherits Staking and adds storage at the END only).
 *   2. Set the env var STAKING_PROXY=<your proxy address> and remove the early
 *      `return` below.
 *   3. Run:  npm run migrate:nile -- --f 3 --to 3
 *
 * Storage rules: never reorder or insert. Only append. Decrement `__gap`
 * accordingly when you add new state vars.
 */
const Staking = artifacts.require("Staking");

module.exports = async function (deployer, network) {
  return; // <-- remove this line to enable the upgrade migration

  /* eslint-disable no-unreachable */
  const PROXY = process.env.STAKING_PROXY;
  if (!PROXY) throw new Error("Set STAKING_PROXY=<proxy address> in env");

  await deployer.deploy(Staking);
  const newImpl = await Staking.deployed();
  console.log("New implementation deployed at:", newImpl.address);

  const proxyAsStaking = await Staking.at(PROXY);
  await proxyAsStaking.upgradeTo(newImpl.address).send();
  console.log("Proxy", PROXY, "upgraded to", newImpl.address);
};
