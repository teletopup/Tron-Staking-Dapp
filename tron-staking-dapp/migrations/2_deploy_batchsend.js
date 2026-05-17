const BatchSend = artifacts.require("BatchSend");

module.exports = async function (deployer, network) {
  await deployer.deploy(BatchSend);
  const batch = await BatchSend.deployed();

  console.log("");
  console.log("==============================================");
  console.log("BatchSend deployed at:", batch.address);
  console.log("Network:", network);
  console.log("==============================================");
  console.log("");
  console.log("Users who want to batch-send a TRC-20 token through this");
  console.log("contract must first approve it for the total amount, then");
  console.log("call batchTransfer(token, recipients[], amounts[]).");
  console.log("");
  console.log("NOTE: The simple USDT Send dApp doesn't require this contract.");
  console.log("It only matters if you want batch/airdrop functionality.");
  console.log("");
};
