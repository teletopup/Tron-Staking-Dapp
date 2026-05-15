// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title Staking
 * @notice Single-token staking: users stake JST and earn JST rewards.
 *
 * Design:
 *  - Fixed APR in basis points (e.g. 1200 = 12%) accrued per second.
 *  - APR can be changed by the owner. To avoid retroactively re-pricing past
 *    time at a new rate, we use a Synthetix-style global reward index
 *    (`rewardPerTokenStored`). Every state-changing call settles the index up
 *    to `block.timestamp`, so APR changes only affect time AFTER the change.
 *  - 7-day lock from the most recent stake. `claimRewards` requires the lock
 *    to be over. `unstake` is always allowed for principal; rewards are paid
 *    only if the lock has elapsed, otherwise they are forfeited.
 *  - Owner can fund and withdraw the reward pool, but `withdrawUnusedRewards`
 *    enforces that the contract's token balance after the withdrawal still
 *    covers `totalStaked + unclaimedRewards` (settled to the current block).
 *  - When the reward pool is short, `claim`/`unstake` will not revert: any
 *    unpaid portion is left as `rewards[user]` and remains claimable once
 *    the owner refills the pool.
 *
 * Invariant (enforced):
 *   tokenBalance(this) >= totalStaked + unclaimedRewards
 */
contract Staking is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant LOCK_PERIOD = 7 days;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_APR_BPS = 5_000; // 50%
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant INDEX_PRECISION = 1e18;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    IERC20 public immutable stakingToken;

    /// @notice Current APR in basis points (e.g. 1200 = 12%).
    uint256 public aprBps;

    /// @notice Sum of all staked principal. Owner withdraws cannot touch this.
    uint256 public totalStaked;

    /// @notice Available reward pool funded by the owner.
    uint256 public rewardPool;

    /// @notice Outstanding rewards already accrued and owed to stakers,
    ///         settled up to `lastUpdateTime`.
    uint256 public unclaimedRewards;

    /// @notice Cumulative rewards-per-token, scaled by 1e18.
    uint256 public rewardPerTokenStored;

    /// @notice Timestamp of last global index update.
    uint256 public lastUpdateTime;

    mapping(address => uint256) public stakedAmount;
    mapping(address => uint256) public lastStakeTime;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Staked(address indexed user, uint256 amount, uint256 newTotal);
    event Unstaked(address indexed user, uint256 amount, uint256 rewardsPaid);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardsForfeited(address indexed user, uint256 amount);
    event RewardPoolFunded(address indexed funder, uint256 amount, uint256 newPool);
    event RewardPoolWithdrawn(address indexed to, uint256 amount, uint256 newPool);
    event APRUpdated(uint256 oldAprBps, uint256 newAprBps);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address _stakingToken, uint256 _aprBps) {
        require(_stakingToken != address(0), "Staking: token=0");
        require(_aprBps <= MAX_APR_BPS, "Staking: APR too high");
        stakingToken = IERC20(_stakingToken);
        aprBps = _aprBps;
        lastUpdateTime = block.timestamp;
    }

    // ---------------------------------------------------------------------
    // Index math
    // ---------------------------------------------------------------------

    /// @notice Live reward-per-token accumulator, scaled by 1e18.
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }
        uint256 dt = block.timestamp - lastUpdateTime;
        if (dt == 0) return rewardPerTokenStored;
        // delta per token = dt * aprBps * 1e18 / (BPS * SECONDS_PER_YEAR)
        uint256 delta = (dt * aprBps * INDEX_PRECISION) /
            (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        return rewardPerTokenStored + delta;
    }

    /// @notice Total rewards owed to `user`, including currently accruing.
    function earned(address user) public view returns (uint256) {
        uint256 rpt = rewardPerToken();
        uint256 accrued = (stakedAmount[user] *
            (rpt - userRewardPerTokenPaid[user])) / INDEX_PRECISION;
        return rewards[user] + accrued;
    }

    /// @notice Backwards-compatible alias used by the frontend.
    function pendingRewards(address user) external view returns (uint256) {
        return earned(user);
    }

    /// @notice Settle the global index up to `block.timestamp`.
    function _updateGlobal() internal {
        uint256 newRpt = rewardPerToken();
        if (newRpt != rewardPerTokenStored) {
            // Newly settled liability since last update.
            uint256 newAccrued = (totalStaked *
                (newRpt - rewardPerTokenStored)) / INDEX_PRECISION;
            if (newAccrued > 0) {
                unclaimedRewards += newAccrued;
            }
            rewardPerTokenStored = newRpt;
        }
        lastUpdateTime = block.timestamp;
    }

    /// @notice Settle a user's rewards up to `block.timestamp`.
    ///         Caller must `_updateGlobal()` first.
    function _settleUser(address user) internal {
        uint256 rpt = rewardPerTokenStored;
        uint256 accrued = (stakedAmount[user] *
            (rpt - userRewardPerTokenPaid[user])) / INDEX_PRECISION;
        if (accrued > 0) {
            rewards[user] += accrued;
        }
        userRewardPerTokenPaid[user] = rpt;
    }

    modifier updateReward(address user) {
        _updateGlobal();
        if (user != address(0)) {
            _settleUser(user);
        }
        _;
    }

    // ---------------------------------------------------------------------
    // Other views
    // ---------------------------------------------------------------------

    function lockRemaining(address user) external view returns (uint256) {
        if (stakedAmount[user] == 0) return 0;
        uint256 unlockAt = lastStakeTime[user] + LOCK_PERIOD;
        if (block.timestamp >= unlockAt) return 0;
        return unlockAt - block.timestamp;
    }

    function stakedOf(address user) external view returns (uint256) {
        return stakedAmount[user];
    }

    // ---------------------------------------------------------------------
    // User actions
    // ---------------------------------------------------------------------

    function stake(uint256 amount)
        external
        nonReentrant
        whenNotPaused
        updateReward(msg.sender)
    {
        require(amount > 0, "Staking: amount=0");

        stakedAmount[msg.sender] += amount;
        lastStakeTime[msg.sender] = block.timestamp;
        totalStaked += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount, stakedAmount[msg.sender]);
    }

    /**
     * @notice Withdraw `amount` of staked principal.
     *         - If the lock period has passed, also pays any settled rewards
     *           up to the amount the reward pool can cover; any unpaid
     *           remainder stays claimable once the pool is refunded.
     *         - If still locked, all settled rewards are forfeited.
     *         Principal withdrawal NEVER reverts on reward-pool shortage.
     */
    function unstake(uint256 amount)
        external
        nonReentrant
        updateReward(msg.sender)
    {
        require(amount > 0, "Staking: amount=0");
        require(stakedAmount[msg.sender] >= amount, "Staking: insufficient staked");

        bool unlocked = block.timestamp >=
            lastStakeTime[msg.sender] + LOCK_PERIOD;
        uint256 rewardsPaid = 0;

        if (unlocked) {
            uint256 owed = rewards[msg.sender];
            if (owed > 0) {
                uint256 payable_ = owed > rewardPool ? rewardPool : owed;
                if (payable_ > 0) {
                    rewards[msg.sender] = owed - payable_;
                    unclaimedRewards -= payable_;
                    rewardPool -= payable_;
                    rewardsPaid = payable_;
                }
            }
        } else {
            uint256 forfeited = rewards[msg.sender];
            if (forfeited > 0) {
                rewards[msg.sender] = 0;
                unclaimedRewards -= forfeited;
                emit RewardsForfeited(msg.sender, forfeited);
            }
        }

        stakedAmount[msg.sender] -= amount;
        totalStaked -= amount;

        stakingToken.safeTransfer(msg.sender, amount + rewardsPaid);

        emit Unstaked(msg.sender, amount, rewardsPaid);
    }

    /**
     * @notice Claim accrued rewards. Requires the lock period to have passed.
     *         Pays as much as the reward pool can cover; any unpaid remainder
     *         stays claimable later.
     */
    function claimRewards() external nonReentrant updateReward(msg.sender) {
        require(stakedAmount[msg.sender] > 0, "Staking: nothing staked");
        require(
            block.timestamp >= lastStakeTime[msg.sender] + LOCK_PERIOD,
            "Staking: still locked"
        );

        uint256 owed = rewards[msg.sender];
        require(owed > 0, "Staking: no rewards");
        require(rewardPool > 0, "Staking: reward pool empty");

        uint256 payable_ = owed > rewardPool ? rewardPool : owed;
        rewards[msg.sender] = owed - payable_;
        unclaimedRewards -= payable_;
        rewardPool -= payable_;

        stakingToken.safeTransfer(msg.sender, payable_);

        emit RewardClaimed(msg.sender, payable_);
    }

    // ---------------------------------------------------------------------
    // Owner actions
    // ---------------------------------------------------------------------

    function fundRewardPool(uint256 amount) external onlyOwner {
        require(amount > 0, "Staking: amount=0");
        rewardPool += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardPoolFunded(msg.sender, amount, rewardPool);
    }

    /**
     * @notice Withdraw unused reward pool tokens. Cannot touch staked principal
     *         or rewards already accrued (settled to the current block).
     */
    function withdrawUnusedRewards(uint256 amount)
        external
        onlyOwner
        updateReward(address(0))
    {
        require(amount > 0, "Staking: amount=0");
        require(amount <= rewardPool, "Staking: exceeds reward pool");

        // After settlement, `unclaimedRewards` is current as of this block.
        uint256 balAfter = stakingToken.balanceOf(address(this)) - amount;
        require(
            balAfter >= totalStaked + unclaimedRewards,
            "Staking: invariant violated"
        );

        rewardPool -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit RewardPoolWithdrawn(msg.sender, amount, rewardPool);
    }

    /**
     * @notice Update APR. Settles the global index first so the new rate
     *         only applies from now forward (no retroactive re-pricing).
     */
    function setAPR(uint256 newAprBps) external onlyOwner updateReward(address(0)) {
        require(newAprBps <= MAX_APR_BPS, "Staking: APR too high");
        uint256 old = aprBps;
        aprBps = newAprBps;
        emit APRUpdated(old, newAprBps);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
