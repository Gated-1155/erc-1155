import { network } from "hardhat";

const { viem } = await network.getOrCreate({ network: "amoy" });
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

console.log("Deployer:", deployer.account.address);
const balance = await publicClient.getBalance({ address: deployer.account.address });
console.log("Balance (wei):", balance.toString());
console.log("Balance (POL):", Number(balance) / 1e18);
