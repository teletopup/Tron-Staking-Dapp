/* global TronWeb */
(function () {
  "use strict";

  const cfg = window.APP_CONFIG;
  const TOKEN_ABI = window.TOKEN_ABI;
  const STAKING_ABI = window.STAKING_ABI;

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  const state = {
    tronWeb: null,
    address: null,
    tokenContract: null,
    stakingContract: null,
    refreshTimer: null,
    decimals: cfg.TOKEN_DECIMALS,
    symbol: cfg.TOKEN_SYMBOL,
  };

  // -----------------------------------------------------------------------
  // DOM
  // -----------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const els = {
    netBadge: $("netBadge"),
    connectBtn: $("connectBtn"),
    statBalance: $("statBalance"),
    statStaked: $("statStaked"),
    statPending: $("statPending"),
    statApr: $("statApr"),
    statLock: $("statLock"),
    amountInput: $("amountInput"),
    amountSuffix: $("amountSuffix"),
    maxBtn: $("maxBtn"),
    approveBtn: $("approveBtn"),
    stakeBtn: $("stakeBtn"),
    unstakeBtn: $("unstakeBtn"),
    claimBtn: $("claimBtn"),
    installPrompt: $("installPrompt"),
    toasts: $("toasts"),
  };

  els.netBadge.textContent = cfg.NETWORK;
  els.amountSuffix.textContent = cfg.TOKEN_SYMBOL;

  // -----------------------------------------------------------------------
  // Toasts
  // -----------------------------------------------------------------------

  function toast(message, kind, txid) {
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.innerHTML = escapeHtml(message);
    if (txid) {
      const a = document.createElement("a");
      a.href = `${cfg.TRONSCAN_BASE}/#/transaction/${txid}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "View on TronScan ↗";
      el.appendChild(a);
    }
    els.toasts.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s ease";
      setTimeout(() => el.remove(), 320);
    }, 6500);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // -----------------------------------------------------------------------
  // Format helpers
  // -----------------------------------------------------------------------

  function fromUnits(raw) {
    // raw is a string/BigNumber-like; format with decimals.
    const s = raw && raw.toString ? raw.toString() : "0";
    if (s === "0") return "0";
    const d = state.decimals;
    const padded = s.padStart(d + 1, "0");
    const intPart = padded.slice(0, padded.length - d).replace(/^0+(?=\d)/, "");
    let frac = padded.slice(padded.length - d).replace(/0+$/, "");
    if (frac.length > 4) frac = frac.slice(0, 4);
    return frac ? `${intPart}.${frac}` : intPart;
  }

  function toUnits(human) {
    if (!human || isNaN(Number(human))) throw new Error("Invalid amount");
    const [intPart, fracRaw = ""] = String(human).split(".");
    const frac = (fracRaw + "0".repeat(state.decimals)).slice(
      0,
      state.decimals,
    );
    const joined = (intPart + frac).replace(/^0+(?=\d)/, "");
    if (joined === "" || joined === "0") throw new Error("Amount must be > 0");
    return joined;
  }

  function formatDuration(secs) {
    secs = Number(secs);
    if (!secs || secs <= 0) return "Unlocked";
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function shortAddr(a) {
    if (!a) return "";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  // -----------------------------------------------------------------------
  // Wallet detection / connection
  // -----------------------------------------------------------------------

  async function detectTronLink(maxWaitMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (window.tronLink || (window.tronWeb && window.tronWeb.ready)) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }

  async function connect() {
    const installed = await detectTronLink();
    if (!installed) {
      els.installPrompt.classList.remove("hidden");
      return;
    }

    try {
      if (window.tronLink && window.tronLink.request) {
        const res = await window.tronLink.request({
          method: "tron_requestAccounts",
        });
        if (res && res.code && res.code !== 200) {
          toast(res.message || "Wallet connection rejected", "error");
          return;
        }
      }
    } catch (e) {
      toast("Wallet connection failed: " + (e.message || e), "error");
      return;
    }

    if (!window.tronWeb || !window.tronWeb.ready) {
      toast("TronLink not ready. Unlock the extension and try again.", "warn");
      return;
    }

    state.tronWeb = window.tronWeb;
    state.address = state.tronWeb.defaultAddress.base58;
    els.connectBtn.textContent = shortAddr(state.address);

    await initContracts();
    await refresh();
    startAutoRefresh();
    toast("Wallet connected");
  }

  async function initContracts() {
    state.tokenContract = await state.tronWeb
      .contract(TOKEN_ABI, cfg.TOKEN_ADDRESS);
    state.stakingContract = await state.tronWeb
      .contract(STAKING_ABI, cfg.STAKING_ADDRESS);

    // Refresh decimals/symbol from chain (best-effort).
    try {
      const d = await state.tokenContract.decimals().call();
      state.decimals = Number(d);
    } catch (_) {}
    try {
      const sym = await state.tokenContract.symbol().call();
      state.symbol = sym;
      els.amountSuffix.textContent = sym;
    } catch (_) {}
  }

  // -----------------------------------------------------------------------
  // Read stats
  // -----------------------------------------------------------------------

  async function refresh() {
    if (!state.tronWeb || !state.address) return;
    try {
      const [bal, staked, pending, apr, lock] = await Promise.all([
        state.tokenContract.balanceOf(state.address).call(),
        state.stakingContract.stakedOf(state.address).call(),
        state.stakingContract.pendingRewards(state.address).call(),
        state.stakingContract.aprBps().call(),
        state.stakingContract.lockRemaining(state.address).call(),
      ]);

      els.statBalance.textContent = `${fromUnits(bal)} ${state.symbol}`;
      els.statStaked.textContent = `${fromUnits(staked)} ${state.symbol}`;
      els.statPending.textContent = `${fromUnits(pending)} ${state.symbol}`;
      els.statApr.textContent = `${(Number(apr.toString()) / 100).toFixed(2)}%`;
      els.statLock.textContent = formatDuration(Number(lock.toString()));
    } catch (e) {
      console.error("refresh failed:", e);
    }
  }

  function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(refresh, cfg.REFRESH_INTERVAL_MS);
  }

  // -----------------------------------------------------------------------
  // Tx helpers
  // -----------------------------------------------------------------------

  function requireConnected() {
    if (!state.tronWeb || !state.address) {
      toast("Connect your wallet first", "warn");
      return false;
    }
    return true;
  }

  async function sendTx(label, builder) {
    try {
      toast(`${label} — sending…`);
      const txid = await builder.send({ shouldPollResponse: false });
      toast(`${label} submitted`, undefined, txid);
      // give the network a moment, then refresh
      setTimeout(refresh, 4000);
      setTimeout(refresh, 12000);
    } catch (e) {
      const msg = (e && (e.message || e.error)) || String(e);
      toast(`${label} failed: ${msg}`, "error");
    }
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  async function onApprove() {
    if (!requireConnected()) return;
    const MAX = "f".repeat(64); // 2^256 - 1, hex
    const max = state.tronWeb.toBigNumber("0x" + MAX).toString(10);

    // USDT-TRC20 (and other Tether-style tokens) require resetting an
    // existing non-zero allowance to 0 before changing it. Check first.
    let current;
    try {
      current = await state.tokenContract
        .allowance(state.address, cfg.STAKING_ADDRESS)
        .call();
      current = state.tronWeb.toBigNumber(current.toString());
    } catch (_) {
      current = state.tronWeb.toBigNumber(0);
    }

    // If already approved with a huge allowance, skip — saves the user a fee.
    const threshold = state.tronWeb.toBigNumber("0x" + "f".repeat(60)); // ~half of max
    if (current.gte(threshold)) {
      toast("Already approved — no transaction needed", "info");
      return;
    }

    // If a non-zero allowance exists, reset to 0 first (USDT requirement).
    if (current.gt(0)) {
      const ok = await sendTx(
        "Reset approval",
        state.tokenContract.approve(cfg.STAKING_ADDRESS, 0),
      );
      if (ok === false) return;
    }

    await sendTx(
      "Approve ∞",
      state.tokenContract.approve(cfg.STAKING_ADDRESS, max),
    );
  }

  async function onStake() {
    if (!requireConnected()) return;
    let units;
    try {
      units = toUnits(els.amountInput.value);
    } catch (e) {
      toast(e.message, "warn");
      return;
    }
    await sendTx("Stake", state.stakingContract.stake(units));
  }

  async function onUnstake() {
    if (!requireConnected()) return;
    let units;
    try {
      units = toUnits(els.amountInput.value);
    } catch (e) {
      toast(e.message, "warn");
      return;
    }
    await sendTx("Unstake", state.stakingContract.unstake(units));
  }

  async function onClaim() {
    if (!requireConnected()) return;
    await sendTx("Claim rewards", state.stakingContract.claimRewards());
  }

  async function onMax() {
    if (!requireConnected()) return;
    try {
      const bal = await state.tokenContract.balanceOf(state.address).call();
      els.amountInput.value = fromUnits(bal);
    } catch (_) {}
  }

  // -----------------------------------------------------------------------
  // Wire up
  // -----------------------------------------------------------------------

  els.connectBtn.addEventListener("click", connect);
  els.approveBtn.addEventListener("click", onApprove);
  els.stakeBtn.addEventListener("click", onStake);
  els.unstakeBtn.addEventListener("click", onUnstake);
  els.claimBtn.addEventListener("click", onClaim);
  els.maxBtn.addEventListener("click", onMax);

  // React to TronLink account/chain changes.
  window.addEventListener("message", (ev) => {
    if (!ev.data || !ev.data.message) return;
    const m = ev.data.message;
    if (m.action === "accountsChanged" || m.action === "setAccount") {
      if (window.tronWeb && window.tronWeb.ready) {
        state.tronWeb = window.tronWeb;
        state.address = state.tronWeb.defaultAddress.base58;
        els.connectBtn.textContent = shortAddr(state.address);
        initContracts().then(refresh);
      }
    }
  });

  // Try a silent auto-connect if TronLink is already unlocked.
  (async function autoConnect() {
    const ok = await detectTronLink(2000);
    if (ok && window.tronWeb && window.tronWeb.ready) {
      state.tronWeb = window.tronWeb;
      state.address = state.tronWeb.defaultAddress.base58;
      els.connectBtn.textContent = shortAddr(state.address);
      await initContracts();
      await refresh();
      startAutoRefresh();
    }
  })();
})();
