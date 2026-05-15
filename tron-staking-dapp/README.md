# JST Staking dApp (TRON)

A complete TRON staking dApp: stake **JST**, earn JST rewards at a fixed APR
(default 12%), with a 7-day lock from the most recent stake. Early withdrawal
is allowed but forfeits any pending rewards.

- **Smart contracts:** Solidity 0.8.18, OpenZeppelin (Ownable, ReentrancyGuard, Pausable, SafeERC20)
- **Deployment:** TronBox (Nile testnet + Mainnet)
- **Frontend:** Vanilla HTML / CSS / JS using TronWeb + TronLink

> ⚠️ This software is provided **as-is** with no warranty. Audit the contracts
> and test thoroughly on Nile before considering mainnet deployment.

---

## Project layout

```
tron-staking-dapp/
├── contracts/
│   ├── Staking.sol        # Main staking contract (UUPS upgradeable)
│   ├── StakingProxy.sol   # ERC1967 proxy wrapper
│   ├── MockJST.sol        # Test TRC-20 (Nile only)
│   └── Migrations.sol     # TronBox migration tracker
├── migrations/
│   ├── 1_initial_migration.js
│   ├── 2_deploy_staking.js
│   └── 3_upgrade_staking.js  # Disabled by default; enable to upgrade
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── config.js          # Fill in deployed addresses here
├── tronbox.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Prerequisites

- **Node.js 18+** and npm
- **TronLink** browser extension — https://www.tronlink.org
- A funded Nile testnet account
  - Nile faucet: https://nileex.io/join/getJoinPage
  - Alt faucet: https://shasta.tronex.io (Shasta) / Nile community faucet on the Nile site
- (Optional) Mainnet TRX for production deployment

---

## Install

```bash
cd tron-staking-dapp
npm install
cp .env.example .env
# edit .env and paste your private key(s) WITHOUT a 0x prefix
```

---

## Compile

```bash
npm run compile
```

Compiled artifacts are written to `./build/contracts/`.

---

## Deploy to Nile testnet

1. Make sure `PRIVATE_KEY_NILE` is set in `.env`.
2. Make sure that address has Nile TRX (use the faucet above).
3. Run:

   ```bash
   npm run migrate:nile
   ```

4. The output will print three addresses (token, implementation, proxy).
   Copy them into `frontend/config.js`:

   ```js
   STAKING_ADDRESS: "T...",   // ⚠️ use the PROXY address (printed as "Deployed StakingProxy at")
   TOKEN_ADDRESS:   "T...",   // address printed for "Deployed MockJST at"
   ```

   The implementation address is only used for upgrades — never call it
   directly.

5. Fund the reward pool so users can earn rewards. From `npm run console:nile`:

   ```js
   const s = await Staking.deployed();
   const t = await MockJST.deployed();
   const amt = "100000000000000000000000"; // 100,000 mJST (18 decimals)
   await t.approve(s.address, amt).send();
   await s.fundRewardPool(amt).send();
   ```

---

## Run the frontend

The frontend is fully static — open `frontend/index.html` directly, or serve it:

```bash
npm run frontend
# then open http://localhost:5173
```

Connect TronLink (set the network to **Nile** in the extension), then Approve,
Stake, Unstake, and Claim from the UI. Stats refresh automatically every 10s.

---

## Deploy to Mainnet

> **Do not deploy to mainnet without a thorough audit and full Nile testing
> of every flow.**

1. Set `PRIVATE_KEY_MAINNET` in `.env`.
2. The mainnet migration uses the real JST token at
   `TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9`. Confirm this is the address you
   intend to support before proceeding.
3. Run:

   ```bash
   npm run migrate:mainnet
   ```

4. Update `frontend/config.js`:

   ```js
   NETWORK: "mainnet",
   TRONSCAN_BASE: "https://tronscan.org",
   STAKING_ADDRESS: "T...",
   TOKEN_ADDRESS: "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9",
   TOKEN_SYMBOL: "JST",
   TOKEN_DECIMALS: 18,
   ```

---

## Verifying on TronScan

1. Open the contract page: `https://tronscan.org/#/contract/<STAKING_ADDRESS>` (mainnet)
   or `https://nile.tronscan.org/#/contract/<STAKING_ADDRESS>` (Nile).
2. Click **Contract → Verify and Publish**.
3. Submit:
   - **Compiler version:** `v0.8.18+commit.<hash>` (use the version reported by `tronbox compile`)
   - **Optimization:** Enabled, runs = `200`
   - **EVM version:** `istanbul`
   - **License:** MIT
   - **Source code:** the contents of `contracts/Staking.sol`. If the verifier
     does not auto-resolve OpenZeppelin imports, paste the flattened source
     (you can produce one with any Solidity flattener, e.g.
     `npx sol-merger contracts/Staking.sol ./flattened`).
   - **Constructor arguments:** ABI-encoded `(address _stakingToken, uint256 _aprBps)`.
4. Submit and wait for verification confirmation. Repeat for `MockJST.sol` if used.

---

## Owner operations

After deployment, the deployer (owner) can:

- `fundRewardPool(amount)` — top up the rewards budget.
- `withdrawUnusedRewards(amount)` — pull from the reward pool only. The contract
  enforces that withdrawals can never touch staked principal or rewards already
  accrued to users.
- `setAPR(newAprBps)` — change APR; capped at 5000 bps (50%). Past time is
  not re-priced; the new rate applies only going forward.
- `setLockPeriod(newLockPeriod)` — change the lock window; capped at 365 days.
- `pause()` / `unpause()` — pauses new stakes; unstake/claim remain available.
- `upgradeTo(newImplementation)` — upgrade the contract logic (UUPS).

## Upgrading the contract

The `Staking` contract is deployed behind a UUPS proxy (`StakingProxy`). The
**proxy address** is what users interact with and what you put in
`frontend/config.js` as `STAKING_ADDRESS`. Upgrading swaps the implementation
behind that proxy — the address, balances, and storage stay the same.

To upgrade:

1. Edit `contracts/Staking.sol` (or create `StakingV2.sol` inheriting it) and
   bump `version()`.
2. **Storage rules — read carefully:**
   - Never reorder existing state variables.
   - Never insert new variables in the middle.
   - Only **append** new variables at the end of the storage block, and
     decrement `__gap` by the number of slots you used.
3. Run the upgrade migration. Open `migrations/3_upgrade_staking.js`, remove
   the `return;` line, then:
   ```bash
   STAKING_PROXY=T<your-proxy-address> npx tronbox migrate --network nile --f 3 --to 3
   ```
4. Verify by reading `version()` from the proxy address — it should return the
   new value.

Only the contract owner can call `upgradeTo`. Use a multisig owner for any
non-trivial deployment.

---

## Security checklist

- **Never share your private key.** Anyone with the key can drain that account.
- **Never commit `.env`.** It is gitignored — keep it that way.
- **Audit before mainnet.** Have the contracts reviewed by a qualified auditor.
- **Test every flow on Nile first.** stake → wait lock → claim, stake → unstake
  early (rewards forfeited), pause/unpause, fund/withdraw reward pool, setAPR.
- **Watch the invariant:** `tokenBalance(contract) >= totalStaked + unclaimedRewards`
  must hold at all times. The owner withdrawal path enforces this on-chain.
- **Use a multisig owner** for any non-trivial deployment.
- **Unlimited approval** — the frontend approves `uint256.max` for convenience.
  This means the staking contract can move *any* amount of your tokens at any
  time. Only approve contracts whose source you have read and whose deployer
  you trust. Users should review `Staking.sol` themselves before approving.

---

## License

MIT. See `contracts/Staking.sol` for the SPDX header.
