import { network } from "hardhat";

const { viem } = await network.getOrCreate({ network: 'amoy' });

const client = await viem.getPublicClient();
const chain_id = await client.getChainId();
const block_number = await client.getBlockNumber();
console.log(chain_id)
console.log(block_number)