// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IBadgeTokenForAttack {
    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

/// @notice Test-only contract used to probe whether BadgeToken's `_update` choke
/// point can be reentered from inside the ERC-1155 receiver hook to double-spend
/// or otherwise observe inconsistent state. Not part of the production system.
contract MaliciousReceiver is IERC1155Receiver {
    address public badge;
    address public reentryTo;
    uint256 public reentryId;
    uint256 public reentryAmount;
    bool public attackOnReceive;

    // Balance this contract observed *during* the receiver callback, before the
    // outer call that triggered it has returned.
    uint256 public balanceDuringCallback;
    bool public reentrantCallSucceeded;

    function configure(
        address badge_,
        address reentryTo_,
        uint256 reentryId_,
        uint256 reentryAmount_,
        bool attackOnReceive_
    ) external {
        badge = badge_;
        reentryTo = reentryTo_;
        reentryId = reentryId_;
        reentryAmount = reentryAmount_;
        attackOnReceive = attackOnReceive_;
    }

    function onERC1155Received(address, address, uint256 id, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        balanceDuringCallback = IBadgeTokenForAttack(badge).balanceOf(address(this), id);

        if (attackOnReceive) {
            // Try to immediately move the badge back out, from *inside* the hook
            // that fired as part of the transfer that just credited it to us.
            IBadgeTokenForAttack(badge).safeTransferFrom(
                address(this), reentryTo, reentryId, reentryAmount, ""
            );
            reentrantCallSucceeded = true;
        }

        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
