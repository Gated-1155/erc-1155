import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-viem-assertions/predicates";

describe("BadgeToken", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployBadgeToken() {
    const [admin, pauser, minter, alice, bob, operator] =
      await viem.getWalletClients();

    const badge = await viem.deployContract("BadgeToken", [
      admin.account.address,
      pauser.account.address,
      minter.account.address,
    ]);

    return { badge, admin, pauser, minter, alice, bob, operator };
  }

  // Convenience: register one badge type and (optionally) mint it to `to`.
  async function createBadgeType(
    badge: Awaited<ReturnType<typeof deployBadgeToken>>["badge"],
    admin: Awaited<ReturnType<typeof deployBadgeToken>>["admin"],
    uri: string,
    transferable: boolean,
  ) {
    await badge.write.createBadgeType([uri, transferable], {
      account: admin.account,
    });
  }

  describe("Badge ID sequencing (createBadgeType)", async function () {
    it("issues sequential ids starting at 1", async function () {
      const { badge, admin } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );

      await viem.assertions.emitWithArgs(
        badge.write.createBadgeType(["ipfs-less://badge-1.json", false], {
          account: admin.account,
        }),
        badge,
        "BadgeTypeCreated",
        [1n, "ipfs-less://badge-1.json", false],
      );

      await viem.assertions.emitWithArgs(
        badge.write.createBadgeType(["ipfs-less://badge-2.json", true], {
          account: admin.account,
        }),
        badge,
        "BadgeTypeCreated",
        [2n, "ipfs-less://badge-2.json", true],
      );

      assert.equal(await badge.read.isTransferable([1n]), false);
      assert.equal(await badge.read.isTransferable([2n]), true);
    });

    it("rejects createBadgeType from a non-admin account", async function () {
      const { badge, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.createBadgeType(["x", false], {
          account: alice.account,
        }),
        badge,
        "AccessControlUnauthorizedAccount",
        [alice.account.address, anyValue],
      );
    });
  });

  describe("Metadata URI", async function () {
    it("returns the per-id URI registered at creation", async function () {
      const { badge, admin } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", false);

      assert.equal(await badge.read.uri([1n]), "ipfs-less://badge-1.json");
    });

    it("reverts for an unregistered id", async function () {
      const { badge } = await networkHelpers.loadFixture(deployBadgeToken);

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.read.uri([1n]),
        badge,
        "BadgeTypeDoesNotExist",
        [1n],
      );
    });
  });

  describe("Minting", async function () {
    it("mints a registered badge id to a recipient", async function () {
      const { badge, admin, minter, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", false);

      await badge.write.mint([alice.account.address, 1n, 3n, "0x"], {
        account: minter.account,
      });

      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        3n,
      );
    });

    it("rejects minting an unregistered badge id", async function () {
      const { badge, minter, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
          account: minter.account,
        }),
        badge,
        "BadgeTypeDoesNotExist",
        [1n],
      );
    });

    it("rejects minting from a non-minter account", async function () {
      const { badge, admin, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", false);

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
          account: alice.account,
        }),
        badge,
        "AccessControlUnauthorizedAccount",
        [alice.account.address, anyValue],
      );
    });
  });

  describe("Transfer blocking (core requirement)", async function () {
    it("blocks a direct safeTransferFrom on a non-transferable badge", async function () {
      const { badge, admin, minter, alice, bob } =
        await networkHelpers.loadFixture(deployBadgeToken);
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", false);
      await badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
        account: minter.account,
      });

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.safeTransferFrom(
          [alice.account.address, bob.account.address, 1n, 1n, "0x"],
          { account: alice.account },
        ),
        badge,
        "BadgeNotTransferable",
        [1n],
      );

      // balance must be unchanged after the revert
      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        1n,
      );
    });

    it("allows safeTransferFrom on a transferable badge", async function () {
      const { badge, admin, minter, alice, bob } =
        await networkHelpers.loadFixture(deployBadgeToken);
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", true);
      await badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
        account: minter.account,
      });

      await badge.write.safeTransferFrom(
        [alice.account.address, bob.account.address, 1n, 1n, "0x"],
        { account: alice.account },
      );

      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        0n,
      );
      assert.equal(await badge.read.balanceOf([bob.account.address, 1n]), 1n);
    });

    it("blocks safeBatchTransferFrom entirely if any single id in the batch is non-transferable", async function () {
      const { badge, admin, minter, alice, bob } =
        await networkHelpers.loadFixture(deployBadgeToken);
      // id 1: transferable, id 2: non-transferable
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", true);
      await createBadgeType(badge, admin, "ipfs-less://badge-2.json", false);
      await badge.write.mintBatch(
        [alice.account.address, [1n, 2n], [1n, 1n], "0x"],
        { account: minter.account },
      );

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.safeBatchTransferFrom(
          [alice.account.address, bob.account.address, [1n, 2n], [1n, 1n], "0x"],
          { account: alice.account },
        ),
        badge,
        "BadgeNotTransferable",
        [2n],
      );

      // neither id moved — the whole batch reverted atomically
      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        1n,
      );
      assert.equal(
        await badge.read.balanceOf([alice.account.address, 2n]),
        1n,
      );
      assert.equal(await badge.read.balanceOf([bob.account.address, 1n]), 0n);
    });

    it("blocks setApprovalForAll entirely, so no operator can ever be approved", async function () {
      const { badge, alice, bob, operator } = await networkHelpers.loadFixture(deployBadgeToken);

      await viem.assertions.revertWithCustomError(
        badge.write.setApprovalForAll([operator.account.address, true], {
          account: alice.account,
        }),
        badge,
        "ApprovalNotAllowed",
      );

      assert.equal(
        await badge.read.isApprovedForAll([
          alice.account.address,
          operator.account.address,
        ]),
        false,
      );

      // with no approval ever possible, a would-be operator transfer falls
      // back to the standard ERC1155 "missing approval" error — it never even
      // reaches our BadgeNotTransferable check.
      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.safeTransferFrom(
          [alice.account.address, bob.account.address, 1n, 1n, "0x"],
          { account: operator.account },
        ),
        badge,
        "ERC1155MissingApprovalForAll",
        [operator.account.address, alice.account.address],
      );
    });

    it("reflects a setTransferable toggle on the very next transfer attempt", async function () {
      const { badge, admin, minter, alice, bob } =
        await networkHelpers.loadFixture(deployBadgeToken);
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", false);
      await badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
        account: minter.account,
      });

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.safeTransferFrom(
          [alice.account.address, bob.account.address, 1n, 1n, "0x"],
          { account: alice.account },
        ),
        badge,
        "BadgeNotTransferable",
        [1n],
      );

      await viem.assertions.emitWithArgs(
        badge.write.setTransferable([1n, true], { account: admin.account }),
        badge,
        "BadgeTransferabilityUpdated",
        [1n, true],
      );

      await badge.write.safeTransferFrom(
        [alice.account.address, bob.account.address, 1n, 1n, "0x"],
        { account: alice.account },
      );

      assert.equal(await badge.read.balanceOf([bob.account.address, 1n]), 1n);
    });
  });

  describe("Mint / burn bypass the transferable check", async function () {
    it("mints a non-transferable badge without reverting", async function () {
      const { badge, admin, minter, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", false);

      await badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
        account: minter.account,
      });

      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        1n,
      );
    });

    it("lets the holder burn their own non-transferable badge", async function () {
      const { badge, admin, minter, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", false);
      await badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
        account: minter.account,
      });

      await badge.write.burn([alice.account.address, 1n, 1n], {
        account: alice.account,
      });

      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        0n,
      );
    });
  });

  describe("Pause", async function () {
    it("blocks minting while paused, and only PAUSER_ROLE can pause", async function () {
      const { badge, admin, pauser, minter, alice } =
        await networkHelpers.loadFixture(deployBadgeToken);
      await createBadgeType(badge, admin, "ipfs-less://badge-1.json", false);

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.pause({ account: admin.account }),
        badge,
        "AccessControlUnauthorizedAccount",
        [admin.account.address, anyValue],
      );

      await badge.write.pause({ account: pauser.account });

      await viem.assertions.revertWithCustomError(
        badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
          account: minter.account,
        }),
        badge,
        "EnforcedPause",
      );

      await badge.write.unpause({ account: pauser.account });

      await badge.write.mint([alice.account.address, 1n, 1n, "0x"], {
        account: minter.account,
      });
      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        1n,
      );
    });
  });
});
