// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockJST
 * @notice Mintable TRC-20 used as a stand-in for JST on Nile testnet.
 *         Anyone can call `faucet()` to receive 1,000 tokens for testing.
 */
contract MockJST is ERC20, Ownable {
    uint8 private constant DECIMALS = 18;
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** DECIMALS;

    constructor() ERC20("Mock JST", "mJST") {
        _mint(msg.sender, 1_000_000 * 10 ** DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
