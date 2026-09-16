import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

// These tests reproduce specific "this is how it breaks" scenarios for the
// 실패 시나리오 문서, as opposed to BadgeToken.ts which verifies the intended
// behavior (전송 경로 조사 문서). Each `it()` here maps to one documented
// scenario — keep that 1:1 correspondence when adding more.
describe("BadgeToken failure scenarios", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployBadgeToken() {
    const [admin, pauser, minter, alice, bob] = await viem.getWalletClients();

    const badge = await viem.deployContract("BadgeToken", [
      admin.account.address,
      pauser.account.address,
      minter.account.address,
    ]);

    return { badge, admin, pauser, minter, alice, bob };
  }

  describe("Scenario: sole admin renounces DEFAULT_ADMIN_ROLE", async function () {
    it("permanently locks out badge-type management and role administration", async function () {
      const { badge, admin } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );

      const DEFAULT_ADMIN_ROLE = await badge.read.DEFAULT_ADMIN_ROLE();
      assert.equal(
        await badge.read.hasRole([DEFAULT_ADMIN_ROLE, admin.account.address]), true,
      );

      // admin renounces its own admin role — a single fat-fingered tx, or a
      // malicious dApp tricking the admin into signing it.
      await badge.write.renounceRole(
        [DEFAULT_ADMIN_ROLE, admin.account.address],
        { account: admin.account },
      );

      assert.equal(
        await badge.read.hasRole([DEFAULT_ADMIN_ROLE, admin.account.address]),
        false,
      );

      // From this point on, nobody — not even the original admin — can ever
      // register a new badge type, toggle transferable, or grant DEFAULT_ADMIN_ROLE
      // to anyone (DEFAULT_ADMIN_ROLE is its own role admin, and there is no
      // multisig/timelock holding a backup). The contract is not upgradeable
      // (UUPS is explicitly out of scope), so this is permanent for this
      // deployment.
      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.createBadgeType(["ipfs-less://badge-1.json", false], {
          account: admin.account,
        }),
        badge,
        "AccessControlUnauthorizedAccount",
        [admin.account.address, DEFAULT_ADMIN_ROLE],
      );

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.grantRole([DEFAULT_ADMIN_ROLE, admin.account.address], {
          account: admin.account,
        }),
        badge,
        "AccessControlUnauthorizedAccount",
        [admin.account.address, DEFAULT_ADMIN_ROLE],
      );
    });
  });

  describe("Scenario: mintBatch called with malformed input", async function () {
    it("reverts the whole call when ids/amounts array lengths don't match", async function () {
      const { badge, admin, minter, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await badge.write.createBadgeType(["ipfs-less://badge-1.json", false], {
        account: admin.account,
      });

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.mintBatch(
          [alice.account.address, [1n], [1n, 2n], "0x"],
          { account: minter.account },
        ),
        badge,
        "ERC1155InvalidArrayLength",
        [1n, 2n],
      );
    });

    it("reverts the whole batch (mints nothing) when one id among several was never registered", async function () {
      const { badge, admin, minter, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await badge.write.createBadgeType(["ipfs-less://badge-1.json", false], {
        account: admin.account,
      });
      // id 2 is intentionally never registered.

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.mintBatch(
          [alice.account.address, [1n, 2n], [5n, 5n], "0x"],
          { account: minter.account },
        ),
        badge,
        "BadgeTypeDoesNotExist",
        [2n],
      );

      // id 1 must not have been minted either — no partial batch.
      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        0n,
      );
    });
  });

  describe("Fixed: uri() and isTransferable() now agree on how to report an unregistered id", async function () {
    it("both revert with BadgeTypeDoesNotExist for the same unregistered id", async function () {
      // Previously isTransferable() silently returned `false` for an
      // unregistered id instead of reverting like uri() does, so a caller
      // couldn't tell "registered and non-transferable" apart from "never
      // registered" without also calling uri(). Fixed 2026-09-14.
      const { badge } = await networkHelpers.loadFixture(deployBadgeToken);

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.read.uri([99n]),
        badge,
        "BadgeTypeDoesNotExist",
        [99n],
      );

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.read.isTransferable([99n]),
        badge,
        "BadgeTypeDoesNotExist",
        [99n],
      );
    });
  });

  describe("Scenario: malicious ERC-1155 receiver reenters during onERC1155Received", async function () {
    it("cannot double-spend or observe a stale balance, because _update commits state before the hook fires", async function () {
      const { badge, admin, minter, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await badge.write.createBadgeType(["ipfs-less://badge-1.json", true], {
        account: admin.account,
      });

      const attacker = await viem.deployContract("MaliciousReceiver");
      await badge.write.mint([alice.account.address, 1n, 5n, "0x"], {
        account: minter.account,
      });

      await attacker.write.configure([
        badge.address,
        alice.account.address, // reentryTo: bounce the badge straight back to alice
        1n,
        5n,
        true, // attackOnReceive
      ]);

      // alice transfers all 5 units to the attacker contract. Its
      // onERC1155Received hook fires and immediately tries to transfer them
      // straight back out, from inside the same call stack.
      await badge.write.safeTransferFrom(
        [alice.account.address, attacker.address, 1n, 5n, "0x"],
        { account: alice.account },
      );

      // The hook observed the balance *after* the crediting transfer had
      // already applied — proving _update runs before the receiver callback
      // (checks-effects-interactions), not after.
      assert.equal(await attacker.read.balanceDuringCallback(), 5n);
      assert.equal(await attacker.read.reentrantCallSucceeded(), true);

      // Net effect: the reentrant transfer actually moved the tokens back out
      // to alice within the same transaction. No double-crediting occurred —
      // the attacker ends up with 0, alice ends up with exactly what she
      // started with, not 5 "extra" from a reentrancy bug.
      assert.equal(
        await badge.read.balanceOf([attacker.address, 1n]),
        0n,
      );
      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        5n,
      );
    });

    it("cannot conjure extra balance: reentrant transfer of more than was actually received reverts", async function () {
      const { badge, admin, minter, alice } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await badge.write.createBadgeType(["ipfs-less://badge-1.json", true], {
        account: admin.account,
      });

      const attacker = await viem.deployContract("MaliciousReceiver");
      await badge.write.mint([alice.account.address, 1n, 5n, "0x"], {
        account: minter.account,
      });

      // attacker will try to reentrantly move out MORE than it is about to
      // receive (10 instead of the 3 alice is sending it).
      await attacker.write.configure([
        badge.address,
        alice.account.address,
        1n,
        10n,
        true,
      ]);

      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.safeTransferFrom(
          [alice.account.address, attacker.address, 1n, 3n, "0x"],
          { account: alice.account },
        ),
        badge,
        "ERC1155InsufficientBalance",
        [attacker.address, 3n, 10n, 1n],
      );

      // the whole outer transfer must have rolled back too — alice keeps all 5.
      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        5n,
      );
      assert.equal(
        await badge.read.balanceOf([attacker.address, 1n]),
        0n,
      );
    });

    it("cannot steal an unrelated holder's balance — no approval exists regardless of reentrancy timing", async function () {
      const { badge, admin, minter, alice, bob } = await networkHelpers.loadFixture(
        deployBadgeToken,
      );
      await badge.write.createBadgeType(["ipfs-less://badge-1.json", true], {
        account: admin.account,
      });

      const attacker = await viem.deployContract("MaliciousReceiver");

      // alice and bob each independently hold the same badge id.
      await badge.write.mint([alice.account.address, 1n, 5n, "0x"], {
        account: minter.account,
      });
      await badge.write.mint([bob.account.address, 1n, 3n, "0x"], {
        account: minter.account,
      });

      // configure the reentrant call to pull FROM bob (never approved us) instead
      // of from our own just-credited balance.
      await attacker.write.configure([
        badge.address,
        attacker.address, // reentryTo: send the "stolen" tokens to ourselves
        1n,
        3n,
        true, // attackOnReceive
      ]);
      await attacker.write.setStealFrom([bob.account.address]);

      // alice's transfer to the attacker triggers the hook; the attacker tries
      // to use that moment to pull bob's balance, not its own.
      await viem.assertions.revertWithCustomErrorWithArgs(
        badge.write.safeTransferFrom(
          [alice.account.address, attacker.address, 1n, 1n, "0x"],
          { account: alice.account },
        ),
        badge,
        "ERC1155MissingApprovalForAll",
        [attacker.address, bob.account.address],
      );

      // whole tx rolled back — nobody's balance moved, including alice's.
      assert.equal(
        await badge.read.balanceOf([alice.account.address, 1n]),
        5n,
      );
      assert.equal(await badge.read.balanceOf([bob.account.address, 1n]), 3n);
      assert.equal(
        await badge.read.balanceOf([attacker.address, 1n]),
        0n,
      );
    });
  });
});
