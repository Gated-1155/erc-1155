// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.6.1
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC1155Pausable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Pausable.sol";

contract BadgeToken is ERC1155, AccessControl, ERC1155Pausable, ERC1155Burnable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct BadgeType {
        string uri;
        bool transferable;
        bool exists;
    }

    mapping(uint256 id => BadgeType) private _badgeTypes;
    uint256 private _nextBadgeId = 1;

    error BadgeTypeDoesNotExist(uint256 id);
    error BadgeNotTransferable(uint256 id);
    error ApprovalNotAllowed();
    error InvalidUri();

    event BadgeTypeCreated(uint256 indexed id, string uri, bool transferable);
    event BadgeTransferabilityUpdated(uint256 indexed id, bool transferable);

    constructor(address defaultAdmin, address pauser, address minter) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(MINTER_ROLE, minter);
    }

    function createBadgeType(string calldata uri_, bool transferable_) public onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 id) {
        _validateUri(uri_);
        id = _nextBadgeId++;
        _badgeTypes[id] = BadgeType({uri: uri_, transferable: transferable_, exists: true});
        emit BadgeTypeCreated(id, uri_, transferable_);
    }

    function setTransferable(uint256 id, bool transferable_) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_badgeTypes[id].exists) revert BadgeTypeDoesNotExist(id);
        _badgeTypes[id].transferable = transferable_;
        emit BadgeTransferabilityUpdated(id, transferable_);
    }

    function isTransferable(uint256 id) public view returns (bool) {
        if (!_badgeTypes[id].exists) revert BadgeTypeDoesNotExist(id);
        return _badgeTypes[id].transferable;
    }

    function uri(uint256 id) public view override returns (string memory) {
        if (!_badgeTypes[id].exists) revert BadgeTypeDoesNotExist(id);
        return _badgeTypes[id].uri;
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function mint(address account, uint256 id, uint256 amount, bytes memory data) public onlyRole(MINTER_ROLE) {
        if (!_badgeTypes[id].exists) revert BadgeTypeDoesNotExist(id);
        _mint(account, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) public onlyRole(MINTER_ROLE) {
        for (uint256 i = 0; i < ids.length; i++) {
            if (!_badgeTypes[ids[i]].exists) revert BadgeTypeDoesNotExist(ids[i]);
        }
        _mintBatch(to, ids, amounts, data);
    }

    // The following functions are overrides required by Solidity.

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override(ERC1155, ERC1155Pausable) {
        for (uint256 i = 0; i < ids.length; i++) {
            if (!_badgeTypes[ids[i]].exists) revert BadgeTypeDoesNotExist(ids[i]);
            if (from != address(0) && to != address(0) && !_badgeTypes[ids[i]].transferable) {
                revert BadgeNotTransferable(ids[i]);
            }
        }
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // Badges are non-delegable: operator approval is disabled entirely, not just
    // gated at transfer time. This is the single choke point `setApprovalForAll`
    // funnels through, mirroring how `_update` is the choke point for transfers.
    function _setApprovalForAll(address, address, bool) internal pure override {
        revert ApprovalNotAllowed();
    }

    function _validateUri(string calldata uri_) private pure {
        bytes calldata data = bytes(uri_);
        if (data.length < 13) revert InvalidUri();
        if (data[0] != "h" || data[1] != "t" || data[2] != "t" || data[3] != "p" || data[4] != "s" || data[5] != ":" || data[6] != "/" || data[7] != "/") {
            revert InvalidUri();
        }
        bytes memory suffix = ".json";
        for (uint256 i = 0; i < 5; i++) {
            if (data[data.length - 5 + i] != suffix[i]) revert InvalidUri();
        }
    }
}
