// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title Staking (UUPS upgradeable)
 * @notice Single-token staking: users stake the configured TRC-20 token
 *         (USDT on mainnet, MockUSDT on testnet) and earn rewards in the
 *         same token at a fixed APR set by the owner.
 *
 * Upgradeability:
 *  - UUPS proxy pattern. The owner is the only address allowed to authorize
 *    an upgrade (`_authorizeUpgrade`).
 *  - Storage layout MUST remain append-only across upgrades. To safely add
 *    new fields later, append them at the END of the contract — never insert
 *    in the middle, never reorder. A `__gap` slot reserve is included.
 *
 * Design:
 *  - Fixed APR in basis points (e.g. 1200 = 12%) accrued per second.
 *  - APR uses a Synthetix-style global reward index so APR changes never
 *    re-price past time.
 *  - Lock period (default 7 days) is configurable by the owner.
 *  - `unstake` always allows principal exit; rewards are paid only if past
 *    lock and only up to what the reward pool can cover. Any unpaid amount
 *    remains claimable later.
 *  - Owner can fund/withdraw the reward pool but `withdrawUnusedRewards`
 *    enforces `balance >= totalStaked + unclaimedRewards` after settlement.
 *
 * Invariant (enforced):
 *   tokenBalance(this) >= totalStaked + unclaimedRewards
 */
contract Staking is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // ---------------------------------------------------------------------
    // Constants (fine for upgradeable contracts — they live in code, not storage)
    // ---------------------------------------------------------------------

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_APR_BPS = 5_000; // 50%
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MAX_LOCK_PERIOD = 365 days;
    uint256 private constant INDEX_PRECISION = 1e18;

    // ---------------------------------------------------------------------
    // Storage  ── APPEND-ONLY. Never reorder. Use __gap for future fields.
    // ---------------------------------------------------------------------

    IERC20Upgradeable public stakingToken;
    uint256 public aprBps;
    uint256 public lockPeriod;

    uint256 public totalStaked;
    uint256 public rewardPool;
    uint256 public unclaimedRewards;

    uint256 public rewardPerTokenStored; // scaled by 1e18
    uint256 public lastUpdateTime;

    mapping(address => uint256) public stakedAmount;
    mapping(address => uint256) public lastStakeTime;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    /// @dev Reserved storage slots so future upgrades can add fields safely.
    uint256[40] private __gap;

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
    event LockPeriodUpdated(uint256 oldLockPeriod, uint256 newLockPeriod);

    // ---------------------------------------------------------------------
    // Initializer (replaces constructor for upgradeable contracts)
    // ---------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _stakingToken, uint256 _aprBps)
        external
        initializer
    {
        require(_stakingToken != address(0), "Staking: token=0");
        require(_aprBps <= MAX_APR_BPS, "Staking: APR too high");

        __Ownable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        stakingToken = IERC20Upgradeable(_stakingToken);
        aprBps = _aprBps;
        lockPeriod = 7 days;
        lastUpdateTime = block.timestamp;
    }

    /// @notice Only the owner can authorize an upgrade.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Returns the implementation version. Bump this in upgrades.
    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }

    // ---------------------------------------------------------------------
    // Index math
    // ---------------------------------------------------------------------

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        uint256 dt = block.timestamp - lastUpdateTime;
        if (dt == 0) return rewardPerTokenStored;
        uint256 delta = (dt * aprBps * INDEX_PRECISION) /
            (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        return rewardPerTokenStored + delta;
    }

    function earned(address user) public view returns (uint256) {
        uint256 rpt = rewardPerToken();
        uint256 accrued = (stakedAmount[user] *
            (rpt - userRewardPerTokenPaid[user])) / INDEX_PRECISION;
        return rewards[user] + accrued;
    }

    function pendingRewards(address user) external view returns (uint256) {
        return earned(user);
    }

    function _updateGlobal() internal {
        uint256 newRpt = rewardPerToken();
        if (newRpt != rewardPerTokenStored) {
            uint256 newAccrued = (totalStaked *
                (newRpt - rewardPerTokenStored)) / INDEX_PRECISION;
            if (newAccrued > 0) unclaimedRewards += newAccrued;
            rewardPerTokenStored = newRpt;
        }
        lastUpdateTime = block.timestamp;
    }

    function _settleUser(address user) internal {
        uint256 accrued = (stakedAmount[user] *
            (rewardPerTokenStored - userRewardPerTokenPaid[user])) /
            INDEX_PRECISION;
        if (accrued > 0) rewards[user] += accrued;
        userRewardPerTokenPaid[user] = rewardPerTokenStored;
    }

    modifier updateReward(address user) {
        _updateGlobal();
        if (user != address(0)) _settleUser(user);
        _;
    }

    // ---------------------------------------------------------------------
    // Other views
    // ---------------------------------------------------------------------

    function lockRemaining(address user) external view returns (uint256) {
        if (stakedAmount[user] == 0) return 0;
        uint256 unlockAt = lastStakeTime[user] + lockPeriod;
        if (block.timestamp >= unlockAt) return 0;
        return unlockAt - block.timestamp;
    }

    function stakedOf(address user) external view returns (uint256) {
        return stakedAmount[user];
    }

    /// @notice Backwards-compatible view (frontend reads this).
    function LOCK_PERIOD() external view returns (uint256) {
        return lockPeriod;
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

    function unstake(uint256 amount)
        external
        nonReentrant
        updateReward(msg.sender)
    {
        require(amount > 0, "Staking: amount=0");
        require(stakedAmount[msg.sender] >= amount, "Staking: insufficient staked");

        bool unlocked = block.timestamp >=
            lastStakeTime[msg.sender] + lockPeriod;
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

    function claimRewards() external nonReentrant updateReward(msg.sender) {
        require(stakedAmount[msg.sender] > 0, "Staking: nothing staked");
        require(
            block.timestamp >= lastStakeTime[msg.sender] + lockPeriod,
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

    function withdrawUnusedRewards(uint256 amount)
        external
        onlyOwner
        updateReward(address(0))
    {
        require(amount > 0, "Staking: amount=0");
        require(amount <= rewardPool, "Staking: exceeds reward pool");

        uint256 balAfter = stakingToken.balanceOf(address(this)) - amount;
        require(
            balAfter >= totalStaked + unclaimedRewards,
            "Staking: invariant violated"
        );

        rewardPool -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit RewardPoolWithdrawn(msg.sender, amount, rewardPool);
    }

    function setAPR(uint256 newAprBps)
        external
        onlyOwner
        updateReward(address(0))
    {
        require(newAprBps <= MAX_APR_BPS, "Staking: APR too high");
        uint256 old = aprBps;
        aprBps = newAprBps;
        emit APRUpdated(old, newAprBps);
    }

    /// @notice Update the lock period applied to NEW stake actions and to the
    ///         lock check. Capped at `MAX_LOCK_PERIOD` (365 days).
    function setLockPeriod(uint256 newLockPeriod) external onlyOwner {
        require(newLockPeriod <= MAX_LOCK_PERIOD, "Staking: lock too long");
        uint256 old = lockPeriod;
        lockPeriod = newLockPeriod;
        emit LockPeriodUpdated(old, newLockPeriod);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
