import { network } from "hardhat";

// BADGE_ADMIN_ADDRESS / BADGE_PAUSER_ADDRESS / BADGE_MINTER_ADDRESS are optional —
// unset ones default to the deployer's own address, since this project has no
// backend/relayer: the admin's own wallet signs mint/pause/admin txs directly.
function envAddressOrDefault(name: string, fallback: `0x${string}`): `0x${string}` {
  const value = process.env[name];
  if (!value) return fallback;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} is set but is not a valid address: ${value}`);
  }
  return value as `0x${string}`;
}

async function main() {
  const { viem } = await network.getOrCreate({ network: "amoy" });
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();

  const defaultAdmin = envAddressOrDefault("BADGE_ADMIN_ADDRESS", deployer.account.address);
  const pauser = envAddressOrDefault("BADGE_PAUSER_ADDRESS", deployer.account.address);
  const minter = envAddressOrDefault("BADGE_MINTER_ADDRESS", deployer.account.address);

  const chainId = await publicClient.getChainId();
  const balance = await publicClient.getBalance({address: deployer.account.address});

  console.log(`Chain ID     : ${chainId}`);
  console.log(`Deployer     : ${deployer.account.address}`);
  console.log(`Balance      : ${Number(balance) / 1e18} POL`);
  console.log(`Admin        : ${defaultAdmin}`);
  console.log(`Pauser       : ${pauser}`);
  console.log(`Minter       : ${minter}`);

  const badge = await viem.deployContract("BadgeToken", [
    defaultAdmin,
    pauser,
    minter,
  ]);

  console.log(`\nBadgeToken deployed -> ${badge.address}`);
  console.log(`\nVerify on Polygonscan:`);
  console.log(
    `  npx hardhat verify --network amoy ${badge.address} ${defaultAdmin} ${pauser} ${minter}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
