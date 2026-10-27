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

// Already-public metadata (onchain-toy/metadata-test) for badges A/B/C —
// registering these right after deploy skips the manual admin-panel step
// for the three badges every deployment needs anyway.
const KNOWN_BADGES = [
  { uri: "https://raw.githubusercontent.com/onchain-toy/metadata-test/main/metadata/1.json", transferable: false },
  { uri: "https://raw.githubusercontent.com/onchain-toy/metadata-test/main/metadata/2.json", transferable: false },
  { uri: "https://raw.githubusercontent.com/onchain-toy/metadata-test/main/metadata/3.json", transferable: true },
] as const;

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

  // Only the deployer's own wallet is signing this script - it can only
  // register badge types if it actually holds DEFAULT_ADMIN_ROLE, i.e. no
  // custom BADGE_ADMIN_ADDRESS was set for this deployment.
  if (defaultAdmin.toLowerCase() === deployer.account.address.toLowerCase()) {
    console.log(`\nRegistering known badge types (A/B/C)...`);
    for (const { uri, transferable } of KNOWN_BADGES) {
      const hash = await badge.write.createBadgeType([uri, transferable]);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  registered: ${uri} (transferable=${transferable})`);
    }
  } else {
    console.log(
      `\nSkipping auto-registration of A/B/C: BADGE_ADMIN_ADDRESS differs from the deployer, ` +
        `so this script can't sign as admin. Register them manually from the admin panel instead.`,
    );
  }

  console.log(`\nVerify on Polygonscan:`);
  console.log(
    `  npx hardhat verify --network amoy ${badge.address} ${defaultAdmin} ${pauser} ${minter}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
