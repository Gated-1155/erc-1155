import { network } from "hardhat";

// Deploy locally (no real cost) just to measure actual gas used, then price
// that against Amoy's live gas price.
const local = await network.create();
const localPublicClient = await local.viem.getPublicClient();
const [deployer] = await local.viem.getWalletClients();

const { contract: badge, deploymentTransaction } =
  await local.viem.sendDeploymentTransaction("BadgeToken", [
    deployer.account.address,
    deployer.account.address,
    deployer.account.address,
  ]);

const receipt = await localPublicClient.waitForTransactionReceipt({
  hash: deploymentTransaction.hash,
});
const deployGasUsed = receipt.gasUsed;
console.log(`Deployment gas used: ${deployGasUsed}`);

// Also measure one createBadgeType + one mint, since those will follow deploy.
const createTxHash = await badge.write.createBadgeType([
  "ipfs-less://badge-1.json",
  false,
]);
const createReceipt = await localPublicClient.getTransactionReceipt({
  hash: createTxHash,
});
console.log(`createBadgeType gas used: ${createReceipt.gasUsed}`);

const mintTxHash = await badge.write.mint([
  deployer.account.address,
  1n,
  1n,
  "0x",
]);
const mintReceipt = await localPublicClient.getTransactionReceipt({
  hash: mintTxHash,
});
console.log(`mint gas used: ${mintReceipt.gasUsed}`);

// Now price against Amoy's live gas price.
const { viem: amoyViem } = await network.getOrCreate({ network: "amoy" });
const amoyPublicClient = await amoyViem.getPublicClient();
const gasPrice = await amoyPublicClient.getGasPrice();
console.log(`\nAmoy current gas price: ${gasPrice} wei (${Number(gasPrice) / 1e9} gwei)`);

function cost(gas: bigint) {
  const wei = gas * gasPrice;
  return `${wei} wei = ${Number(wei) / 1e18} POL`;
}

console.log(`\nEstimated cost:`);
console.log(`  Deploy           : ${cost(deployGasUsed)}`);
console.log(`  createBadgeType  : ${cost(createReceipt.gasUsed)}`);
console.log(`  mint             : ${cost(mintReceipt.gasUsed)}`);
console.log(
  `  Deploy + 1 create + 1 mint : ${cost(deployGasUsed + createReceipt.gasUsed + mintReceipt.gasUsed)}`,
);
