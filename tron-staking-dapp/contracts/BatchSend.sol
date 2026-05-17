// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/// @title BatchSend — gas-efficient batch TRC-20 transfers
/// @notice Lets a user send a TRC-20 token to many recipients in a single
///         transaction. Pulls tokens from the caller (`msg.sender`) using
///         `transferFrom`, so the caller must approve this contract for the
///         total amount they want to send first.
///
/// Design notes (deliberately "boring"):
///   - No owner, no admin, no upgrade.
///   - No `pause`, no `rescue`, no `execute`. There are no levers to pull.
///   - Only one job: loop `transferFrom(msg.sender, recipients[i], amounts[i])`.
///   - Compatible with non-standard tokens (e.g. USDT-TRC20) that don't return
///     a bool on transfer — we use a low-level call and check return data.
///
/// Why this design? Because every owner/admin function is a potential backdoor.
/// A scammer-owner contract is the most common rug pattern on TRON/BSC.
/// This contract has nothing for a scammer to abuse, which is the whole point.
contract BatchSend {
    /// @notice Emitted once per successful recipient transfer.
    event Sent(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 amount
    );

    /// @notice Send `amounts[i]` of `token` to `recipients[i]` for each i.
    /// @dev Caller must first call `token.approve(this, totalAmount)`.
    /// @param token       TRC-20 token contract address.
    /// @param recipients  Recipient addresses (parallel array with `amounts`).
    /// @param amounts     Amount to send to each recipient, in token units.
    function batchTransfer(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        require(recipients.length == amounts.length, "BatchSend: length mismatch");
        require(recipients.length > 0, "BatchSend: empty batch");
        require(recipients.length <= 200, "BatchSend: batch too large");

        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "BatchSend: zero recipient");
            require(amounts[i] > 0, "BatchSend: zero amount");

            _safeTransferFrom(token, msg.sender, recipients[i], amounts[i]);
            emit Sent(token, msg.sender, recipients[i], amounts[i]);
        }
    }

    /// @notice Send the same `amount` of `token` to every recipient.
    /// @dev Convenience wrapper for airdrops / equal splits.
    function batchTransferSameAmount(
        address token,
        address[] calldata recipients,
        uint256 amount
    ) external {
        require(recipients.length > 0, "BatchSend: empty batch");
        require(recipients.length <= 200, "BatchSend: batch too large");
        require(amount > 0, "BatchSend: zero amount");

        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "BatchSend: zero recipient");
            _safeTransferFrom(token, msg.sender, recipients[i], amount);
            emit Sent(token, msg.sender, recipients[i], amount);
        }
    }

    /// @dev USDT-TRC20 returns no value from transferFrom (non-standard).
    ///      Handle both standard and non-standard tokens.
    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        // Reject EOAs / zero address — calling those returns (true, "") and
        // would otherwise emit a fake Sent event without moving any tokens.
        require(token.code.length > 0, "BatchSend: token not a contract");
        // selector for transferFrom(address,address,uint256) = 0x23b872dd
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount)
        );
        require(ok, "BatchSend: transferFrom call failed");
        if (ret.length > 0) {
            require(abi.decode(ret, (bool)), "BatchSend: transferFrom returned false");
        }
    }
}
