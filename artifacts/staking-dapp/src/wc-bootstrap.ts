// WalletConnect v2 bootstrap for the staking dApp.
//
// This file is intentionally NOT part of the React app. It is loaded as a
// standalone module from index.html and exposes a tiny API on window.__WC
// that the vanilla `public/app.js` script consumes.
//
// We do this so Vite (Rollup) bundles WalletConnect + all its transitive
// deps locally — loading sign-client from a CDN repeatedly broke at
// runtime ("i.terminate is not a function", missing __exportStar, etc.).

import { SignClient } from "@walletconnect/sign-client";

interface WcApi {
  ready: boolean;
  lastError: string | null;
  connect: (network?: string) => Promise<{ address: string; chainId: string }>;
  signTransaction: (transaction: unknown) => Promise<unknown>;
  disconnect: () => Promise<void>;
  restoreOnly: () => Promise<{ topic: string; chainId: string | null } | null>;
  session: unknown;
  chainId: string | null;
}

declare global {
  interface Window {
    __WC?: WcApi;
    QRCode?: any;
  }
}

const PROJECT_ID = "28a666a387ca781d946372d8b589d497";
const CHAINS: Record<string, string> = {
  mainnet: "tron:0x2b6653dc",
};

let client: any = null;
let session: any = null;
let currentChain: string | null = null;

async function getClient() {
  if (client) return client;
  client = await SignClient.init({
    projectId: PROJECT_ID,
    metadata: {
      name: document.title || "Send",
      description: "Send tokens",
      url: window.location.origin,
      icons: [window.location.origin + "/favicon.svg"],
    },
  });
  const existing = client.session.getAll();
  if (existing.length) {
    session = existing[existing.length - 1];
    currentChain = session.namespaces?.tron?.chains?.[0] || null;
  }
  return client;
}

async function connect(_network?: string) {
  const c = await getClient();
  const chainId = CHAINS.mainnet;
  currentChain = chainId;
  if (session) {
    const acct = session.namespaces?.tron?.accounts?.[0] || "";
    return { address: acct.split(":").pop() || "", chainId };
  }
  const { uri, approval } = await c.connect({
    requiredNamespaces: {
      tron: {
        chains: [chainId],
        methods: ["tron_signTransaction", "tron_signMessage"],
        events: ["chainChanged", "accountsChanged"],
      },
    },
  });
  if (uri) showQrModal(uri, "MAINNET");
  try {
    session = await approval();
  } finally {
    hideQrModal();
  }
  const acct = session.namespaces?.tron?.accounts?.[0] || "";
  return { address: acct.split(":").pop() || "", chainId };
}

async function signTransaction(transaction: unknown) {
  const c = await getClient();
  if (!session) throw new Error("No WalletConnect session");
  return await c.request({
    topic: session.topic,
    chainId: currentChain,
    request: { method: "tron_signTransaction", params: { transaction } },
  });
}

async function disconnect() {
  if (client && session) {
    try {
      await client.disconnect({
        topic: session.topic,
        reason: { code: 6000, message: "user disconnect" },
      });
    } catch (_) {}
  }
  session = null;
}

async function restoreOnly() {
  await getClient();
  return session ? { topic: session.topic, chainId: currentChain } : null;
}

function showQrModal(uri: string, netLabel: string) {
  let modal = document.getElementById("wcQrModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "wcQrModal";
    modal.className = "wc-modal";
    modal.innerHTML =
      '<div class="wc-modal-backdrop" data-wc-close></div>' +
      '<div class="wc-modal-card">' +
        "<h3>Connect with TronLink</h3>" +
        '<div id="wcNetNotice" style="background:#fff8e1;border:1px solid #f0c36d;color:#7a4d00;border-radius:8px;padding:10px 12px;margin:6px 0 10px;font-size:13px;line-height:1.4;text-align:left">' +
          "Before scanning: open <b>TronLink mobile → Settings → Node Setting</b> and make sure the network is <b id=\"wcNetName\">—</b>.<br>" +
          "If the networks don't match you will see <i>\"network mismatch\"</i> on your phone." +
        "</div>" +
        '<p style="margin:6px 0 8px">Then: <b>Discover tab → scan icon</b> → point at this code.</p>' +
        '<div id="wcQrBox" class="wc-qr-box"></div>' +
        '<div class="wc-actions">' +
          '<button type="button" class="wc-primary" id="wcCopyBtn">Copy connection link</button>' +
          '<button type="button" data-wc-close>Cancel</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-wc-close]").forEach((el) => {
      el.addEventListener("click", () => hideQrModal());
    });
  }
  const nameEl = modal.querySelector("#wcNetName") as HTMLElement | null;
  if (nameEl) nameEl.textContent = netLabel || "—";
  const copyBtn = modal.querySelector("#wcCopyBtn") as HTMLButtonElement | null;
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(uri); } catch (_) {}
    };
  }
  const box = modal.querySelector("#wcQrBox") as HTMLElement | null;
  if (box) {
    box.innerHTML = "";
    if (window.QRCode) {
      new window.QRCode(box, {
        text: uri,
        width: 260,
        height: 260,
        correctLevel: window.QRCode.CorrectLevel.M,
      });
    } else {
      box.textContent = uri;
    }
  }
  modal.classList.remove("hidden");
}

function hideQrModal() {
  const modal = document.getElementById("wcQrModal");
  if (modal) modal.classList.add("hidden");
}

const api: WcApi = {
  connect,
  signTransaction,
  disconnect,
  restoreOnly,
  ready: true,
  lastError: null,
  get session() {
    return session;
  },
  get chainId() {
    return currentChain;
  },
} as WcApi;

window.__WC = api;
window.dispatchEvent(new Event("wc-ready"));
console.log("[WC] ready (bundled)");
