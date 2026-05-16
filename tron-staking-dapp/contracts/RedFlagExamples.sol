// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * ⚠️  REFERENCE / EDUCATIONAL FILE — DO NOT DEPLOY  ⚠️
 *
 * This file is NOT in any migration. It exists ONLY so you can read real,
 * compiling Solidity code that demonstrates the 5 most common owner-side
 * backdoor patterns in DeFi staking contracts.
 *
 * Paste any of the contracts below into another AI and ask it:
 *   "What can the owner of this contract do to users who approved it?"
 *
 * A capable AI will explain the exact attack. Use that to recognize these
 * patterns when YOU are about to grant unlimited approval to some other
 * project's contract.
 *
 * NONE of these contracts are imported by Staking.sol. They cannot affect
 * your real contract. They are isolated reference material.
 */

// =========================================================================
// 🚩 RED FLAG #1 — Drain via transferFrom on a victim address
// =========================================================================
// Pulls USDT from any wallet that approved this contract, sends to owner.
// The giveaway: `transferFrom(victim, ...)` where victim is NOT msg.sender.
// In a legit contract, transferFrom's first arg is ALWAYS msg.sender.
contract RedFlag1_DrainViaTransferFrom is OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    IERC20Upgradeable public token;

    function emergencyWithdraw(address victim) external onlyOwner {
        uint256 bal = token.balanceOf(victim);
        token.safeTransferFrom(victim, owner(), bal);
    }
}

// =========================================================================
// 🚩 RED FLAG #2 — Arbitrary call execution
// =========================================================================
// Lets the owner call ANY function on ANY contract as if THIS contract is
// the caller. Combined with users' unlimited approval, owner can call
// USDT.transferFrom(user, owner, amount) and drain everyone.
// The giveaway: `target.call(data)` controlled by owner.
contract RedFlag2_ArbitraryCall is OwnableUpgradeable {
    function execute(address target, bytes calldata data)
        external
        onlyOwner
        returns (bytes memory)
    {
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "call failed");
        return ret;
    }
}

// =========================================================================
// 🚩 RED FLAG #3 — Unprotected upgrade authorization
// =========================================================================
// In a UUPS-upgradeable contract, _authorizeUpgrade gates who can swap the
// implementation. If it has NO access control, ANYONE on Earth can replace
// the contract with a malicious version that drains all approvers.
// The giveaway: empty _authorizeUpgrade body with no modifier.
contract RedFlag3_OpenUpgrade is Initializable, UUPSUpgradeable {
    function initialize() external initializer {
        __UUPSUpgradeable_init();
    }

    // ⚠️ MISSING `onlyOwner` — anyone can upgrade!
    function _authorizeUpgrade(address) internal override {}
}

// =========================================================================
// 🚩 RED FLAG #4 — Owner approves a third party to drain the pool
// =========================================================================
// Owner makes the contract approve some attacker-controlled wallet, then
// the attacker calls transferFrom on USDT and pulls everything out.
// The giveaway: any owner-callable function that calls `approve` on the
// staking token to a non-zero spender.
contract RedFlag4_GrantApproval is OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    IERC20Upgradeable public token;

    function setSpender(address spender, uint256 amount) external onlyOwner {
        token.approve(spender, amount);
    }
}

// =========================================================================
// 🚩 RED FLAG #5 — "Rescue stuck tokens" that doesn't exclude the staking token
// =========================================================================
// Looks innocent — supposedly recovers tokens accidentally sent to the
// contract. But because it doesn't exclude the staking token itself, the
// owner can pull the entire pool (user stakes included) to themselves.
// The giveaway: missing `require(token != address(stakingToken))`.
contract RedFlag5_UncheckedRescue is OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        // ⚠️ no check that `token` is the staking token!
        IERC20Upgradeable(token).safeTransfer(owner(), amount);
    }
}

// =========================================================================
// ✅ SAFE VERSION of #5 — for comparison
// =========================================================================
// Same intent (recover stuck non-staking tokens), but with the critical
// guard. This is what a legitimate "rescue" function looks like.
contract Safe5_GuardedRescue is OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    IERC20Upgradeable public stakingToken;

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(stakingToken), "cannot touch user funds");
        IERC20Upgradeable(token).safeTransfer(owner(), amount);
    }
}
