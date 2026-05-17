/* global TronWeb */
(function () {
  "use strict";

  const cfg = window.APP_CONFIG;
  let TOKEN_ABI = window.TOKEN_ABI;
  const DEFAULT_TOKEN_ABI = window.TOKEN_ABI;

  // -----------------------------------------------------------------------
  // Admin overrides (localStorage)
  // -----------------------------------------------------------------------

  const LS_KEY = "sendDappOverrides_v1";
  const DEFAULTS = {
    NETWORK: cfg.NETWORK,
    TRONSCAN_BASE: cfg.TRONSCAN_BASE,
    TOKEN_ADDRESS: cfg.TOKEN_ADDRESS,
  };

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o.NETWORK) {
        cfg.NETWORK = o.NETWORK;
        cfg.TRONSCAN_BASE = o.NETWORK === "mainnet"
          ? "https://tronscan.org"
          : "https://nile.tronscan.org";
      }
      if (o.TOKEN_ADDRESS) cfg.TOKEN_ADDRESS = o.TOKEN_ADDRESS;
      if (Array.isArray(o.TOKEN_ABI) && o.TOKEN_ABI.length) TOKEN_ABI = o.TOKEN_ABI;
    } catch (_) {}
  }
  loadOverrides();

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  const state = {
    tronWeb: null,
    address: null,
    tokenContract: null,
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
    statTrx: $("statTrx"),
    statAddress: $("statAddress"),
    recipientInput: $("recipientInput"),
    amountInput: $("amountInput"),
    amountSuffix: $("amountSuffix"),
    maxBtn: $("maxBtn"),
    sendBtn: $("sendBtn"),
    installPrompt: $("installPrompt"),
    toasts: $("toasts"),
    adminToggle: $("adminToggle"),
    adminPanel: $("adminPanel"),
    adminNetwork: $("adminNetwork"),
    adminTokenAddr: $("adminTokenAddr"),
    adminTokenAbi: $("adminTokenAbi"),
    adminSaveBtn: $("adminSaveBtn"),
    adminResetBtn: $("adminResetBtn"),
    adminCurNet: $("adminCurNet"),
    adminCurToken: $("adminCurToken"),
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
    }, 7000);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // -----------------------------------------------------------------------
  // Format helpers
  // -----------------------------------------------------------------------

  function fromUnits(raw, decimals) {
    const d = decimals != null ? decimals : state.decimals;
    const s = raw && raw.toString ? raw.toString() : "0";
    if (s === "0") return "0";
    const padded = s.padStart(d + 1, "0");
    const intPart = padded.slice(0, padded.length - d).replace(/^0+(?=\d)/, "");
    let frac = padded.slice(padded.length - d).replace(/0+$/, "");
    if (frac.length > 4) frac = frac.slice(0, 4);
    return frac ? `${intPart}.${frac}` : intPart;
  }

  function toUnits(human) {
    if (!human || isNaN(Number(human))) throw new Error("Invalid amount");
    const [intPart, fracRaw = ""] = String(human).split(".");
    const frac = (fracRaw + "0".repeat(state.decimals)).slice(0, state.decimals);
    const joined = (intPart + frac).replace(/^0+(?=\d)/, "");
    if (joined === "" || joined === "0") throw new Error("Amount must be > 0");
    return joined;
  }

  function shortAddr(a) {
    if (!a) return "";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function isValidTronAddr(s) {
    return typeof s === "string" && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s.trim());
  }

  // -----------------------------------------------------------------------
  // Wallet detection / connection
  // -----------------------------------------------------------------------

  async function detectTronLink(maxWaitMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (window.tronLink || (window.tronWeb && window.tronWeb.ready)) return true;
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
        const res = await window.tronLink.request({ method: "tron_requestAccounts" });
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
    els.statAddress.textContent = state.address;
    await initContracts();
    await refresh();
    startAutoRefresh();
    toast("Wallet connected");
  }

  async function initContracts() {
    state.tokenContract = await state.tronWeb.contract(TOKEN_ABI, cfg.TOKEN_ADDRESS);
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
  // Read balances
  // -----------------------------------------------------------------------

  async function refresh() {
    if (!state.tronWeb || !state.address) return;
    try {
      const [bal, trxSun] = await Promise.all([
        state.tokenContract.balanceOf(state.address).call(),
        state.tronWeb.trx.getBalance(state.address),
      ]);
      els.statBalance.textContent = `${fromUnits(bal)} ${state.symbol}`;
      // TRX has 6 decimals (SUN)
      els.statTrx.textContent = `${fromUnits(trxSun.toString(), 6)} TRX`;
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

  async function onSend() {
    if (!requireConnected()) return;

    const to = els.recipientInput.value.trim();
    if (!isValidTronAddr(to)) {
      toast("Recipient address looks invalid (must start with T, 34 chars)", "error");
      return;
    }
    if (to === state.address) {
      toast("You can't send to your own wallet", "warn");
      return;
    }

    let units;
    try {
      units = toUnits(els.amountInput.value);
    } catch (e) {
      toast(e.message, "warn");
      return;
    }

    // Confirm before sending (irreversible)
    const human = els.amountInput.value;
    const ok = confirm(
      `Send ${human} ${state.symbol} to\n${to}?\n\nThis cannot be undone.`,
    );
    if (!ok) return;

    await sendTx(
      `Send ${human} ${state.symbol}`,
      state.tokenContract.transfer(to, units),
    );
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
  els.sendBtn.addEventListener("click", onSend);
  els.maxBtn.addEventListener("click", onMax);

  // -----------------------------------------------------------------------
  // Admin panel
  // -----------------------------------------------------------------------

  function updateAdminCurrent() {
    els.adminCurNet.textContent = cfg.NETWORK;
    els.adminCurToken.textContent = cfg.TOKEN_ADDRESS;
    els.netBadge.textContent = cfg.NETWORK;
  }

  function populateAdminInputs() {
    els.adminNetwork.value = cfg.NETWORK === "mainnet" ? "mainnet" : "nile";
    els.adminTokenAddr.value = cfg.TOKEN_ADDRESS;
    const isDefault = TOKEN_ABI === DEFAULT_TOKEN_ABI;
    els.adminTokenAbi.value = isDefault ? "" : JSON.stringify(TOKEN_ABI, null, 2);
  }

  function parseAbiOrNull(text, label) {
    const trimmed = (text || "").trim();
    if (!trimmed) return null;
    let parsed;
    try { parsed = JSON.parse(trimmed); }
    catch (e) { throw new Error(`${label} ABI is not valid JSON`); }
    if (!Array.isArray(parsed)) throw new Error(`${label} ABI must be a JSON array`);
    if (!parsed.length) throw new Error(`${label} ABI is empty`);
    return parsed;
  }

  els.adminToggle.addEventListener("click", () => {
    const open = els.adminPanel.classList.toggle("hidden") === false;
    els.adminToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      populateAdminInputs();
      updateAdminCurrent();
    }
  });

  els.adminSaveBtn.addEventListener("click", async () => {
    const token = els.adminTokenAddr.value.trim();
    const network = els.adminNetwork.value;

    if (!isValidTronAddr(token)) {
      toast("Token address looks invalid (must start with T, 34 chars)", "error");
      return;
    }

    let tokenAbi;
    try {
      tokenAbi = parseAbiOrNull(els.adminTokenAbi.value, "Token");
    } catch (e) {
      toast(e.message, "error");
      return;
    }

    const overrides = { NETWORK: network, TOKEN_ADDRESS: token };
    if (tokenAbi) overrides.TOKEN_ABI = tokenAbi;

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(overrides));
    } catch (e) {
      toast("Could not save (storage blocked)", "error");
      return;
    }

    cfg.NETWORK = network;
    cfg.TRONSCAN_BASE = network === "mainnet"
      ? "https://tronscan.org"
      : "https://nile.tronscan.org";
    cfg.TOKEN_ADDRESS = token;
    TOKEN_ABI = tokenAbi || DEFAULT_TOKEN_ABI;

    updateAdminCurrent();
    toast("Saved. Reloading token…", "info");

    if (state.tronWeb && state.address) {
      try {
        await initContracts();
        await refresh();
        toast("Token switched", "info");
      } catch (e) {
        toast("Reload failed: " + (e.message || e), "error");
      }
    }
  });

  els.adminResetBtn.addEventListener("click", () => {
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
    cfg.NETWORK = DEFAULTS.NETWORK;
    cfg.TRONSCAN_BASE = DEFAULTS.TRONSCAN_BASE;
    cfg.TOKEN_ADDRESS = DEFAULTS.TOKEN_ADDRESS;
    TOKEN_ABI = DEFAULT_TOKEN_ABI;
    populateAdminInputs();
    updateAdminCurrent();
    toast("Reset to config.js defaults", "info");
    if (state.tronWeb && state.address) {
      initContracts().then(refresh).catch(() => {});
    }
  });

  updateAdminCurrent();

  // React to TronLink account/chain changes.
  window.addEventListener("message", (ev) => {
    if (!ev.data || !ev.data.message) return;
    const m = ev.data.message;
    if (m.action === "accountsChanged" || m.action === "setAccount") {
      if (window.tronWeb && window.tronWeb.ready) {
        state.tronWeb = window.tronWeb;
        state.address = state.tronWeb.defaultAddress.base58;
        els.connectBtn.textContent = shortAddr(state.address);
        els.statAddress.textContent = state.address;
        initContracts().then(refresh);
      }
    }
  });

  // Silent auto-connect if TronLink is already unlocked.
  (async function autoConnect() {
    const ok = await detectTronLink(2000);
    if (ok && window.tronWeb && window.tronWeb.ready) {
      state.tronWeb = window.tronWeb;
      state.address = state.tronWeb.defaultAddress.base58;
      els.connectBtn.textContent = shortAddr(state.address);
      els.statAddress.textContent = state.address;
      await initContracts();
      await refresh();
      startAutoRefresh();
    }
  })();
})();
