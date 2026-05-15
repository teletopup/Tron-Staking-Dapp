// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title StakingProxy
 * @notice Thin ERC1967 proxy wrapper so TronBox / TronScan can deploy and
 *         verify the proxy as a normal contract. The proxy delegates all
 *         calls to the implementation and stores the implementation address
 *         in the standard EIP-1967 slot.
 *
 *         Use the Staking implementation's `upgradeTo(newImpl)` (UUPS) to
 *         upgrade — there is no admin contract.
 */
contract StakingProxy is ERC1967Proxy {
    constructor(address implementation_, bytes memory data_)
        ERC1967Proxy(implementation_, data_)
    {}
}
