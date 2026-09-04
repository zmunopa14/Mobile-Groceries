import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, TrendingUp, Users, AlertTriangle, Plus, Minus, LogOut,
  Church, Wallet, FileText, ChevronRight, Box, X, Check, Delete, RefreshCw, Search, Pencil, ShoppingCart, Send, Menu
} from "lucide-react";

// ============================================================
// 1. CONNECT TO SUPABASE
//    Easiest: set these in Vercel as environment variables
//    (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) — no code editing.
//    Or just paste your two values directly between the quotes below.
//    Find them in Supabase → Project Settings → API.
// ============================================================
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "YOUR-ANON-KEY";

// Tiny REST client (no SDK needed — works inside an artifact)
export const sb = {
  async rpc(fn, args) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = "Request failed";
      try { msg = JSON.parse(text).message || msg; } catch {}
      throw new Error(msg);
    }
    return text ? JSON.parse(text) : null;
  },
  async select(table, query = "") {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!r.ok) throw new Error("Could not load " + table);
    return r.json();
  },
  async insert(table, row) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error((await r.json()).message || "Insert failed");
    return r.json();
  },
  async patch(table, query, row) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error("Update failed");
    return r.json();
  },
  async del(table, query) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!r.ok) {
      let msg = "Delete failed";
      try { msg = (await r.json()).message || msg; } catch {}
      throw new Error(msg);
    }
  },
  // Upload a file to the 'receipts' storage bucket, return its public URL
  async uploadReceipt(file) {
    const ext = (file.name && file.name.split(".").pop()) || "jpg";
    const path = `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": file.type || "image/jpeg",
      },
      body: file,
    });
    if (!r.ok) throw new Error("Photo upload failed");
    return `${SUPABASE_URL}/storage/v1/object/public/receipts/${path}`;
  },
};

// ============================================================
// OFFLINE STORE
//  - Caches products & sales so the app opens with no internet.
//  - Queues sales made offline; flushes them when back online.
//  Uses localStorage (works in the real app & Android; not in the
//  artifact sandbox preview — that's expected).
// ============================================================
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
};
const cacheKey = (biz, what) => `pamusika:${biz}:${what}`;

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

// Pending offline sales, per business
function getPending(biz) { return store.get(cacheKey(biz, "pending"), []); }
function setPending(biz, list) { store.set(cacheKey(biz, "pending"), list); }
function queueSale(biz, sale) {
  const list = getPending(biz);
  list.push(sale);
  setPending(biz, list);
}

// Send all queued sales to the server. Returns how many synced.
async function flushPending(biz) {
  if (!isOnline()) return 0;
  let list = getPending(biz);
  if (list.length === 0) return 0;
  const remaining = [];
  let synced = 0;
  for (const sale of list) {
    try {
      try {
        await sb.rpc("record_invoice", {
          p_items: sale.items, p_seller: sale.seller,
          p_customer: sale.customer || null, p_phone: sale.phone || null, p_sold_at: sale.soldAt || null,
        });
      } catch (e) {
        // A genuine backdate that fails must stay queued, not silently get
        // recorded dated "now" instead — same rule as the immediate-checkout
        // path. Only sales with no requested date fall back to the older
        // (pre-migration) call shape.
        if (sale.soldAt) throw e;
        await sb.rpc("record_invoice", {
          p_items: sale.items, p_seller: sale.seller,
          p_customer: sale.customer || null, p_phone: sale.phone || null,
        });
      }
      synced++;
    } catch {
      remaining.push(sale); // keep it to retry later
    }
  }
  setPending(biz, remaining);
  return synced;
}

const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
export const money = (n) => "$" + Number(n || 0).toFixed(2);
// Unit price shown with full precision (trims trailing zeros): 0.475 -> $0.475
export const priceFmt = (n) => {
  const num = Number(n || 0);
  let s = num.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (!s.includes(".")) s = num.toFixed(2);
  return "$" + s;
};

// Stock is counted in packs; pack_size is shown as a label only
function stockLabel(p) {
  const n = p.qty;
  return `${n} pack${n === 1 ? "" : "s"}`;
}
function packNote(p) {
  const ps = p.pack_size || 1;
  return ps > 1 ? `pack of ${ps}` : "";
}

function filterProducts(products, search) {
  const q = search.trim().toLowerCase();
  const list = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : [...products];
  return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// Parse a pasted price list into products.
function parsePriceList(text) {
  const out = [];
  const lines = text.split("\n");
  for (let raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (/^[*_].*[*_]$/.test(line)) continue; // *Category* headers
    if (/^-\s*\w/.test(line) && !/[\d.]|out of stock/i.test(line)) continue; // sub-headers like "- Noodles"
    line = line.replace(/^[-•*]\s*/, "");

    const m = line.split(/\s[–-]\s/);
    if (m.length < 2) continue;
    const price = m.slice(1).join(" - ").trim();
    let name = m[0].trim();

    const outOfStock = /out\s*of\s*stock/i.test(price);
    let packSize = 1;
    const packMatch = (name + " " + price).match(/(\d+)\s*pack/i);
    if (packMatch) packSize = parseInt(packMatch[1]) || 1;

    let dollars = 0;
    if (!outOfStock) {
      const pm = price.match(/([\d]+(?:\.[\d]+)?)/);
      dollars = pm ? parseFloat(pm[1]) : 0;
    }
    out.push({ name, price: dollars, pack_size: packSize, qty: 0, outOfStock });
  }
  return out;
}

// Build a list of past customers (most recent phone per name) from sales
function customerHistory(sales) {
  const map = {};
  sales.forEach((s) => {
    const name = (s.customer_name || "").trim();
    if (!name) return;
    if (!map[name]) map[name] = { name, phone: s.customer_phone || "", at: s.sold_at };
    else if (new Date(s.sold_at) > new Date(map[name].at)) {
      map[name] = { name, phone: s.customer_phone || map[name].phone, at: s.sold_at };
    }
  });
  return Object.values(map);
}

// Pick a fun grocery emoji based on the product name
function emojiFor(name) {
  const n = (name || "").toLowerCase();
  const map = [
    [["water", "aqua"], "💧"], [["juice", "cascade", "orange", "mazoe", "drink", "cordial"], "🧃"],
    [["soda", "coke", "fanta", "sprite", "cola", "fizzy"], "🥤"], [["milk", "lacto", "yog"], "🥛"],
    [["bread", "loaf", "buns"], "🍞"], [["snack", "chip", "crisp", "maputi", "popcorn"], "🍿"],
    [["biscuit", "cookie"], "🍪"], [["sweet", "candy", "lolli"], "🍬"], [["choc"], "🍫"],
    [["sugar"], "🧂"], [["salt"], "🧂"], [["rice"], "🍚"], [["mealie", "maize", "meal", "flour"], "🌽"],
    [["egg"], "🥚"], [["cooking oil", "oil"], "🛢️"], [["soap", "detergent", "washing"], "🧼"],
    [["tea", "coffee"], "☕"], [["beans"], "🫘"], [["tomato"], "🍅"], [["apple"], "🍎"],
    [["banana"], "🍌"], [["meat", "beef", "chicken"], "🍗"], [["fish"], "🐟"], [["salt"], "🧂"],
  ];
  for (const [keys, emo] of map) if (keys.some((k) => n.includes(k))) return emo;
  return "🛒";
}

// ============================================================
// 2. ROOT
// ============================================================
// ============================================================
// SUBSCRIPTION: pay screen (locked) + owner approval screen
// ============================================================
function PayScreen({ user, businessName, onExit, onSubmitted }) {
  const [method, setMethod] = useState("ecocash"); // "ecocash" | "cash"
  const [ref, setRef] = useState("");
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const openEcocash = () => { window.location.href = `tel:${encodeURIComponent("*151#")}`; };
  const submit = async () => {
    if (!ref.trim()) {
      alert(method === "ecocash" ? "Please enter the EcoCash confirmation reference." : "Please enter who you gave the cash to (for the record).");
      return;
    }
    setBusy(true);
    try {
      try {
        await sb.insert("payments", {
          business_id: user.business_id, amount: WEEKLY_PRICE * weeks,
          reference: ref.trim(), weeks, status: "pending", method,
        });
      } catch {
        // `method` column may not exist yet on older deployments
        await sb.insert("payments", {
          business_id: user.business_id, amount: WEEKLY_PRICE * weeks,
          reference: ref.trim(), weeks, status: "pending",
        });
      }
      setSent(true); onSubmitted();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <div style={S.loginDarkShell}>
      <div style={{ ...S.loginCard, position: "relative", zIndex: 1, maxWidth: 400 }}>
        <div style={S.logoMark}><Wallet size={24} strokeWidth={2.4} /></div>
        <h1 style={{ ...S.loginTitle, fontSize: 28 }}>Subscription due</h1>
        <p style={S.loginSub}>{businessName}, your access is paused until this week’s payment is confirmed.</p>

        {sent ? (
          <div style={{ ...S.card, flexDirection: "column", alignItems: "stretch", textAlign: "center", padding: 18 }}>
            <div style={{ fontSize: 34 }}>⏳</div>
            <div style={{ fontWeight: 800, marginTop: 6 }}>Payment submitted</div>
            <p style={S.hint}>We’ve received your reference and it’s waiting to be approved. You’ll get access as soon as it’s confirmed. Try signing in again shortly.</p>
            <button style={{ ...S.btn, ...S.btnGhost, width: "100%" }} onClick={onExit}>Back to sign in</button>
          </div>
        ) : (
          <>
            <div style={{ ...S.cartTotalRow, marginBottom: 12 }}>
              <span>Weekly fee</span><span>${WEEKLY_PRICE.toFixed(2)}</span>
            </div>
            <label style={S.fieldWrap}>
              <span style={S.fieldLabel}>Weeks paying for</span>
              <select style={S.inputDark} value={weeks} onChange={(e) => setWeeks(parseInt(e.target.value))}>
                {[1,2,3,4].map((w) => <option key={w} value={w}>{w} week{w>1?"s":""} — ${(WEEKLY_PRICE*w).toFixed(2)}</option>)}
              </select>
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button style={{ ...S.btn, flex: 1, ...(method === "ecocash" ? S.btnGold : S.btnGhost) }} onClick={() => setMethod("ecocash")}>EcoCash</button>
              <button style={{ ...S.btn, flex: 1, ...(method === "cash" ? S.btnGold : S.btnGhost) }} onClick={() => setMethod("cash")}>Cash</button>
            </div>
            {method === "ecocash" ? (
              <>
                <div style={{ textAlign: "left", marginBottom: 12 }}>
                  <div style={S.fieldLabel}>How to pay with EcoCash</div>
                  <ol style={{ ...S.hint, paddingLeft: 18, lineHeight: 1.6 }}>
                    <li>Send <b style={{ color: goldLt }}>${(WEEKLY_PRICE * weeks).toFixed(2)}</b> to <b style={{ color: goldLt }}>{ECOCASH_NUMBER}</b></li>
                    <li>Copy the EcoCash confirmation reference (from the SMS)</li>
                    <li>Paste it below and tap Submit</li>
                  </ol>
                </div>
                <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 8 }} onClick={openEcocash}>Open EcoCash (*151#)</button>
                <label style={S.fieldWrap}>
                  <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>EcoCash reference</span>
                  <input style={S.inputDark} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. MP12345678" />
                </label>
              </>
            ) : (
              <>
                <p style={{ ...S.hint, marginTop: 0 }}>
                  Pay <b style={{ color: goldLt }}>${(WEEKLY_PRICE * weeks).toFixed(2)}</b> cash to whoever collects it for Pamusika, then note who you gave it to below.
                </p>
                <label style={S.fieldWrap}>
                  <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>Given to</span>
                  <input style={S.inputDark} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. Tapiwa, at the market" />
                </label>
              </>
            )}
            <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginTop: 6 }} disabled={busy || !ref.trim()} onClick={submit}>
              {busy ? "Submitting…" : "Submit payment"}
            </button>
            <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={onExit}>Sign out</button>
          </>
        )}
      </div>
    </div>
  );
}

function PendingApprovalScreen({ businessName, onExit, onRefresh }) {
  return (
    <div style={S.loginDarkShell}>
      <div style={{ ...S.loginCard, position: "relative", zIndex: 1, maxWidth: 400 }}>
        <div style={S.logoMark}><PamusikaMark size={30} /></div>
        <h1 style={{ ...S.loginTitle, fontSize: 28 }}>Almost there</h1>
        <p style={S.loginSub}>
          <b style={{ color: goldLt }}>{businessName}</b> is registered but still waiting to be approved. This
          only takes a moment — try again shortly.
        </p>
        <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginBottom: 8 }} onClick={onRefresh}>
          <RefreshCw size={16} /> Check again
        </button>
        <button style={{ ...S.btn, ...S.btnGhost, width: "100%" }} onClick={onExit}>Sign out</button>
      </div>
    </div>
  );
}

function OwnerScreen({ user, businesses, onExit, onChange }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setPayments(await sb.select("payments", "order=created_at.desc&limit=200")); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const bizName = (id) => (businesses.find((b) => b.id === id) || {}).name || `Business ${id}`;
  const approve = async (id) => {
    setBusy(true);
    try { await sb.rpc("approve_payment", { p_id: id }); await load(); onChange(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const reject = async (id) => {
    setBusy(true);
    try { await sb.patch("payments", `id=eq.${id}`, { status: "rejected" }); await load(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const pending = payments.filter((p) => p.status === "pending");
  const pendingBiz = businesses.filter((b) => b.approved === false);

  const approveBiz = async (id) => {
    setBusy(true);
    try { await sb.patch("businesses", `id=eq.${id}`, { approved: true }); onChange(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const rejectBiz = async (id) => {
    if (!window.confirm("Permanently remove this business and its account? This can't be undone.")) return;
    setBusy(true);
    try {
      await sb.del("members", `business_id=eq.${id}`);
      await sb.del("businesses", `id=eq.${id}`);
      onChange();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <div style={S.shell}>
      <Header title="Owner" sub="Payment approvals" onExit={onExit} onRefresh={load} />
      <div style={S.body}>
        {pendingBiz.length > 0 && <>
          <SectionTitle>Pending businesses</SectionTitle>
          <p style={S.hint}>New self-registered businesses waiting to be let in — approve them, or reject to remove a throwaway account.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {pendingBiz.map((b) => (
              <div key={b.id} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <div style={{ flex: 1 }}><div style={S.cardName}>{b.name}</div></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ ...S.btn, ...S.btnDark, flex: 1 }} disabled={busy} onClick={() => approveBiz(b.id)}><Check size={16} /> Approve</button>
                  <button style={{ ...S.btn, ...S.btnGhost, flex: 1, color: "#FF8B7A" }} disabled={busy} onClick={() => rejectBiz(b.id)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </>}

        <SectionTitle>Businesses</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {businesses.filter((b) => b.id !== 0).map((b) => {
            const until = b.paid_until ? new Date(b.paid_until) : null;
            const active = until && until.getTime() > Date.now();
            return (
              <div key={b.id} style={S.card}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>{b.name}</div>
                  <div style={S.cardMeta}>{until ? `Paid until ${until.toLocaleDateString()}` : "No subscription set"}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: active ? accent : "#FF8B7A" }}>{active ? "Active" : "Expired"}</span>
              </div>
            );
          })}
        </div>

        <SectionTitle>Pending payments</SectionTitle>
        {loading && <Loading />}
        {!loading && pending.length === 0 && <p style={S.empty}>No payments waiting for approval.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pending.map((p) => (
            <div key={p.id} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>{bizName(p.business_id)} · ${Number(p.amount).toFixed(2)}</div>
                  <div style={S.cardMeta}>Ref: {p.reference} · {p.weeks} week{p.weeks>1?"s":""} · {new Date(p.created_at).toLocaleString()}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...S.btn, ...S.btnDark, flex: 1 }} disabled={busy} onClick={() => approve(p.id)}><Check size={16} /> Approve</button>
                <button style={{ ...S.btn, ...S.btnGhost, flex: 1, color: "#FF8B7A" }} disabled={busy} onClick={() => reject(p.id)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Same approvals OwnerScreen has (new businesses, subscription payments),
// but embedded as a normal tab inside one specific business's own account
// (Munonwa/Pamusika) instead of a separate standalone "owner" login —
// whoever has is_platform_owner on their member row sees this tab. An
// approved payment credits this business's own revenue under a "Pamusika"
// category (same mechanism as B2B reseller reports), and a receipt is sent
// as a direct message straight to the paying business.
function ApprovalsTab({ businessId, businessName }) {
  const [payments, setPayments] = useState([]);
  const [pendingBiz, setPendingBiz] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pays, biz] = await Promise.all([
        sb.select("payments", "status=eq.pending&order=created_at.desc&limit=200"),
        sb.select("businesses", "select=id,name,approved&order=id.asc").catch(() => []),
      ]);
      setPayments(pays);
      setPendingBiz((biz || []).filter((b) => b.approved === false));
      const ids = [...new Set(pays.map((p) => p.business_id))];
      if (ids.length) {
        const bizzes = await sb.select("businesses", `id=in.(${ids.join(",")})&select=id,name`);
        const map = {}; bizzes.forEach((b) => { map[b.id] = b.name; });
        setNames(map);
      }
    } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (p) => {
    setBusy(true);
    try {
      await sb.rpc("approve_payment", { p_id: p.id });
      const payerName = names[p.business_id] || `Business ${p.business_id}`;

      await ensureCategoryExists(businessId, "Pamusika");
      const weekStartDay = await fetchReportWeekStartDay(businessId);
      const { startStr, endStr } = currentWeekRange(weekStartDay);
      await creditPaymentRevenue({
        receivingBusinessId: businessId, fromBusinessId: p.business_id, fromBusinessName: payerName,
        weekStart: startStr, weekEnd: endStr, amount: Number(p.amount),
      });

      const receipt = [
        `Receipt from ${businessName}`,
        `Payment approved: ${money(p.amount)}`,
        `${p.weeks} week${p.weeks > 1 ? "s" : ""} · ${p.method === "cash" ? "Cash" : "EcoCash"}${p.reference ? ` (${p.reference})` : ""}`,
        `Approved ${new Date().toLocaleString()}`,
      ].join("\n");
      try { await sendOrderRequestMessage(businessId, p.business_id, businessId, receipt); } catch {}

      await load();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  const reject = async (id) => {
    setBusy(true);
    try { await sb.patch("payments", `id=eq.${id}`, { status: "rejected" }); await load(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const approveBiz = async (id) => {
    setBusy(true);
    try { await sb.patch("businesses", `id=eq.${id}`, { approved: true }); await load(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const rejectBiz = async (id) => {
    if (!window.confirm("Permanently remove this business and its account? This can't be undone.")) return;
    setBusy(true);
    try {
      await sb.del("members", `business_id=eq.${id}`);
      await sb.del("businesses", `id=eq.${id}`);
      await load();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  if (loading) return <Loading />;

  return (
    <>
      <SectionTitle>Pending businesses</SectionTitle>
      <p style={S.hint}>New self-registered businesses waiting to be let in — approve them, or reject to remove a throwaway account.</p>
      {pendingBiz.length === 0 && <p style={S.empty}>Nothing waiting.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {pendingBiz.map((b) => (
          <div key={b.id} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div style={{ flex: 1 }}><div style={S.cardName}>{b.name}</div></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.btn, ...S.btnDark, flex: 1 }} disabled={busy} onClick={() => approveBiz(b.id)}><Check size={16} /> Approve</button>
              <button style={{ ...S.btn, ...S.btnGhost, flex: 1, color: "#FF8B7A" }} disabled={busy} onClick={() => rejectBiz(b.id)}>Reject</button>
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>Pending payments</SectionTitle>
      <p style={S.hint}>Approving credits the amount to {businessName}'s own revenue under a "Pamusika" category, and sends the business a receipt.</p>
      {payments.length === 0 && <p style={S.empty}>No payments waiting for approval.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {payments.map((p) => (
          <div key={p.id} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{names[p.business_id] || `Business ${p.business_id}`} · {money(p.amount)}</div>
              <div style={S.cardMeta}>
                {p.method === "cash" ? "Cash" : "EcoCash"}{p.reference ? ` · ${p.reference}` : ""} · {p.weeks} week{p.weeks > 1 ? "s" : ""} · {new Date(p.created_at).toLocaleString()}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.btn, ...S.btnDark, flex: 1 }} disabled={busy} onClick={() => approve(p)}><Check size={16} /> Approve</button>
              <button style={{ ...S.btn, ...S.btnGhost, flex: 1, color: "#FF8B7A" }} disabled={busy} onClick={() => reject(p.id)}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const WEEKLY_PRICE = 2;                 // US$ per week — change here if needed
const ECOCASH_NUMBER = "+263 78 734 8881";

export default function App() {
  const [user, setUser] = useState(null);
  const [bizList, setBizList] = useState([]); // full business rows incl paid_until
  const [sellMode, setSellMode] = useState(false); // admin temporarily selling
  const [tick, setTick] = useState(0); // force re-check after payment approval

  const loadBiz = useCallback(async () => {
    try { setBizList(await sb.select("businesses", "select=id,name,paid_until,approved&order=id.asc")); }
    catch {
      // `approved` column may not exist yet on older deployments — fall
      // back to unblocked (every business behaves as already-approved).
      try { setBizList((await sb.select("businesses", "select=id,name,paid_until&order=id.asc")).map((b) => ({ ...b, approved: true }))); }
      catch {}
    }
  }, []);
  useEffect(() => { loadBiz(); }, [loadBiz, user, tick]);

  const bizNames = {};
  bizList.forEach((b) => { bizNames[b.id] = b.name; });

  if (!configured) return <SetupNotice />;
  if (!user) return <AuthEntry onLogin={setUser} />;

  const businessName = bizNames[user.business_id] || `Business ${user.business_id}`;

  // Owner (super) login → payment approvals across all businesses
  if (user.role === "owner") {
    return <OwnerScreen user={user} businesses={bizList} onExit={() => setUser(null)} onChange={() => setTick((t) => t + 1)} />;
  }

  const biz = bizList.find((b) => b.id === user.business_id);

  // A newly self-registered business waits for the Owner to approve it —
  // stops someone just spinning up throwaway accounts. Existing businesses
  // are unaffected (they default to already-approved).
  if (biz && biz.approved === false) {
    return <PendingApprovalScreen businessName={businessName} onExit={() => setUser(null)} onRefresh={() => setTick((t) => t + 1)} />;
  }

  // Subscription gate: if this business's paid_until has passed, lock with pay
  // screen — UNLESS this specific user is exempt (e.g. Munopa).
  const paidUntil = biz && biz.paid_until ? new Date(biz.paid_until) : null;
  const isPaid = paidUntil ? paidUntil.getTime() > Date.now() : true; // if unknown, don't lock
  if (bizList.length > 0 && !isPaid && !user.exempt) {
    return <PayScreen user={user} businessName={businessName} onExit={() => setUser(null)} onSubmitted={() => setTick((t) => t + 1)} />;
  }

  // Admin who tapped "Make a sale" → show the full selling screen, with a way back
  if (user.role === "admin" && sellMode) {
    return <Seller user={user} businessName={businessName} sellMode onExit={() => setSellMode(false)} />;
  }
  return user.role === "admin"
    ? <Admin user={user} businessName={businessName} onExit={() => setUser(null)} onSell={() => setSellMode(true)} paidUntil={paidUntil} />
    : <Seller user={user} businessName={businessName} onExit={() => setUser(null)} />;
}

// Distinctive brand mark used inside the gold badge — a stacked-diamond
// emblem (three facets rising into one point), echoing the premium
// fintech-style reference look rather than the earlier "P under a roof".
export function PamusikaMark({ size = 26 }) {
  // "P" monogram with a gold-diamond counter — reads clearly even at
  // small (header-badge) sizes, unlike a generic gem/hexagon shape.
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="11" y="7" width="6" height="34" rx="3" fill="#0c241d" />
      <path d="M17 7 H27 A11 11 0 0 1 27 29 H17 Z" fill="#0c241d" />
      <path d="M27 12 L34.5 18 L27 24 L19.5 18 Z" fill="#E6C44D" />
    </svg>
  );
}

// ============================================================
// 3. AUTH ENTRY — full-bleed photo front door: Sign in or Register
// ============================================================
function AuthEntry({ onLogin }) {
  const [mode, setMode] = useState(null); // null | "signin" | "register"

  if (mode === "signin") return <Login onLogin={onLogin} onBack={() => setMode(null)} />;
  if (mode === "register") return <RegisterBusiness onLogin={onLogin} onBack={() => setMode(null)} />;

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <div style={{
        position: "fixed", inset: 0, backgroundColor: darkbg,
        backgroundImage: "url(/login-hero.jpg)", backgroundSize: "88%", backgroundRepeat: "no-repeat",
        backgroundPosition: "center 15%",
      }} />
      <div style={{
        position: "fixed", inset: 0,
        background: "linear-gradient(180deg, rgba(7,22,15,0.1) 0%, rgba(7,22,15,0.3) 45%, rgba(7,22,15,0.94) 88%)",
      }} />
      <div style={{
        position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column",
        justifyContent: "flex-end", padding: 20, boxSizing: "border-box",
      }}>
        <div style={{ ...S.loginCard, maxWidth: 420, width: "100%" }}>
          <div style={S.logoMark}><PamusikaMark size={30} /></div>
          <h1 style={S.loginTitle}>Pamusika</h1>
          <p style={S.loginSub}>Smart, simple stock and sales for your business.</p>
          <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginBottom: 10 }} onClick={() => setMode("signin")}>
            Sign in
          </button>
          <button style={{ ...S.btn, ...S.btnGhost, width: "100%" }} onClick={() => setMode("register")}>
            Register a new business
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 3b. REGISTER — create a new business and become its admin
// ============================================================
function RegisterBusiness({ onLogin, onBack }) {
  const [bizName, setBizName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!bizName.trim() || !ownerName.trim()) { setErr("Please fill in every field."); return; }
    if (pin.length < 4) { setErr("PIN must be at least 4 digits."); return; }
    if (pin !== pin2) { setErr("The PINs don't match."); return; }
    setBusy(true);
    try {
      const rows = await sb.rpc("register_business", {
        p_business_name: bizName.trim(), p_owner_name: ownerName.trim(), p_pin: pin,
      });
      if (rows && rows.length) onLogin(rows[0]);
      else setErr("Something went wrong. Please try again.");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div style={S.loginDarkShell}>
      <MarketWatermark />
      <div style={{ ...S.loginCard, position: "relative", zIndex: 1 }}>
        <div style={S.logoMark}><PamusikaMark size={30} /></div>
        <h1 style={S.loginTitle}>Register</h1>
        <p style={S.loginSub}>Set up your business — you'll be its admin.</p>
        <div style={S.fieldWrap}>
          <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>Business name</span>
          <input style={S.inputDark} value={bizName} autoFocus onChange={(e) => setBizName(e.target.value)}
            placeholder="e.g. Samah Valley" />
        </div>
        <div style={S.fieldWrap}>
          <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>Your name</span>
          <input style={S.inputDark} value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Your name" />
        </div>
        <div style={S.fieldWrap}>
          <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>PIN (4 digits)</span>
          <input style={S.inputDark} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric" placeholder="••••" />
        </div>
        <div style={S.fieldWrap}>
          <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>Type it again</span>
          <input style={S.inputDark} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric" placeholder="••••" />
        </div>
        {err && <p style={S.errTxt}>{err}</p>}
        <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginTop: 10 }}
          disabled={busy || !bizName.trim() || !ownerName.trim() || pin.length < 4}
          onClick={submit}>
          {busy ? "Creating…" : "Create business"}
        </button>
        <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={onBack}>
          ← Back
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 4. LOGIN (two-step: business name, then name + PIN)
// ============================================================
function Login({ onLogin, onBack }) {
  const [step, setStep] = useState(1);
  const [bizInput, setBizInput] = useState("");
  const [biz, setBiz] = useState(null); // {id, name}
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const findBiz = async () => {
    setErr(""); setBusy(true);
    try {
      const rows = await sb.rpc("find_business", { p_name: bizInput.trim() });
      if (rows && rows.length) { setBiz(rows[0]); setStep(2); }
      else setErr("We couldn't find that business name. Check the spelling.");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const rows = await sb.rpc("login_in_business", { p_name: name.trim(), p_pin: pin, p_business_id: biz.id });
      if (rows && rows.length) onLogin(rows[0]);
      else setErr("Name or PIN is incorrect for this business.");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div style={S.loginDarkShell}>
      <MarketWatermark />
      <div style={{ ...S.loginCard, position: "relative", zIndex: 1 }}>
        <HeroImage />
        <div style={S.logoMark}><PamusikaMark size={30} /></div>
        <h1 style={S.loginTitle}>Pamusika</h1>

        {step === 1 ? (
          <>
            <p style={S.loginSub}>Enter your business name to begin.</p>
            <div style={S.fieldWrap}>
              <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>Business name</span>
              <input style={S.inputDark} value={bizInput} autoFocus
                onChange={(e) => setBizInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && bizInput.trim()) findBiz(); }}
                placeholder="e.g. Samah Valley" />
            </div>
            {err && <p style={S.errTxt}>{err}</p>}
            <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginTop: 10 }}
              disabled={busy || !bizInput.trim()} onClick={findBiz}>
              {busy ? "Checking…" : "Continue"}
            </button>
            {onBack && (
              <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 10 }} onClick={onBack}>
                ← Back
              </button>
            )}
          </>
        ) : (
          <>
            <p style={S.loginSub}>Welcome to <b style={{ color: goldLt }}>{biz.name}</b>. Enter your name and PIN.</p>
            <div style={S.fieldWrap}>
              <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>Name</span>
              <input style={S.inputDark} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div style={S.fieldWrap}>
              <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>PIN</span>
              <PinDots value={pin} />
            </div>
            <Keypad value={pin} onChange={setPin} dark />
            {err && <p style={S.errTxt}>{err}</p>}
            <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginTop: 10 }}
              disabled={busy || !name.trim() || pin.length < 4} onClick={submit}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }}
              onClick={() => { setStep(1); setBiz(null); setName(""); setPin(""); setErr(""); }}>
              ← Different business
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PinDots({ value }) {
  return (
    <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "8px 0" }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ ...S.pinDot, ...(i < value.length ? S.pinDotFull : {}) }} />
      ))}
    </div>
  );
}

function Keypad({ value, onChange, dark }) {
  const press = (k) => {
    if (k === "del") onChange(value.slice(0, -1));
    else if (value.length < 4) onChange(value + k);
  };
  return (
    <div style={S.keypad}>
      {["1","2","3","4","5","6","7","8","9","","0","del"].map((k, i) =>
        k === "" ? <div key={i} /> :
        <button key={i} style={{ ...S.key, ...(dark ? S.keyDark : {}) }} onClick={() => press(k)}>
          {k === "del" ? <Delete size={18} /> : k}
        </button>
      )}
    </div>
  );
}

// ============================================================
// 4. SHARED DATA HOOK
// ============================================================
function useData(businessId) {
  const [products, setProducts] = useState(() => store.get(cacheKey(businessId, "products"), []));
  const [sales, setSales] = useState(() => store.get(cacheKey(businessId, "sales"), []));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(isOnline());
  const [pending, setPendingCount] = useState(getPending(businessId).length);

  const refresh = useCallback(async () => {
    // First, try to push up anything queued while offline
    if (isOnline()) {
      try { await flushPending(businessId); } catch {}
    }
    setPendingCount(getPending(businessId).length);

    try {
      setError("");
      const bizFilter = `business_id=eq.${businessId}&`;
      // LOW-DATA: only fetch the last ~120 days of sales by default. This covers
      // daily operation plus weekly/Tuesday/compare reports, and is far smaller
      // than pulling the whole history every time. (Older data can be loaded on
      // demand later if we add a "load older" button.)
      const cutoff = new Date(Date.now() - 120 * 86400000).toISOString();
      const [p, s] = await Promise.all([
        sb.select("products", `${bizFilter}order=created_at.asc`),
        sb.select("sales", `${bizFilter}sold_at=gte.${cutoff}&order=sold_at.desc&limit=4000`),
      ]);
      setProducts(p); setSales(s);
      store.set(cacheKey(businessId, "products"), p);
      store.set(cacheKey(businessId, "sales"), s);
      setOnline(true);
    } catch (e) {
      // Offline or server unreachable: keep showing cached data
      setOnline(false);
      const cachedP = store.get(cacheKey(businessId, "products"), []);
      const cachedS = store.get(cacheKey(businessId, "sales"), []);
      if (cachedP.length) setProducts(cachedP);
      if (cachedS.length) setSales(cachedS);
      setError(""); // don't alarm; offline is handled gracefully
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
    // LOW-DATA: refresh once a minute (was every 8s), and only while the app is
    // actually on screen — no data is used when it's in the background.
    let t = null;
    const start = () => { if (!t) t = setInterval(() => { if (isOnline()) refresh(); }, 60000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { refresh(); start(); } };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    const goOnline = () => { setOnline(true); refresh(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refresh]);

  return { products, sales, loading, error, refresh, online, pending, setPendingCount };
}

// ============================================================
// 5. ADMIN
// ============================================================
export function Admin({ user, onExit, businessName, onSell }) {
  const { products, sales, loading, error, refresh } = useData(user.business_id);
  const [tab, setTab] = useState("overview");
  const [cats, setCats] = useState([]);   // this business's category names
  const [hasIncomingOrders, setHasIncomingOrders] = useState(false);
  const [reportWeekday, setReportWeekday] = useState(2); // 0=Sun..6=Sat, default Tuesday
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => { fetchReportWeekStartDay(user.business_id).then(setReportWeekday); }, [user.business_id]);
  useEffect(() => {
    let cancelled = false;
    const check = () => fetchUnreadMessageCount(user.business_id).then((n) => { if (!cancelled) setUnreadMessages(n); });
    check();
    const t = setInterval(check, 20000); // floating badge — no need for tighter than this
    return () => { cancelled = true; clearInterval(t); };
  }, [user.business_id]);
  const openMessages = () => {
    setTab("community");
    markMessagesRead(user.business_id).catch(() => {});
    setUnreadMessages(0);
  };
  useEffect(() => {
    sb.select("members", `id=eq.${user.id}&select=is_platform_owner`)
      .then((rows) => setIsPlatformOwner(!!(rows[0] && rows[0].is_platform_owner)))
      .catch(() => setIsPlatformOwner(false)); // column may not exist yet on older deployments
  }, [user.id]);
  const reportTabLabel = reportWeekday === 2 ? "Tuesday report" : "Weekly report";

  const loadCats = useCallback(async () => {
    try {
      const rows = await sb.select("categories", `business_id=eq.${user.business_id}&order=name.asc`);
      setCats(rows.map((r) => r.name));
    } catch { setCats([]); }
  }, [user.business_id]);
  useEffect(() => { loadCats(); }, [loadCats]);

  // The "Orders" (incoming) tab only appears once this business is someone's
  // agent — either they've already ordered, or they've just linked us as
  // their supplier and haven't ordered yet (so they can still be messaged
  // first). Most shops are never anyone's agent, so it stays hidden for them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, links] = await Promise.all([
          sb.select("order_requests", `supplier_business_id=eq.${user.business_id}&select=id&limit=1`),
          sb.select("business_supplier_links", `supplier_business_id=eq.${user.business_id}&select=business_id&limit=1`).catch(() => []),
        ]);
        if (!cancelled) setHasIncomingOrders(rows.length > 0 || links.length > 0);
      } catch { /* table may not exist yet on older deployments — fail quiet */ }
    })();
    return () => { cancelled = true; };
  }, [user.business_id]);

  const totalSales = sales.reduce((a, x) => a + Number(x.total), 0);
  const totalTithe = sales.reduce((a, x) => a + Number(x.tithe), 0);
  const cash = totalSales - totalTithe;
  // Overview shows TODAY only (resets at midnight). Full history still powers
  // the Tuesday report and Compare tab.
  const todayStr = localDateStr(new Date());
  const todaySales = sales.filter((s) => localDateStr(new Date(s.sold_at)) === todayStr);
  const daySales = todaySales.reduce((a, x) => a + Number(x.total), 0);
  const dayTithe = todaySales.reduce((a, x) => a + Number(x.tithe), 0);
  const dayCash = daySales - dayTithe;
  const low = products.filter((p) => p.qty <= p.low_at && p.qty > 0);
  const out = products.filter((p) => p.qty <= 0);

  const deleteSale = async (s) => {
    const label = s.invoice_no ? `invoice ${s.invoice_no} (all its items)` : `this sale of ${s.product_name}`;
    if (!window.confirm(`Remove ${label}? The stock will be returned to inventory.`)) return;
    try {
      if (s.invoice_no) await sb.rpc("delete_invoice", { p_invoice_no: s.invoice_no });
      else await sb.rpc("delete_sale", { p_sale_id: s.id });
      await refresh();
    } catch (e) { alert(e.message); }
  };

  const alerts = (
    <>
      {error && <div style={S.alert}><AlertTriangle size={16} /> {error}</div>}
      {out.length > 0 && (
        <div style={{ ...S.alert, background: "#FFE2E2", color: "#C0392B" }}>
          <AlertTriangle size={16} />
          <span><b>{out.length}</b> item{out.length > 1 ? "s have" : " has"} sold out (or oversold) — restock when you can.</span>
        </div>
      )}
      {low.length > 0 && (
        <div style={S.alert}>
          <AlertTriangle size={16} />
          <span><b>{low.length}</b> item{low.length > 1 ? "s" : ""} running low — time to reorder.</span>
        </div>
      )}
    </>
  );

  return (
    <>
    {unreadMessages > 0 && tab !== "community" && (
      <button onClick={openMessages} style={S.floatingMsgBtn} title="New messages">
        <Send size={20} />
        <span style={S.floatingMsgBadge}>{unreadMessages > 9 ? "9+" : unreadMessages}</span>
      </button>
    )}
    <AppShell
      title={businessName} subtitle={`${user.name} · Admin`} icon={<PamusikaMark size={20} />}
      tab={tab} setTab={setTab}
      items={[
        ["overview","Overview"],["stock","Stock"],["transactions","Sales"],["order","Order"],
        ...(hasIncomingOrders ? [["supplierOrders","Orders"]] : []),
        ["community","Community"],
        ["customers","Customers"],["compare","Compare"],["cashups","Cash-ups"],["report",reportTabLabel],["team","Team"],
        ...(isPlatformOwner ? [["approvals","Approvals"]] : []),
      ]}
      onExit={onExit} onRefresh={refresh}
      decoration={<LightWatermark />}
      alerts={alerts}
    >
      {loading ? <Loading /> : <>
        {tab === "overview" && <>
          {onSell && (
            <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginBottom: 14 }} onClick={onSell}>
              <ShoppingCart size={18} /> Make a sale
            </button>
          )}
          <div className="pk-statgrid" style={S.statGrid}>
            <Stat icon={<TrendingUp size={16} />} label="Sales today" value={money(daySales)} accent delay={0} />
            <Stat icon={<Wallet size={16} />} label="Cash today" value={money(dayCash)} tint={mango} delay={0.05} />
            <Stat icon={<Church size={16} />} label="To God today" value={money(dayTithe)} tint={grape} delay={0.1} />
            <Stat icon={<Package size={16} />} label="Items in stock" value={products.reduce((a,p)=>a+p.qty,0)} tint={sky} delay={0.15} />
          </div>
          <SectionTitle>Today's sales</SectionTitle>
          <p style={S.hint}>Tap the ✕ to remove a sale — its stock is returned automatically.</p>
          <SalesList sales={todaySales.slice(0,30)} showSeller onDelete={deleteSale} showTithe />
        </>}
        {tab === "stock" && <StockManager products={products} onChange={refresh} businessId={user.business_id} cats={cats} onCatsChange={loadCats} />}
        {tab === "transactions" && <Transactions sales={sales} products={products} businessId={user.business_id} onChange={refresh} onDeleteSale={deleteSale} cats={cats} user={user} />}
        {tab === "order" && <OrderList products={products} sales={sales} businessName={businessName} businessId={user.business_id} />}
        {tab === "supplierOrders" && <OrdersInbox businessId={user.business_id} />}
        {tab === "community" && <CommunityChat businessId={user.business_id} businessName={businessName} />}
        {tab === "customers" && <Customers sales={sales} />}
        {tab === "compare" && <Compare sales={sales} />}
        {tab === "cashups" && <CashUps businessId={user.business_id} sales={sales} />}
        {tab === "report" && <Report sales={sales} products={products} low={[...out, ...low]} cats={cats} businessId={user.business_id} businessName={businessName}
          weekStartDay={reportWeekday} onWeekStartDayChange={setReportWeekday} />}
        {tab === "team" && <TeamManager onChange={refresh} businessId={user.business_id} sales={sales} user={user} />}
        {tab === "approvals" && <ApprovalsTab businessId={user.business_id} businessName={businessName} />}
      </>}
    </AppShell>
    </>
  );
}

// ============================================================
// 6. SELLER
// ============================================================
export function Seller({ user, onExit, businessName, sellMode }) {
  const { products, sales, loading, error, refresh, online, pending, setPendingCount } = useData(user.business_id);
  const [toast, setToast] = useState("");
  const [adding, setAdding] = useState(null);   // product being added to cart
  const cartKey = cacheKey(user.business_id, `cart:${user.name}`);
  const [cart, setCart] = useState(() => {
    // Restore an in-progress basket after an accidental logout
    const saved = store.get(cartKey, []);
    return Array.isArray(saved) ? saved : [];
  });          // [{product, units}]
  const [showCart, setShowCart] = useState(false);
  const [receipt, setReceipt] = useState(null);  // completed invoice for sharing
  const [closingDay, setClosingDay] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const [search, setSearch] = useState("");
  // The seller's running total resets after each cash-up. We remember when they
  // Headline figures show TODAY's sales only — so they naturally reset at midnight.
  // Past days are never hidden: the transactions view and Close-day let you pick any date.
  // All sales stay in the database regardless.
  const mine = sales.filter((s) => s.seller_name === user.name);
  const todayStr = localDateStr(new Date());
  const today = mine.filter((s) => localDateStr(new Date(s.sold_at)) === todayStr);
  const myTotal = today.reduce((a, x) => a + Number(x.total), 0);
  const myCount = today.length;

  const addToCart = (product, units) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) return prev.map((c) => c.product.id === product.id ? { ...c, units: c.units + units } : c);
      return [...prev, { product, units }];
    });
    setAdding(null);
    setToast("Added to cart");
    setTimeout(() => setToast(""), 1200);
  };
  const removeFromCart = (id) => setCart((prev) => prev.filter((c) => c.product.id !== id));

  // Keep the basket saved on this phone so an accidental logout doesn't lose it
  useEffect(() => { store.set(cartKey, cart); }, [cart, cartKey]);

  // If a restored basket references products whose price/name changed, refresh them
  useEffect(() => {
    if (cart.length === 0 || products.length === 0) return;
    setCart((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        const fresh = products.find((p) => p.id === c.product.id);
        if (fresh && (fresh.price !== c.product.price || fresh.name !== c.product.name)) {
          changed = true; return { ...c, product: fresh };
        }
        return c;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const cartTotal = cart.reduce((a, c) => a + c.units * Number(c.product.price), 0);
  const cartCount = cart.reduce((a, c) => a + c.units, 0);

  const checkout = async ({ customer, phone, discount = 0, finalTotal, soldAt } = {}) => {
    if (cart.length === 0) return;
    const items = cart.map((c) => ({ product_id: c.product.id, qty: c.units }));
    const lines = cart.map((c) => ({
      name: c.product.name, units: c.units,
      price: Number(c.product.price), pack_size: c.product.pack_size || 1,
      total: c.units * Number(c.product.price),
    }));
    const baseReceipt = {
      when: soldAt ? new Date(soldAt) : new Date(), seller: user.name, business: businessName,
      customer: customer || "", phone: phone || "", lines,
      subtotal: cartTotal, discount: discount || 0,
      total: finalTotal != null ? finalTotal : cartTotal,
    };

    const saveOffline = () => {
      queueSale(user.business_id, { items, seller: user.name, customer, phone, soldAt, when: new Date().toISOString() });
      if (setPendingCount) setPendingCount(getPending(user.business_id).length);
      setReceipt({ ...baseReceipt, no: "PENDING", offline: true });
      setCart([]); setShowCart(false);
      setToast("Saved offline — will sync when online");
      setTimeout(() => setToast(""), 2500);
    };

    if (!isOnline()) { saveOffline(); return; }

    try {
      let inv;
      try {
        inv = await sb.rpc("record_invoice", {
          p_items: items, p_seller: user.name,
          p_customer: customer || null, p_phone: phone || null, p_sold_at: soldAt || null,
        });
      } catch (e) {
        if (soldAt) throw e; // a real backdate request failing shouldn't silently record it as "now"
        // `p_sold_at` may not exist yet on older deployments — same call without it
        inv = await sb.rpc("record_invoice", {
          p_items: items, p_seller: user.name,
          p_customer: customer || null, p_phone: phone || null,
        });
      }
      const invoiceNo = typeof inv === "string" ? inv : (inv && inv[0]) || "INV";
      setReceipt({ ...baseReceipt, no: invoiceNo });
      setCart([]); setShowCart(false);
      await refresh();
    } catch (e) {
      // Server unreachable mid-sale → fall back to offline queue instead of losing it
      saveOffline();
    }
  };

  const shown = filterProducts(products.filter((p) => !p.archived), search);
  // Seller is a single continuous flow (no tabs), so it doesn't get the
  // sidebar shell used by Admin/ChurchApp — on a wide viewport it just
  // widens its column and lets the product list flow into a grid instead
  // of a single stack (see .pk-shopgrid below).
  const isDesktop = useIsDesktop();

  return (
    <div style={{ ...S.shell, ...(isDesktop ? { maxWidth: 980 } : {}) }}>
      <LightWatermark />
      <Header title={user.name} sub={sellMode ? `${businessName} · Selling` : `${businessName} · Seller`} onExit={onExit} onRefresh={refresh} exitLabel={sellMode ? "Back to admin" : undefined} />
      {error && <div style={S.alert}><AlertTriangle size={16} /> {error}</div>}
      {!online && (
        <div style={{ ...S.alert, background: "#FFF1DA", color: "#B26A00" }}>
          <AlertTriangle size={16} />
          <span>Offline — sales are saved on this phone and will sync when you’re back online.</span>
        </div>
      )}
      {online && pending > 0 && (
        <div style={{ ...S.alert, background: "#EAF7EE", color: accent }}>
          <RefreshCw size={16} />
          <span>Syncing {pending} offline sale{pending > 1 ? "s" : ""}…</span>
        </div>
      )}
      <div style={S.body}>
        {loading ? <Loading /> : <>
          <div className="pk-statgrid" style={S.statGrid}>
            <Stat icon={<TrendingUp size={16} />} label="My sales today" value={money(myTotal)} accent />
            <button onClick={() => setShowTx(true)}
              style={{ ...S.stat, textAlign: "left", cursor: "pointer", border: `1px solid ${line}`, position: "relative" }}>
              <div style={S.statIcon}><FileText size={16} /></div>
              <div style={S.statLabel}>My transactions</div>
              <div style={S.statValue}>{myCount}</div>
              <span style={{ position: "absolute", right: 12, bottom: 12, fontSize: 11, color: accent, fontWeight: 700 }}>View ›</span>
            </button>
          </div>
          <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 4 }} onClick={() => setClosingDay(true)}>
            <FileText size={17} /> Close day &amp; submit cash-up
          </button>
          <SectionTitle>New sale</SectionTitle>
          <p style={S.hint}>Tap items to add to the basket, then check out as one receipt.</p>
          <SearchBar value={search} onChange={setSearch} />
          <div className="pk-shopgrid">
            {products.length === 0 && <p style={S.empty}>No products yet. Ask the admin to add stock.</p>}
            {products.length > 0 && shown.length === 0 && <p style={S.empty}>No products match “{search}”.</p>}
            {shown.map((p) => {
              const low = p.qty <= 0;
              const inCart = cart.find((c) => c.product.id === p.id);
              return (
                <div key={p.id} style={{ ...S.card, ...S.cardPop, ...(inCart ? S.cardInCart : {}) }}>
                  <div style={{ fontSize: 22, marginRight: 4 }}>{emojiFor(p.name)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={S.cardName}>{p.name}{inCart && <span style={S.cartBadge}>{inCart.units} in basket</span>}</div>
                    <div style={S.cardMeta}>
                      {priceFmt(p.price)}/pack · {low ? <span style={{ color: "#C0392B", fontWeight: 600 }}>out of stock</span> : stockLabel(p)}
                    </div>
                  </div>
                  <button style={S.sellBtn} onClick={() => setAdding(p)}>+ Add</button>
                </div>
              );
            })}
          </div>
        </>}
      </div>

      {showTx && (
        <Modal onClose={() => setShowTx(false)} title="🧾 My transactions">
          <p style={{ ...S.hint, marginTop: 0 }}>Showing today by default. Pick a date to see any past day.</p>
          <SellerInvoices sales={today} allSales={mine} businessName={businessName} sellerName={user.name}
            products={products} businessId={user.business_id} online={online} />
        </Modal>
      )}

      {/* floating basket button */}
      {cart.length > 0 && (
        <button style={S.cartFab} onClick={() => setShowCart(true)}>
          <ShoppingCart size={20} />
          <span style={S.cartFabCount}>{cartCount}</span>
          <span style={{ marginLeft: 6, fontWeight: 800 }}>{money(cartTotal)}</span>
        </button>
      )}

      {adding && <AddToCartModal product={adding} onClose={() => setAdding(null)} onAdd={addToCart} />}
      {showCart && (
        <CartModal cart={cart} total={cartTotal} customers={customerHistory(sales)} onClose={() => setShowCart(false)}
          onRemove={removeFromCart} onCheckout={checkout} />
      )}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
      {closingDay && (
        <CloseDayModal sales={mine} user={user} onClose={() => setClosingDay(false)}
          onSubmitted={() => {
            setClosingDay(false); setToast("Cash-up sent to admin"); setTimeout(() => setToast(""), 2400);
          }} />
      )}
      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

// Add-to-cart modal: packs only
function AddToCartModal({ product, onClose, onAdd }) {
  const [packs, setPacks] = useState("");
  const [warned, setWarned] = useState(false);
  const totalPacks = parseFloat(packs) || 0;
  const totalPrice = totalPacks * Number(product.price);
  const oversell = totalPacks > product.qty;

  const handleAdd = () => {
    if (totalPacks <= 0) return;
    if (oversell && !warned) { setWarned(true); return; }
    onAdd(product, totalPacks);
  };

  return (
    <Modal onClose={onClose} title={`${emojiFor(product.name)} ${product.name}`}>
      <p style={{ ...S.hint, marginTop: 0 }}>
        {priceFmt(product.price)} per pack{packNote(product) ? ` · ${packNote(product)}` : ""} · {stockLabel(product)} available
      </p>
      <Field label="Number of packs" value={packs} onChange={setPacks} type="number" placeholder="0" />
      <div style={S.sellSummary}>
        <span>{totalPacks} pack{totalPacks === 1 ? "" : "s"}</span>
        <span style={{ fontWeight: 800 }}>{money(totalPrice)}</span>
      </div>
      {oversell && warned && (
        <p style={{ ...S.hint, color: "#B26A00", marginBottom: 0 }}>
          This is more than the recorded stock. That's fine — the admin will be flagged to restock. Tap again to confirm.
        </p>
      )}
      <button style={{ ...S.btn, ...(oversell && warned ? S.btnWarn : S.btnDark), width: "100%", marginTop: 8 }}
        disabled={totalPacks <= 0} onClick={handleAdd}>
        <Plus size={18} /> {oversell && warned ? "Confirm & add anyway" : "Add to basket"}
      </button>
    </Modal>
  );
}

// Cart review + checkout
function CartModal({ cart, total, customers = [], onClose, onRemove, onCheckout }) {
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState("");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [showSug, setShowSug] = useState(false);
  const [discType, setDiscType] = useState("none"); // none | pct | flat
  const [discVal, setDiscVal] = useState("");
  const todayStr = localDateStr(new Date());
  const [saleDate, setSaleDate] = useState(todayStr); // lets a sale be entered for a day that's already passed

  const discNum = parseFloat(discVal) || 0;
  const discount = discType === "pct" ? total * Math.min(discNum, 100) / 100
                 : discType === "flat" ? Math.min(discNum, total)
                 : 0;
  const finalTotal = Math.max(0, total - discount);

  const go = async () => {
    setBusy(true);
    // Only sent when backdated — an unchanged today's date means the sale
    // is stamped with the actual current time server-side, same as before.
    const soldAt = saleDate === todayStr ? null : `${saleDate}T${new Date().toTimeString().slice(0, 8)}`;
    await onCheckout({ customer: customer.trim(), phone: phone.trim(), discount, finalTotal, soldAt });
    setBusy(false);
  };

  const recNum = parseFloat(received);
  const hasReceived = received !== "" && !isNaN(recNum);
  const change = hasReceived ? recNum - finalTotal : 0;
  const shortfall = hasReceived && change < 0;

  const q = customer.trim().toLowerCase();
  const suggestions = q
    ? customers.filter((c) => c.name.toLowerCase().includes(q) && c.name.toLowerCase() !== q).slice(0, 5)
    : [];
  const pick = (c) => { setCustomer(c.name); if (c.phone) setPhone(c.phone); setShowSug(false); };

  return (
    <Modal onClose={onClose} title="🧺 Basket">
      {cart.length === 0 && <p style={S.empty}>Basket is empty.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {cart.map((c) => (
          <div key={c.product.id} style={S.cartLine}>
            <div style={{ fontSize: 20 }}>{emojiFor(c.product.name)}</div>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{c.product.name}</div>
              <div style={S.cardMeta}>{c.units} × {priceFmt(c.product.price)}</div>
            </div>
            <div style={{ fontWeight: 800 }}>{money(c.units * Number(c.product.price))}</div>
            <button style={S.delBtn} onClick={() => onRemove(c.product.id)}><X size={16} /></button>
          </div>
        ))}
      </div>

      <div style={S.cartTotalRow}>
        <span>Subtotal</span>
        <span>{money(total)}</span>
      </div>

      <label style={{ ...S.fieldWrap, marginTop: 10 }}>
        <span style={S.fieldLabel}>Discount</span>
        <div style={{ display: "flex", gap: 8 }}>
          <select style={{ ...S.input, flex: 1 }} value={discType} onChange={(e) => setDiscType(e.target.value)}>
            <option value="none">No discount</option>
            <option value="pct">Percentage %</option>
            <option value="flat">Flat amount $</option>
          </select>
          {discType !== "none" && (
            <input style={{ ...S.input, width: 90 }} type="number" value={discVal}
              onChange={(e) => setDiscVal(e.target.value)} placeholder={discType === "pct" ? "10" : "5.00"} />
          )}
        </div>
      </label>
      {discount > 0 && (
        <div style={{ ...S.cartTotalRow, background: "rgba(230,196,77,0.12)" }}>
          <span>After discount (−{money(discount)})</span>
          <span>{money(finalTotal)}</span>
        </div>
      )}
      <label style={{ ...S.fieldWrap, marginTop: 10 }}>
        <span style={S.fieldLabel}>Sale date</span>
        <input style={S.input} type="date" value={saleDate} max={todayStr} onChange={(e) => setSaleDate(e.target.value)} />
        {saleDate !== todayStr && <p style={{ ...S.hint, marginTop: 4, marginBottom: 0 }}>Backdated to {new Date(saleDate + "T00:00:00").toLocaleDateString()}.</p>}
      </label>
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={S.fieldWrap}>
            <span style={S.fieldLabel}>Customer name</span>
            <input style={S.input} value={customer} placeholder="e.g. Mai Moyo"
              onChange={(e) => { setCustomer(e.target.value); setShowSug(true); }}
              onFocus={() => setShowSug(true)} />
          </label>
          {showSug && suggestions.length > 0 && (
            <div style={{ ...S.sugBox, position: "static", marginTop: 6, boxShadow: "none" }}>
              {suggestions.map((c) => (
                <button key={c.name} style={S.sugItem} onClick={() => pick(c)}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.phone && <span style={{ color: muted, fontSize: 12 }}>{c.phone}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="Phone" value={phone} onChange={setPhone} type="tel" placeholder="077…" />
      </div>
      <Field label="Amount received from customer ($)" value={received} onChange={setReceived} type="number" placeholder="0.00" />
      {hasReceived && (
        <div style={{ ...S.cartTotalRow, background: shortfall ? "rgba(192,57,43,0.18)" : "rgba(43,208,122,0.15)", color: shortfall ? "#FF8B7A" : accent }}>
          <span>{shortfall ? "Still owing" : "Change to give"}</span>
          <span>{money(Math.abs(change))}</span>
        </div>
      )}

      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 12 }}
        disabled={busy || cart.length === 0} onClick={go}>
        <Check size={18} /> {busy ? "Completing…" : "Complete sale"}
      </button>
    </Modal>
  );
}

// Receipt with share button
function ReceiptModal({ receipt, onClose }) {
  const text = receiptText(receipt);
  const cleanPhone = (receipt.phone || "").replace(/[^\d+]/g, "");
  const smsToCustomer = () => {
    const body = encodeURIComponent(text);
    window.location.href = `sms:${cleanPhone}?body=${body}`;
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `Receipt ${receipt.no}`, text });
      else { await navigator.clipboard.writeText(text); alert("Receipt copied — you can paste it into WhatsApp or SMS."); }
    } catch {}
  };
  // Build a real PDF file (jsPDF) for this receipt. jsPDF is loaded ON DEMAND
  // (only when a PDF button is tapped) so the app opens fast on mobile data.
  const makePdfBlob = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: [300, 500] });
    let y = 40;
    doc.setFontSize(16); doc.setFont(undefined, "bold");
    doc.text(receipt.business, 150, y, { align: "center" }); y += 20;
    doc.setFontSize(10); doc.setFont(undefined, "normal");
    doc.text(`Receipt ${receipt.no}`, 150, y, { align: "center" }); y += 14;
    doc.text(receipt.when.toLocaleString(), 150, y, { align: "center" }); y += 14;
    if (receipt.customer) { doc.text(`Customer: ${receipt.customer}${receipt.phone ? " · " + receipt.phone : ""}`, 150, y, { align: "center" }); y += 14; }
    y += 8; doc.line(20, y, 280, y); y += 16;
    doc.setFontSize(11);
    receipt.lines.forEach((l) => {
      doc.text(`${l.name} x${l.units}`, 20, y);
      doc.text(money(l.total), 280, y, { align: "right" }); y += 16;
    });
    if (receipt.discount > 0) {
      y += 4; doc.setTextColor(120);
      doc.text("Subtotal", 20, y); doc.text(money(receipt.subtotal), 280, y, { align: "right" }); y += 14;
      doc.text("Discount", 20, y); doc.text(`- ${money(receipt.discount)}`, 280, y, { align: "right" }); y += 14;
      doc.setTextColor(0);
    }
    y += 6; doc.line(20, y, 280, y); y += 20;
    doc.setFontSize(14); doc.setFont(undefined, "bold");
    doc.text("TOTAL", 20, y); doc.text(money(receipt.total), 280, y, { align: "right" }); y += 24;
    doc.setFontSize(9); doc.setFont(undefined, "normal"); doc.setTextColor(120);
    doc.text(`Served by ${receipt.seller}  ·  Thank you!`, 150, y, { align: "center" });
    return doc.output("blob");
  };

  const sendPdf = async () => {
    const blob = await makePdfBlob();
    const file = new File([blob], `Receipt-${receipt.no}.pdf`, { type: "application/pdf" });
    // Try native file share (this is what carries the PDF into WhatsApp)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Receipt ${receipt.no}` }); return; }
      catch { /* user cancelled or failed — fall through to save */ }
    }
    // Fallback: download the file so it can be attached manually
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Receipt-${receipt.no}.pdf`; a.click();
    URL.revokeObjectURL(url);
    alert("Your phone can’t share files directly here, so the PDF was saved to your downloads. Open WhatsApp and attach it from there.");
  };

  return (
    <Modal onClose={onClose} title="✅ Sale complete">
      <div style={S.receipt}>
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{receipt.business}</div>
          <div style={S.cardMeta}>Receipt {receipt.no}</div>
          <div style={S.cardMeta}>{receipt.when.toLocaleString()}</div>
        </div>
        <div style={S.receiptDivider} />
        {receipt.customer && (
          <div style={{ ...S.cardMeta, marginBottom: 6 }}>
            Customer: <b style={{ color: ink }}>{receipt.customer}</b>{receipt.phone ? ` · ${receipt.phone}` : ""}
          </div>
        )}
        {receipt.lines.map((l, i) => (
          <div key={i} style={S.receiptLine}>
            <span style={{ flex: 1 }}>{l.name} <span style={{ color: muted }}>×{l.units}</span></span>
            <span style={{ fontWeight: 700 }}>{money(l.total)}</span>
          </div>
        ))}
        <div style={S.receiptDivider} />
        {receipt.discount > 0 && <>
          <div style={S.receiptLine}><span style={{ flex: 1, color: muted }}>Subtotal</span><span>{money(receipt.subtotal)}</span></div>
          <div style={S.receiptLine}><span style={{ flex: 1, color: goldLt }}>Discount</span><span style={{ color: goldLt }}>− {money(receipt.discount)}</span></div>
        </>}
        <div style={{ ...S.receiptLine, fontWeight: 800, fontSize: 16 }}>
          <span style={{ flex: 1 }}>Total</span>
          <span>{money(receipt.total)}</span>
        </div>
        <div style={{ ...S.cardMeta, textAlign: "center", marginTop: 8 }}>Served by {receipt.seller}</div>
      </div>
      {cleanPhone && (
        <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 12 }} onClick={smsToCustomer}>
          <Send size={17} /> Text receipt to {receipt.customer || "customer"}
        </button>
      )}
      <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginTop: 8 }} onClick={sendPdf}>
        <FileText size={17} /> Send PDF (WhatsApp, email…)
      </button>
      <button style={{ ...S.btn, ...(cleanPhone ? S.btnGhost : S.btnGhost), width: "100%", marginTop: 8 }} onClick={share}>
        <Send size={17} /> Share another way
      </button>
      <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={onClose}>Done</button>
    </Modal>
  );
}

function receiptText(r) {
  const lines = r.lines.map((l) => `${l.name} x${l.units}  ${money(l.total)}`).join("\n");
  const cust = r.customer ? `\nCustomer: ${r.customer}${r.phone ? ` (${r.phone})` : ""}` : "";
  const disc = r.discount > 0 ? `\nSubtotal: ${money(r.subtotal)}\nDiscount: -${money(r.discount)}` : "";
  return `${r.business}\nReceipt ${r.no}\n${r.when.toLocaleString()}${cust}\n\n${lines}${disc}\n\nTOTAL: ${money(r.total)}\nServed by ${r.seller}\nThank you!`;
}

// Seller's own invoices — tappable, opens the receipt to review
function SellerInvoices({ sales, allSales, businessName, sellerName, products, businessId, online }) {
  const [view, setView] = useState(null);
  const [prodQ, setProdQ] = useState("");
  const [fromQ, setFromQ] = useState("");
  const [toQ, setToQ] = useState("");

  const inRange = (when) => {
    const d = localDateStr(new Date(when));
    if (fromQ && d < fromQ) return false;
    if (toQ && d > toQ) return false;
    return true;
  };

  // Default view = sales since last cash-up. When a date filter is set, search
  // the full history (allSales) so older days can still be looked up.
  const source = (fromQ || toQ) ? (allSales || sales) : sales;
  let invoices = groupByInvoice(source);

  // Pending offline sales made by this seller on this phone → show as PENDING
  const pendingList = getPending(businessId).filter((s) => s.seller === sellerName);
  const pendingInvoices = pendingList.map((s, idx) => {
    const lines = s.items.map((it) => {
      const p = (products || []).find((pp) => pp.id === it.product_id);
      const price = p ? Number(p.price) : 0;
      return { product_name: p ? p.name : "Item", qty: it.qty, total: price * it.qty };
    });
    return {
      key: `pending-${idx}`, invoice_no: null, pending: true,
      when: s.when || new Date().toISOString(),
      customer: s.customer || "", phone: s.phone || "",
      lines, total: lines.reduce((a, l) => a + l.total, 0),
    };
  });

  let all = [...pendingInvoices, ...invoices];

  // Product summary (my own sales of that product, over the date range)
  let prodSummary = null;
  if (prodQ.trim()) {
    const q = prodQ.trim().toLowerCase();
    let units = 0, total = 0, count = 0;
    all.forEach((inv) => {
      if (!inRange(inv.when)) return;
      inv.lines.forEach((l) => {
        if ((l.product_name || "").toLowerCase().includes(q)) {
          units += Number(l.qty); total += Number(l.total); count += 1;
        }
      });
    });
    prodSummary = { units, total, count };
  }

  all = all.filter((inv) => inRange(inv.when));
  if (prodQ.trim()) {
    const q = prodQ.trim().toLowerCase();
    all = all.filter((inv) => inv.lines.some((l) => (l.product_name || "").toLowerCase().includes(q)));
  }
  const filtering = prodQ.trim() || fromQ || toQ;
  const shown = filtering ? all : all.slice(0, 30);

  const openReceipt = (inv) => setView({
    no: inv.pending ? "PENDING" : (inv.invoice_no || "—"),
    offline: inv.pending,
    when: new Date(inv.when),
    seller: sellerName,
    business: businessName,
    customer: inv.customer, phone: inv.phone,
    lines: inv.lines.map((l) => ({ name: l.product_name, units: l.qty, total: Number(l.total) })),
    total: inv.total,
  });

  return (
    <>
      <div style={S.searchWrap}>
        <Search size={16} style={{ color: muted, flexShrink: 0 }} />
        <input style={S.searchInput} value={prodQ} placeholder="Search a product…" onChange={(e) => setProdQ(e.target.value)} />
        {prodQ && <button style={S.searchClear} onClick={() => setProdQ("")}><X size={15} /></button>}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <label style={{ ...S.fieldWrap, flex: 1, marginBottom: 0 }}>
          <span style={S.fieldLabel}>From</span>
          <input style={S.input} type="date" value={fromQ} onChange={(e) => setFromQ(e.target.value)} />
        </label>
        <label style={{ ...S.fieldWrap, flex: 1, marginBottom: 0 }}>
          <span style={S.fieldLabel}>To</span>
          <input style={S.input} type="date" value={toQ} onChange={(e) => setToQ(e.target.value)} />
        </label>
      </div>
      {(fromQ || toQ) && <button style={{ ...S.btn, ...S.btnGhost, padding: "8px 12px", marginBottom: 10 }} onClick={() => { setFromQ(""); setToQ(""); }}>Clear dates</button>}
      {!online && <p style={{ ...S.hint, color: "#B26A00" }}>Offline — showing sales saved on this phone. Older synced sales appear once you’re back online.</p>}

      {prodSummary && (
        <div style={{ ...S.cartTotalRow, marginBottom: 10 }}>
          <span>“{prodQ.trim()}” — {prodSummary.units} pack{prodSummary.units === 1 ? "" : "s"}</span>
          <span>{money(prodSummary.total)}</span>
        </div>
      )}

      {shown.length === 0 && <p style={S.empty}>{filtering ? "No sales match." : "No sales yet."}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map((inv) => (
          <button key={inv.key} style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => openReceipt(inv)}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>
                {inv.customer || "No name"}{" "}
                {inv.pending
                  ? <span style={{ ...S.invTag, background: "#FFF1DA", color: "#B26A00" }}>pending</span>
                  : inv.invoice_no && <span style={S.invTag}>{inv.invoice_no}</span>}
              </div>
              <div style={S.cardMeta}>
                {new Date(inv.when).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                {" · "}{inv.lines.length} item{inv.lines.length > 1 ? "s" : ""}
              </div>
            </div>
            <div style={S.saleName}>{money(inv.total)}</div>
          </button>
        ))}
      </div>
      {view && <ReceiptModal receipt={view} onClose={() => setView(null)} />}
    </>
  );
}

// Day-end cash-up: seller reviews today's sales, enters cash, submits to admin
function CloseDayModal({ sales, user, onClose, onSubmitted }) {
  const todayStr = localDateStr(new Date());
  const [day, setDay] = useState(todayStr);
  const [cash, setCash] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [expenses, setExpenses] = useState([]); // {amount, note, photo_url}
  const [addingExp, setAddingExp] = useState(false);
  const [sinceTime, setSinceTime] = useState(null);   // cutoff: last cash-up time for this day
  const [priorCount, setPriorCount] = useState(0);    // how many cash-ups already done this day

  // When the chosen day changes, find the most recent cash-up already submitted
  // for this seller+day. Only sales AFTER that time count for the new cash-up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await sb.select("day_reports",
          `business_id=eq.${user.business_id}&seller_name=eq.${encodeURIComponent(user.name)}&report_date=eq.${day}&order=created_at.desc`);
        if (cancelled) return;
        setPriorCount(rows.length);
        setSinceTime(rows.length > 0 ? rows[0].created_at : null);
      } catch { if (!cancelled) { setSinceTime(null); setPriorCount(0); } }
    })();
    return () => { cancelled = true; };
  }, [day, user.business_id, user.name]);

  const dayInvoices = groupByInvoice(
    sales.filter((s) =>
      localDateStr(new Date(s.sold_at)) === day &&
      (!sinceTime || new Date(s.sold_at) > new Date(sinceTime))
    )
  );
  const salesTotal = dayInvoices.reduce((a, inv) => a + inv.total, 0);
  const expensesTotal = expenses.reduce((a, e) => a + Number(e.amount || 0), 0);
  const expectedCash = salesTotal - expensesTotal;
  const cashNum = parseFloat(cash);
  const hasCash = cash !== "" && !isNaN(cashNum);
  const diff = hasCash ? cashNum - expectedCash : 0;

  const submit = async () => {
    setBusy(true);
    try {
      await sb.insert("day_reports", {
        business_id: user.business_id,
        seller_name: user.name,
        report_date: day,
        sales_total: salesTotal,
        cash_in_hand: hasCash ? cashNum : 0,
        tx_count: dayInvoices.length,
        note: note.trim() || null,
        expenses: expenses,
        expenses_total: expensesTotal,
        confirmed: false,
      });
      onSubmitted();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="📋 Close day">
      <div style={{ ...S.fieldWrap }}>
        <span style={S.fieldLabel}>Day</span>
        <input style={S.input} type="date" value={day} max={todayStr} onChange={(e) => setDay(e.target.value)} />
      </div>
      {priorCount > 0 && (
        <p style={{ ...S.hint, color: mango, marginTop: 0 }}>
          You already did {priorCount} cash-up{priorCount > 1 ? "s" : ""} for this day. This one covers only sales made since then.
        </p>
      )}
      <div style={S.cartTotalRow}>
        <span>{priorCount > 0 ? "New sales since last cash-up" : "Sales total"} ({dayInvoices.length})</span>
        <span>{money(salesTotal)}</span>
      </div>

      <SectionTitle>Money spent (raw materials etc.)</SectionTitle>
      <p style={S.hint}>Add anything you paid for out of the cash, with a photo of the receipt.</p>
      {expenses.map((e, i) => (
        <div key={i} style={{ ...S.cartLine, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={S.cardName}>{money(e.amount)}</div>
            <div style={S.cardMeta}>{e.note || "expense"}{e.photo_url ? " · 📎 receipt" : ""}</div>
          </div>
          <button style={S.delBtn} onClick={() => setExpenses((prev) => prev.filter((_, j) => j !== i))}><X size={16} /></button>
        </div>
      ))}
      <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 6 }} onClick={() => setAddingExp(true)}>
        <Plus size={17} /> Add an expense
      </button>
      {expensesTotal > 0 && (
        <div style={{ ...S.cartTotalRow, background: "rgba(245,166,35,0.15)", color: mango }}>
          <span>Total spent</span><span>− {money(expensesTotal)}</span>
        </div>
      )}

      <SectionTitle>Cash</SectionTitle>
      <div style={S.cartTotalRow}>
        <span>Expected cash (sales − spent)</span>
        <span>{money(expectedCash)}</span>
      </div>
      <Field label="Actual cash in hand ($)" value={cash} onChange={setCash} type="number" placeholder="0.00" />
      {hasCash && (
        <div style={{ ...S.cartTotalRow, background: Math.abs(diff) < 0.005 ? "rgba(43,208,122,0.15)" : "rgba(245,166,35,0.15)", color: diff < -0.005 ? "#FF8B7A" : accent }}>
          <span>{diff < -0.005 ? "Short by" : diff > 0.005 ? "Over by" : "Matches exactly"}</span>
          <span>{Math.abs(diff) < 0.005 ? "✓" : money(Math.abs(diff))}</span>
        </div>
      )}
      <Field label="Note for admin (optional)" value={note} onChange={setNote} placeholder="e.g. gave 2 on credit" />

      <SectionTitle>Today's transactions</SectionTitle>
      {dayInvoices.length === 0 && <p style={S.empty}>No sales recorded for this day.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
        {dayInvoices.map((inv) => (
          <div key={inv.key} style={S.saleRow}>
            <div style={{ flex: 1 }}>
              <div style={S.saleName}>{inv.customer || "No name"}</div>
              <div style={S.cardMeta}>{inv.lines.length} item{inv.lines.length > 1 ? "s" : ""} · {new Date(inv.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <div style={S.saleName}>{money(inv.total)}</div>
          </div>
        ))}
      </div>

      <button style={{ ...S.btn, ...S.btnDark, width: "100%" }} disabled={busy || dayInvoices.length === 0} onClick={submit}>
        <Check size={18} /> {busy ? "Submitting…" : "Submit to admin"}
      </button>

      {addingExp && (
        <AddExpenseModal onClose={() => setAddingExp(false)}
          onAdd={(exp) => { setExpenses((prev) => [...prev, exp]); setAddingExp(false); }} />
      )}
    </Modal>
  );
}

// Add one expense: photo (optional) → OCR suggests amount → user confirms
function AddExpenseModal({ onClose, onAdd }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [reading, setReading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [suggested, setSuggested] = useState(null);

  const onPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Upload for the admin to see
    setUploading(true);
    try { const url = await sb.uploadReceipt(file); setPhotoUrl(url); }
    catch (err) { alert(err.message); }
    setUploading(false);
    // Try to read the amount (suggestion only)
    setReading(true);
    try {
      const guess = await readAmountFromImage(file);
      if (guess != null) { setSuggested(guess); if (!amount) setAmount(String(guess)); }
    } catch {}
    setReading(false);
  };

  return (
    <Modal onClose={onClose} title="Add expense">
      <label style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 10, cursor: "pointer" }}>
        📷 {uploading ? "Uploading…" : "Photo of receipt"}
        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onPhoto} />
      </label>
      {photoUrl && <img src={photoUrl} alt="receipt" style={{ width: "100%", borderRadius: 10, marginBottom: 10, maxHeight: 200, objectFit: "cover" }} />}
      {reading && <p style={{ ...S.hint, color: accent }}>Reading the receipt…</p>}
      {suggested != null && <p style={S.hint}>Suggested amount from photo: <b>{money(suggested)}</b> — please check it matches the receipt.</p>}

      <Field label="Amount spent ($)" value={amount} onChange={setAmount} type="number" placeholder="0.00" />
      <Field label="What was it for?" value={note} onChange={setNote} placeholder="e.g. sugar, packaging" />
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 4 }}
        disabled={!amount || isNaN(parseFloat(amount))}
        onClick={() => onAdd({ amount: parseFloat(amount), note: note.trim(), photo_url: photoUrl })}>
        <Check size={18} /> Add expense
      </button>
    </Modal>
  );
}

export function localDateStr(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Load Tesseract.js (OCR) from CDN once, on demand
let _tesseractPromise = null;
function loadTesseract() {
  if (_tesseractPromise) return _tesseractPromise;
  _tesseractPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error("Could not load the receipt reader."));
    document.head.appendChild(s);
  });
  return _tesseractPromise;
}

// Read a receipt image and guess the total amount (largest money-like number).
// Always returned as a SUGGESTION for the user to confirm — never trusted blindly.
async function readAmountFromImage(file) {
  const Tesseract = await loadTesseract();
  const { data } = await Tesseract.recognize(file, "eng");
  const text = (data && data.text) || "";
  // Find money-like numbers, e.g. 12.50, 1,250.00, $9.99
  const matches = text.match(/\d[\d,]*\.\d{2}/g) || [];
  const nums = matches.map((m) => parseFloat(m.replace(/,/g, ""))).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  // Heuristic: the total is usually the largest amount on the receipt
  return Math.max(...nums);
}

// ============================================================
// 7. STOCK MANAGER (admin)
// ============================================================
// Tappable stock number — type the exact quantity, saves on Enter or when you tap away
function StockEditor({ product, onSet }) {
  const [open, setOpen] = useState(false);
  const box = Math.max(1, product.order_box || 1);

  return (
    <>
      <button onClick={() => setOpen(true)} title="Tap to change stock"
        style={{ minWidth: 62, padding: "8px 6px", borderRadius: 10, border: `1px solid ${line}`,
          background: "rgba(255,255,255,0.06)", color: ink, fontWeight: 800, fontSize: 16, cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <span>{product.qty}</span>
        <span style={{ fontSize: 9, color: muted, fontWeight: 600 }}>tap to edit</span>
      </button>
      {open && <StockEditPopup product={product} box={box} onSet={onSet} onClose={() => setOpen(false)} />}
    </>
  );
}

function StockEditPopup({ product, box, onSet, onClose }) {
  const [exact, setExact] = useState(String(product.qty));
  const [addUnits, setAddUnits] = useState("");
  const [addBoxes, setAddBoxes] = useState("");

  const doSet = () => { const n = parseFloat(exact); if (!isNaN(n)) { onSet(n); onClose(); } };
  const doAddUnits = () => {
    const n = parseFloat(addUnits);
    if (!isNaN(n) && n !== 0) { onSet(Number(product.qty) + n); onClose(); }
  };
  const doAddBoxes = () => {
    const n = parseFloat(addBoxes);
    if (!isNaN(n) && n !== 0) { onSet(Number(product.qty) + n * box); onClose(); }
  };

  return (
    <Modal onClose={onClose} title={product.name}>
      <p style={{ ...S.hint, marginTop: 0 }}>Currently <b style={{ color: ink }}>{product.qty}</b> in stock.</p>

      <SectionTitle>Add to stock</SectionTitle>
      <p style={S.hint}>Got a delivery? Add to what’s there — no need to work out the new total.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input style={{ ...S.input, flex: 1 }} type="number" inputMode="decimal" value={addUnits}
          placeholder="Add units (e.g. 5)" onChange={(e) => setAddUnits(e.target.value)} />
        <button style={{ ...S.btn, ...S.btnDark }} disabled={!addUnits} onClick={doAddUnits}>Add</button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...S.input, flex: 1 }} type="number" inputMode="decimal" value={addBoxes}
          placeholder={`Add boxes${box > 1 ? ` (×${box} each)` : ""}`} onChange={(e) => setAddBoxes(e.target.value)} />
        <button style={{ ...S.btn, ...S.btnDark }} disabled={!addBoxes} onClick={doAddBoxes}>Add</button>
      </div>
      {box <= 1 && <p style={{ ...S.hint, marginTop: 6 }}>Tip: set this product’s “order box size” in its edit screen so a box adds the right number of units.</p>}

      <SectionTitle>Or set the exact number</SectionTitle>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...S.input, flex: 1 }} type="number" inputMode="decimal" value={exact}
          onChange={(e) => setExact(e.target.value)} />
        <button style={{ ...S.btn, ...S.btnGhost }} onClick={doSet}>Set</button>
      </div>
    </Modal>
  );
}

// Left slide-out menu for switching product categories + stock actions
function CategorySidebar({ open, onClose, current, onPick, counts, cats = [], onAdd, onBulk, onSelectSupplier, onManageCats }) {
  if (!open) return null;
  const items = ["All", ...cats];
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 70, display: "flex" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 270, maxWidth: "82%", height: "100%", background: "#0f2c22", borderRight: `1px solid ${line}`,
          padding: "22px 16px", boxShadow: "8px 0 30px rgba(0,0,0,0.5)", animation: "slideIn 0.2s ease", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <span style={{ fontWeight: 800, fontSize: 18, color: goldLt }}>Categories</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: ink, cursor: "pointer", padding: 4 }}><X size={20} /></button>
        </div>
        {cats.length === 0 && <p style={{ ...S.hint, marginTop: 0 }}>No categories yet. Tap “Manage categories” to add your own.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((c) => {
            const active = current === c;
            return (
              <button key={c} onClick={() => onPick(c)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                  padding: "13px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                  border: active ? `1px solid ${goldLt}` : `1px solid ${line}`,
                  background: active ? "rgba(230,196,77,0.15)" : "rgba(255,255,255,0.04)",
                  color: ink, fontWeight: active ? 800 : 600, fontSize: 15 }}>
                <span>{c === "All" ? "All products" : c}</span>
                <span style={{ color: muted, fontSize: 12 }}>{counts[c] ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div style={{ fontWeight: 800, fontSize: 13, color: goldLt, textTransform: "uppercase", letterSpacing: "0.05em", margin: "22px 0 10px" }}>Actions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {onAdd && <button style={{ ...S.btn, ...S.btnGold, width: "100%" }} onClick={onAdd}><Plus size={17} /> Add product</button>}
          {onBulk && <button style={{ ...S.btn, ...S.btnGhost, width: "100%" }} onClick={onBulk}><FileText size={16} /> Bulk add from list</button>}
          {onSelectSupplier && <button style={{ ...S.btn, ...S.btnGhost, width: "100%" }} onClick={onSelectSupplier}><Check size={16} /> Select products → assign supplier</button>}
          {onManageCats && <button style={{ ...S.btn, ...S.btnGhost, width: "100%" }} onClick={onManageCats}><Pencil size={15} /> Manage categories</button>}
        </div>
      </div>
    </div>
  );
}

// Manage this business's category names
function ManageCategories({ businessId, cats = [], onClose, onChange }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try { await sb.insert("categories", { business_id: businessId, name: n }); setName(""); await onChange(); }
    catch (e) { alert(e.message.includes("duplicate") ? "That category already exists." : e.message); }
    setBusy(false);
  };
  const remove = async (c) => {
    setBusy(true);
    const enc = encodeURIComponent(c);
    try {
      await sb.del("categories", `business_id=eq.${businessId}&name=eq.${enc}`);
      // Clean up anything set up for this category elsewhere (salary %,
      // a link to another business) so nothing dangling is left behind.
      await sb.del("business_salary_categories", `business_id=eq.${businessId}&category=eq.${enc}`).catch(() => {});
      await sb.del("category_business_links", `business_id=eq.${businessId}&category=eq.${enc}`).catch(() => {});
      await onChange();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} title="Manage categories">
      <p style={{ ...S.hint, marginTop: 0 }}>These are your own business’s categories. Add or remove as you like. Removing one doesn’t delete products — they just become uncategorised.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input style={{ ...S.input, flex: 1 }} value={name} placeholder="New category name" onChange={(e) => setName(e.target.value)} />
        <button style={{ ...S.btn, ...S.btnGold }} disabled={busy || !name.trim()} onClick={add}>Add</button>
      </div>
      {cats.length === 0 && <p style={S.empty}>No categories yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cats.map((c) => (
          <div key={c} style={S.card}>
            <div style={{ flex: 1, fontWeight: 600 }}>{c}</div>
            <button style={{ ...S.btn, ...S.btnGhost, padding: "7px 12px", color: "#FF8B7A" }} disabled={busy} onClick={() => remove(c)}>Remove</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const CATEGORIES = ["Samah", "Mu & Mu", "Elike", "Konga", "Other"];

function StockManager({ products, onChange, businessId, cats = [], onCatsChange }) {
  const CATS = cats;   // this business's categories
  const [open, setOpen] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [manageCats, setManageCats] = useState(false);
  const [editing, setEditing] = useState(null); // product being edited
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");        // category filter
  const [menuOpen, setMenuOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [f, setF] = useState({ name: "", price: "", pct: "", packs: "", units: "", pack_size: "1", low: "5", category: cats[0] || "" });
  const [busy, setBusy] = useState(false);
  // Bulk "tick products, assign one supplier" mode — independent of `bulk`
  // (that's the paste-a-price-list add flow, a different feature).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [assigningSupplier, setAssigningSupplier] = useState(false);
  const [showArchived, setShowArchived] = useState(false); // archived products (discontinued, kept for history) are hidden by default

  const add = async () => {
    if (!f.name.trim() || f.price === "") return;
    // Warn if a product with this name already exists in this business
    const dupe = products.find((p) => p.name.trim().toLowerCase() === f.name.trim().toLowerCase());
    if (dupe) {
      const ok = window.confirm(
        `“${dupe.name}” already exists (currently ${dupe.qty} in stock).\n\n` +
        `To add stock to it, tap Cancel, then tap its stock number on the list and type the new amount.\n\n` +
        `Only tap OK if you really want a SECOND separate product with the same name.`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await sb.insert("products", {
        name: f.name.trim(), price: parseFloat(f.price) || 0,
        tithe_pct: parseFloat(f.pct) || 0, qty: parseFloat(f.packs) || 0,
        pack_size: parseInt(f.pack_size) || 1, low_at: parseInt(f.low) || 5,
        category: f.category || "", business_id: businessId,
      });
      setF({ name: "", price: "", pct: "", packs: "", units: "", pack_size: "1", low: "5", category: cats[0] || "" });
      setOpen(false); await onChange();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const saveEdit = async (id, fields) => {
    await sb.patch("products", `id=eq.${id}`, fields);
    setEditing(null);
    await onChange();
  };
  const restock = async (p, units) => {
    await sb.patch("products", `id=eq.${p.id}`, { qty: Math.max(0, p.qty + units) });
    await onChange();
  };
  const setStock = async (p, value) => {
    const n = parseFloat(value);
    if (isNaN(n)) return;
    await sb.patch("products", `id=eq.${p.id}`, { qty: n });
    await onChange();
  };
  const remove = async (id) => {
    await sb.del("products", `id=eq.${id}`);
    await onChange();
  };
  const archive = async (id) => {
    await sb.patch("products", `id=eq.${id}`, { archived: true });
    await onChange();
  };
  const unarchive = async (p) => {
    await sb.patch("products", `id=eq.${p.id}`, { archived: false });
    await onChange();
  };

  const toggleSelected = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // One PATCH with an id=in.(...) filter — sb.patch(table, query, row) just
  // forwards `query` straight onto the PostgREST URL, and PostgREST accepts
  // the same `in.(...)` filter on PATCH as it does on GET, so this applies
  // to every ticked product in a single request instead of N round-trips.
  const applyBulkSupplier = async (chosen) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    await sb.patch("products", `id=in.(${ids.join(",")})`, {
      supplier_business_id: chosen.isDefault ? null : chosen.supplier_business_id,
      supplier_name: chosen.isDefault ? null : chosen.supplier_name,
      supplier_phone: chosen.isDefault ? null : chosen.supplier_phone,
    });
    setAssigningSupplier(false);
    setSelected(new Set());   // ticks cleared, select mode stays open for the next batch
    await onChange();
  };

  const visible = showArchived ? products.filter((p) => p.archived) : products.filter((p) => !p.archived);
  const archivedCount = products.filter((p) => p.archived).length;
  const byCat = cat === "All" ? visible : visible.filter((p) => (p.category || "Uncategorised") === cat);
  const shown = filterProducts(byCat, search);
  const catCount = (c) => visible.filter((p) => (p.category || "Uncategorised") === c).length;

  return (
    <>
      <CategorySidebar open={menuOpen} onClose={() => setMenuOpen(false)}
        current={cat} onPick={(c) => { setCat(c); setMenuOpen(false); }}
        counts={{ All: visible.length, ...Object.fromEntries(CATS.map((c) => [c, catCount(c)])) }}
        cats={CATS}
        onAdd={() => { setMenuOpen(false); setOpen(true); }}
        onBulk={() => { setMenuOpen(false); setBulk(true); }}
        onSelectSupplier={() => { setMenuOpen(false); setSelectMode(true); }}
        onManageCats={() => { setMenuOpen(false); setManageCats(true); }} />

      {selectMode ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
          <span style={{ ...S.cardName, fontSize: 14 }}>{selected.size} selected</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...S.btn, ...S.btnGhost, padding: "9px 12px", fontSize: 13 }}
              onClick={() => { setSelectMode(false); setSelected(new Set()); }}>Done</button>
            <button style={{ ...S.btn, ...S.btnDark, padding: "9px 12px", fontSize: 13 }}
              disabled={selected.size === 0} onClick={() => setAssigningSupplier(true)}>
              Assign supplier{selected.size ? ` (${selected.size})` : ""}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setMenuOpen(true)}
          style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 12, justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Menu size={18} /> {cat === "All" ? "All products" : cat}</span>
          <span style={{ color: muted, fontSize: 12 }}>menu ›</span>
        </button>
      )}

      {products.length > 0 && <SearchBar value={search} onChange={setSearch} />}
      {archivedCount > 0 && (
        <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 10, fontSize: 13 }}
          onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "← Back to active products" : `Show archived (${archivedCount})`}
        </button>
      )}
      {products.length === 0 && <p style={S.empty}>No products yet. Open the menu ≡ and tap “Add product”.</p>}
      {products.length > 0 && shown.length === 0 && (
        <p style={S.empty}>
          {search ? `No products match “${search}”.` : showArchived ? "No archived products." : `No products in ${cat} yet.`}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map((p) => {
          const ps = p.pack_size || 1;
          const isSel = selected.has(p.id);
          return (
            <div key={p.id} style={{ ...S.card, ...(selectMode && isSel ? S.cardInCart : {}), cursor: selectMode ? "pointer" : "default" }}
              onClick={selectMode ? () => toggleSelected(p.id) : undefined}>
              {selectMode && (
                <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: "grid", placeItems: "center",
                  border: `1px solid ${isSel ? accent : line}`, background: isSel ? accent : "transparent" }}>
                  {isSel && <Check size={14} color="#fff" />}
                </div>
              )}
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{p.name} {p.archived ? <span style={S.outTag}>archived</span> : p.qty <= 0 ? <span style={S.outTag}>out — restock</span> : p.qty <= p.low_at ? <span style={S.lowTag}>low</span> : null}</div>
                <div style={S.cardMeta}>{priceFmt(p.price)}/pack · {p.tithe_pct}% to God{ps > 1 ? ` · pack of ${ps}` : ""}{p.category ? <> · <span style={{ color: goldLt }}>{p.category}</span></> : ""}</div>
                <div style={{ ...S.cardMeta, color: p.qty <= 0 ? "#C0392B" : "#1F9D55", fontWeight: 600 }}>{p.qty <= 0 ? `${p.qty} packs — out of stock` : stockLabel(p)}</div>
              </div>
              {!selectMode && p.archived && (
                <button style={{ ...S.btn, ...S.btnGhost, padding: "8px 12px", fontSize: 12.5 }} onClick={() => unarchive(p)}>Unarchive</button>
              )}
              {!selectMode && !p.archived && <StockEditor product={p} onSet={(v) => setStock(p, v)} />}
              {!selectMode && <button style={S.editBtn} onClick={() => setEditing(p)}><Pencil size={15} /></button>}
            </div>
          );
        })}
      </div>
      {open && (
        <Modal onClose={() => setOpen(false)} title="New product">
          <Field label="Product name" value={f.name} onChange={(v)=>setF({...f,name:v})} placeholder="e.g. Maputi snack" />
          <Field label="Selling price per pack ($)" value={f.price} onChange={(v)=>setF({...f,price:v})} type="number" placeholder="9.50" />
          <label style={S.fieldWrap}>
            <span style={S.fieldLabel}>Category</span>
            <select style={S.input} value={f.category} onChange={(e)=>setF({...f,category:e.target.value})}>
              {CATS.length === 0 && <option value="">(no categories yet)</option>}
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <Field label="Opening stock (packs)" value={f.packs} onChange={(v)=>setF({...f,packs:v})} type="number" placeholder="0" />

          <button onClick={() => setMore(!more)}
            style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 4, justifyContent: "space-between" }}>
            <span>More options</span><span style={{ color: muted }}>{more ? "▲" : "▼"}</span>
          </button>
          {more && <div style={{ marginTop: 8 }}>
            <Field label="Items in a pack (label only, e.g. 20)" value={f.pack_size} onChange={(v)=>setF({...f,pack_size:v})} type="number" placeholder="20" />
            <Field label="Percentage to God (%)" value={f.pct} onChange={(v)=>setF({...f,pct:v})} type="number" placeholder="10" />
            <Field label="Warn me when packs drop to" value={f.low} onChange={(v)=>setF({...f,low:v})} type="number" placeholder="5" />
          </div>}

          <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 10 }} disabled={busy} onClick={add}>
            <Check size={18} /> {busy ? "Saving…" : "Save product"}
          </button>
        </Modal>
      )}
      {editing && <EditProductModal product={editing} cats={CATS} onClose={() => setEditing(null)} onSave={saveEdit}
        onArchive={async () => { await archive(editing.id); setEditing(null); }}
        onDelete={async () => {
          try { await remove(editing.id); setEditing(null); }
          catch (e) {
            alert(e.message.toLowerCase().includes("foreign key") || e.message.toLowerCase().includes("violat")
              ? "This product already has sales recorded against it, so it can't be deleted — use Archive instead to stop selling it while keeping its history."
              : e.message);
          }
        }} />}
      {manageCats && <ManageCategories businessId={businessId} cats={CATS} onClose={() => setManageCats(false)} onChange={onCatsChange} />}
      {bulk && <BulkAddModal businessId={businessId} onClose={() => setBulk(false)} onDone={async () => { setBulk(false); await onChange(); }} />}
      {assigningSupplier && (
        <BulkAssignSupplierModal count={selected.size} onClose={() => setAssigningSupplier(false)} onApply={applyBulkSupplier} />
      )}
    </>
  );
}

// Bulk mode's supplier picker — same SupplierPicker as EditProductModal's
// per-product override, just applied to every ticked product at once.
function BulkAssignSupplierModal({ count, onClose, onApply }) {
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const valid = current && (current.isDefault || current.supplier_business_id || current.supplier_name);

  const apply = async () => {
    if (!valid) return;
    setBusy(true);
    try { await onApply(current); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={`Assign supplier to ${count} product${count === 1 ? "" : "s"}`}>
      <p style={{ ...S.hint, marginTop: 0 }}>
        Search an existing business, save a free-text agent, or choose “Use default” to clear these products'
        overrides back to your business's default agent — applied to all {count} ticked product{count === 1 ? "" : "s"} at once.
      </p>
      <SupplierPicker allowDefault onChange={setCurrent} />
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 10 }} disabled={busy || !valid} onClick={apply}>
        <Check size={17} /> {busy ? "Applying…" : `Apply to ${count} product${count === 1 ? "" : "s"}`}
      </button>
    </Modal>
  );
}

// Paste a price list, review, and add many products at once
function BulkAddModal({ businessId, onClose, onDone }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState(null); // parsed preview
  const [busy, setBusy] = useState(false);

  const parse = () => setItems(parsePriceList(text));
  const updateItem = (i, field, val) =>
    setItems((prev) => prev.map((it, j) => j === i ? { ...it, [field]: val } : it));
  const removeItem = (i) => setItems((prev) => prev.filter((_, j) => j !== i));

  const save = async () => {
    if (!items || items.length === 0) return;
    setBusy(true);
    try {
      const rows = items.map((it) => ({
        name: it.name,
        price: parseFloat(it.price) || 0,
        tithe_pct: 0,
        qty: parseFloat(it.qty) || 0,
        pack_size: parseInt(it.pack_size) || 1,
        low_at: 5,
        category: "",
        business_id: businessId,
      }));
      await sb.insert("products", rows);
      alert(`Added ${rows.length} products.`);
      onDone();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Bulk add products">
      {!items ? (
        <>
          <p style={{ ...S.hint, marginTop: 0 }}>
            Paste your list. One product per line, like “Zimnax – $1.50” or “Frimax – Out of stock”.
            Category lines like *Snacks* are ignored.
          </p>
          <textarea style={{ ...S.input, minHeight: 200, fontFamily: "inherit" }} value={text}
            onChange={(e) => setText(e.target.value)} placeholder={"Zimnax – $1.50\nZapnax – $2.50\nFrimax – Out of stock"} />
          <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 10 }} disabled={!text.trim()} onClick={parse}>
            Preview {text.trim() ? `(${parsePriceList(text).length})` : ""}
          </button>
        </>
      ) : (
        <>
          <p style={{ ...S.hint, marginTop: 0 }}>
            Review and fix anything, then save. You can set stock (packs) now or later. Out-of-stock items came in at $0.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "45vh", overflowY: "auto", marginBottom: 10 }}>
            {items.map((it, i) => (
              <div key={i} style={{ ...S.cartLine, gap: 6, flexWrap: "wrap" }}>
                <input style={{ ...S.input, flex: "1 1 100%", padding: "8px 10px" }} value={it.name}
                  onChange={(e) => updateItem(i, "name", e.target.value)} />
                <input style={{ ...S.input, width: 70, padding: "8px 10px" }} type="number" value={it.price}
                  title="price" onChange={(e) => updateItem(i, "price", e.target.value)} />
                <input style={{ ...S.input, width: 70, padding: "8px 10px" }} type="number" value={it.pack_size}
                  title="pack size label" onChange={(e) => updateItem(i, "pack_size", e.target.value)} />
                <input style={{ ...S.input, width: 70, padding: "8px 10px" }} type="number" value={it.qty}
                  title="opening packs" placeholder="packs" onChange={(e) => updateItem(i, "qty", e.target.value)} />
                <button style={S.delBtn} onClick={() => removeItem(i)}><X size={16} /></button>
              </div>
            ))}
            {items.length === 0 && <p style={S.empty}>Nothing recognised. Go back and check the format.</p>}
          </div>
          <div style={{ ...S.cardMeta, marginBottom: 8 }}>Columns: name · price · pack-size label · opening packs</div>
          <button style={{ ...S.btn, ...S.btnDark, width: "100%" }} disabled={busy || items.length === 0} onClick={save}>
            <Check size={18} /> {busy ? "Adding…" : `Add ${items.length} products`}
          </button>
          <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={() => setItems(null)}>Back to paste</button>
        </>
      )}
    </Modal>
  );
}

// Edit price, percentage, pack size, name, low-stock level
function EditProductModal({ product, cats = [], onClose, onSave, onDelete, onArchive }) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [pct, setPct] = useState(String(product.tithe_pct));
  const [packSize, setPackSize] = useState(String(product.pack_size || 1));
  const [low, setLow] = useState(String(product.low_at));
  const [orderBox, setOrderBox] = useState(String(product.order_box || 1));
  const [category, setCategory] = useState(product.category || "Uncategorised");
  const [supplierOpen, setSupplierOpen] = useState(!!(product.supplier_business_id || product.supplier_name));
  const [supplierOverride, setSupplierOverride] = useState({
    supplier_business_id: product.supplier_business_id || null,
    supplier_name: product.supplier_name || null,
    supplier_phone: product.supplier_phone || null,
    isDefault: !(product.supplier_business_id || product.supplier_name),
  });
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await onSave(product.id, {
      name: name.trim(),
      price: parseFloat(price) || 0,
      tithe_pct: parseFloat(pct) || 0,
      pack_size: parseInt(packSize) || 1,
      low_at: parseInt(low) || 5,
      order_box: Math.max(1, parseInt(orderBox) || 1),
      category,
      // Blank/"use default" always clears the override, even if the picker
      // was left mid-edit (e.g. "Not on the app" tab with no name typed) —
      // an incomplete override silently falls back to the business default
      // rather than blocking the rest of the product edit from saving.
      supplier_business_id: supplierOverride.isDefault ? null : supplierOverride.supplier_business_id,
      supplier_name: supplierOverride.isDefault ? null : supplierOverride.supplier_name,
      supplier_phone: supplierOverride.isDefault ? null : supplierOverride.supplier_phone,
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Edit product">
      <Field label="Product name" value={name} onChange={setName} />
      <Field label="Selling price per pack ($)" value={price} onChange={setPrice} type="number" />
      <Field label="Percentage to God (%)" value={pct} onChange={setPct} type="number" />
      <Field label="Items in a pack (label only)" value={packSize} onChange={setPackSize} type="number" />
      <label style={S.fieldWrap}>
        <span style={S.fieldLabel}>Category</span>
        <select style={S.input} value={category} onChange={(e)=>setCategory(e.target.value)}>
          {cats.length === 0 && <option value="">(no categories yet)</option>}
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <Field label="Warn me when units drop to" value={low} onChange={setLow} type="number" />
      <Field label="Order box size (how many you sell per box you buy — 1 if sold as-is)" value={orderBox} onChange={setOrderBox} type="number" />

      <button onClick={() => setSupplierOpen(!supplierOpen)}
        style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 4, justifyContent: "space-between" }}>
        <span>Supplier for this product{!supplierOverride.isDefault ? " (set)" : ""}</span><span style={{ color: muted }}>{supplierOpen ? "▲" : "▼"}</span>
      </button>
      {supplierOpen && <div style={{ marginTop: 8 }}>
        <p style={{ ...S.hint, marginTop: 0 }}>
          Only needed if this product comes from a different agent than your usual one. Leave on “Use default” to
          keep ordering it from your business's default agent.
        </p>
        <SupplierPicker allowDefault
          initialBusinessId={product.supplier_business_id} initialName={product.supplier_name} initialPhone={product.supplier_phone}
          onChange={setSupplierOverride} />
      </div>}

      <p style={{ ...S.hint, marginBottom: 4 }}>To change quantity, tap the stock number on the list and type it.</p>
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 4 }} disabled={busy} onClick={save}>
        <Check size={18} /> {busy ? "Saving…" : "Save changes"}
      </button>
      {onArchive && (
        <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 10 }} onClick={onArchive}>
          Archive — stop selling it, keep its history
        </button>
      )}
      {onDelete && <>
        {!confirmDel ? (
          <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 10, color: "#C0392B" }} onClick={() => setConfirmDel(true)}>
            Delete this product
          </button>
        ) : (
          <div style={{ border: "1px solid #C0392B", borderRadius: 12, padding: 14, marginTop: 10 }}>
            <p style={{ ...S.hint, marginTop: 0 }}>Permanently delete <b>{product.name}</b>? Type <b>DELETE</b> to confirm.</p>
            <input style={S.input} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Type DELETE" />
            <button style={{ ...S.btn, width: "100%", marginTop: 8, background: "#C0392B", color: "#fff" }}
              disabled={confirmText !== "DELETE"} onClick={onDelete}>Permanently delete</button>
            <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={() => { setConfirmDel(false); setConfirmText(""); }}>Cancel</button>
          </div>
        )}
      </>}
    </Modal>
  );
}
// ============================================================
// Group flat sales rows into invoices
function groupByInvoice(sales) {
  const map = {};
  sales.forEach((s) => {
    const key = s.invoice_no || `single-${s.id}`;
    if (!map[key]) {
      map[key] = {
        invoice_no: s.invoice_no, key,
        when: s.sold_at, seller: s.seller_name,
        customer: s.customer_name || "", phone: s.customer_phone || "",
        lines: [], total: 0,
        single_id: s.invoice_no ? null : s.id,
      };
    }
    map[key].lines.push(s);
    map[key].total += Number(s.total);
  });
  return Object.values(map).sort((a, b) => new Date(b.when) - new Date(a.when));
}

// Compare two salespeople over two chosen date ranges, side by side
function SellerCompare({ sales }) {
  const sellers = [...new Set(sales.map((s) => s.seller_name).filter(Boolean))].sort();
  const today = localDateStr(new Date());
  const weekAgo = localDateStr(new Date(Date.now() - 6 * 86400000));
  const [aSeller, setASeller] = useState("");
  const [aFrom, setAFrom] = useState(weekAgo);
  const [aTo, setATo] = useState(today);
  const [bSeller, setBSeller] = useState("");
  const [bFrom, setBFrom] = useState(weekAgo);
  const [bTo, setBTo] = useState(today);
  const [show, setShow] = useState(false);

  const stat = (seller, from, to) => {
    const rows = sales.filter((s) => {
      if (s.seller_name !== seller) return false;
      const d = localDateStr(new Date(s.sold_at));
      return d >= from && d <= to;
    });
    const total = rows.reduce((a, s) => a + Number(s.total), 0);
    const invoices = new Set(rows.map((s) => s.invoice_no || s.id)).size;
    const days = new Set(rows.map((s) => localDateStr(new Date(s.sold_at)))).size;
    return { total, invoices, packs: rows.reduce((a, s) => a + Number(s.qty), 0), days };
  };
  const A = show ? stat(aSeller, aFrom, aTo) : null;
  const B = show ? stat(bSeller, bFrom, bTo) : null;
  const fmtRange = (f, t) => f === t ? new Date(f).toLocaleDateString() : `${new Date(f).toLocaleDateString()} – ${new Date(t).toLocaleDateString()}`;

  return (
    <>
      <SectionTitle>Compare salespeople</SectionTitle>
      <p style={S.hint}>Pick two salespeople and a date range each. Use the same single day on both sides to compare one day, or a week each to compare weeks.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...S.fieldLabel, color: accent }}>Person A</div>
          <select style={{ ...S.input, marginBottom: 4 }} value={aSeller} onChange={(e) => setASeller(e.target.value)}>
            <option value="">Choose…</option>
            {sellers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input style={{ ...S.input, marginBottom: 4 }} type="date" value={aFrom} max={today} onChange={(e) => setAFrom(e.target.value)} />
          <input style={S.input} type="date" value={aTo} max={today} onChange={(e) => setATo(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ ...S.fieldLabel, color: goldLt }}>Person B</div>
          <select style={{ ...S.input, marginBottom: 4 }} value={bSeller} onChange={(e) => setBSeller(e.target.value)}>
            <option value="">Choose…</option>
            {sellers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input style={{ ...S.input, marginBottom: 4 }} type="date" value={bFrom} max={today} onChange={(e) => setBFrom(e.target.value)} />
          <input style={S.input} type="date" value={bTo} max={today} onChange={(e) => setBTo(e.target.value)} />
        </div>
      </div>
      <button style={{ ...S.btn, ...S.btnGold, width: "100%", margin: "10px 0 4px" }}
        disabled={!aSeller || !bSeller} onClick={() => setShow(true)}>
        <Search size={16} /> Compare
      </button>

      {show && A && B && (
        <div style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 0, marginTop: 8 }}>
          <div style={{ display: "flex", fontSize: 12, fontWeight: 800, paddingBottom: 8, borderBottom: `1px solid ${line}` }}>
            <div style={{ flex: 1 }}></div>
            <div style={{ width: 90, textAlign: "right", color: accent }}>{aSeller}</div>
            <div style={{ width: 90, textAlign: "right", color: goldLt }}>{bSeller}</div>
          </div>
          {[["Sales", money(A.total), money(B.total)],
            ["Transactions", A.invoices, B.invoices],
            ["Packs sold", A.packs, B.packs],
            ["Days with sales", A.days, B.days]].map(([lbl, a, b]) => (
            <div key={lbl} style={{ display: "flex", padding: "9px 0", borderBottom: `1px solid ${line}` }}>
              <div style={{ flex: 1, fontWeight: 600 }}>{lbl}</div>
              <div style={{ width: 90, textAlign: "right", fontWeight: 800 }}>{a}</div>
              <div style={{ width: 90, textAlign: "right", fontWeight: 800, color: muted }}>{b}</div>
            </div>
          ))}
          <div style={{ ...S.cardMeta, marginTop: 8 }}>
            A: {fmtRange(aFrom, aTo)}<br/>B: {fmtRange(bFrom, bTo)}
          </div>
        </div>
      )}
    </>
  );
}

function Transactions({ sales, products, businessId, onChange, onDeleteSale, cats = [], user }) {
  const [prodQ, setProdQ] = useState("");
  const [fromQ, setFromQ] = useState("");
  const [toQ, setToQ] = useState("");
  const [cat, setCat] = useState("All");
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [catchingUp, setCatchingUp] = useState(false);

  // ---- Sales analysis (drill-down) ----
  const [anaDay, setAnaDay] = useState(localDateStr(new Date()));
  const [drillCat, setDrillCat] = useState(null);     // category tapped
  const [drillSeller, setDrillSeller] = useState(null); // seller tapped within category
  const [showFind, setShowFind] = useState(false);

  // Map product name → category
  const catOf = {};
  (products || []).forEach((p) => { catOf[p.name] = p.category || "Uncategorised"; });
  const catFor = (s) => catOf[s.product_name] || "Uncategorised";

  // Sales for the chosen analysis day
  const daySales = sales.filter((s) => localDateStr(new Date(s.sold_at)) === anaDay);
  const dayTotal = daySales.reduce((a, s) => a + Number(s.total), 0);

  // Level 1: totals per category for the day
  const catTotals = {};
  daySales.forEach((s) => {
    const c = catFor(s);
    catTotals[c] = (catTotals[c] || 0) + Number(s.total);
  });

  // Level 2: within a category, totals per seller
  const sellerTotals = {};
  if (drillCat) {
    daySales.filter((s) => catFor(s) === drillCat).forEach((s) => {
      sellerTotals[s.seller_name] = (sellerTotals[s.seller_name] || 0) + Number(s.total);
    });
  }

  // Level 3: per-product summary for that category + seller (line-level, so only
  // this category's products — never other products from the same invoice)
  const drillProducts = (() => {
    if (!drillCat || !drillSeller) return [];
    const rows = daySales.filter((s) => catFor(s) === drillCat && s.seller_name === drillSeller);
    const byP = {};
    rows.forEach((s) => {
      byP[s.product_name] = byP[s.product_name] || { qty: 0, total: 0 };
      byP[s.product_name].qty += Number(s.qty);
      byP[s.product_name].total += Number(s.total);
    });
    return Object.entries(byP).sort((a, b) => b[1].total - a[1].total);
  })();
  const drillSellerTotal = drillProducts.reduce((a, [, d]) => a + d.total, 0);

  const inRange = (when) => {
    const d = localDateStr(new Date(when));
    if (fromQ && d < fromQ) return false;
    if (toQ && d > toQ) return false;
    return true;
  };
  const matchesQ = (inv) => {
    const q = prodQ.trim().toLowerCase();
    if (!q) return true;
    return (inv.invoice_no || "").toLowerCase().includes(q)
      || (inv.customer || "").toLowerCase().includes(q)
      || inv.lines.some((l) => (l.product_name || "").toLowerCase().includes(q));
  };
  const inCat = (inv) => cat === "All" || inv.lines.some((l) => (catOf[l.product_name] || "Uncategorised") === cat);

  // Product summary: total units + total $ for the product search, over the date range
  let prodSummary = null;
  if (prodQ.trim()) {
    const q = prodQ.trim().toLowerCase();
    const matched = sales.filter((s) => (s.product_name || "").toLowerCase().includes(q) && inRange(s.sold_at));
    const units = matched.reduce((a, s) => a + Number(s.qty), 0);
    const total = matched.reduce((a, s) => a + Number(s.total), 0);
    prodSummary = { units, total, count: matched.length };
  }

  let invoices = groupByInvoice(sales).filter((inv) => inRange(inv.when) && matchesQ(inv) && inCat(inv));

  return (
    <>
      <SectionTitle>Sales analysis</SectionTitle>
      <label style={{ ...S.fieldWrap, marginBottom: 10 }}>
        <span style={S.fieldLabel}>Pick a day</span>
        <input style={S.input} type="date" value={anaDay} max={localDateStr(new Date())}
          onChange={(e) => { setAnaDay(e.target.value); setDrillCat(null); setDrillSeller(null); }} />
      </label>
      <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 10 }} onClick={() => setCatchingUp(true)}>
        <Plus size={16} /> Add missing sales for this day
      </button>

      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10, fontSize: 13 }}>
        <button style={S.crumb} onClick={() => { setDrillCat(null); setDrillSeller(null); }}>{new Date(anaDay).toLocaleDateString()}</button>
        {drillCat && <><span style={{ color: muted }}>›</span><button style={S.crumb} onClick={() => setDrillSeller(null)}>{drillCat}</button></>}
        {drillCat && drillSeller && <><span style={{ color: muted }}>›</span><span style={{ color: goldLt, fontWeight: 700 }}>{drillSeller}</span></>}
      </div>

      {daySales.length === 0 && <p style={S.empty}>No sales on this day.</p>}

      {/* Level 1: categories for the day */}
      {daySales.length > 0 && !drillCat && <>
        <div style={{ ...S.cartTotalRow, marginBottom: 10 }}>
          <span>Day total</span><span>{money(dayTotal)}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.keys(catTotals).sort().map((c) => (
            <button key={c} style={{ ...S.card, width: "100%", cursor: "pointer", textAlign: "left" }} onClick={() => setDrillCat(c)}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{c}</div>
                <div style={S.cardMeta}>{((catTotals[c] / dayTotal) * 100).toFixed(0)}% of the day</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={S.saleName}>{money(catTotals[c])}</div>
                <div style={{ fontSize: 11, color: accent, fontWeight: 700 }}>Tap ›</div>
              </div>
            </button>
          ))}
        </div>
      </>}

      {/* Level 2: sellers within the category */}
      {drillCat && !drillSeller && <>
        <div style={{ ...S.cartTotalRow, marginBottom: 10 }}>
          <span>{drillCat} total</span><span>{money(catTotals[drillCat] || 0)}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(sellerTotals).sort((a,b)=>b[1]-a[1]).map(([sn, tot]) => (
            <button key={sn} style={{ ...S.card, width: "100%", cursor: "pointer", textAlign: "left" }} onClick={() => setDrillSeller(sn)}>
              <div style={{ flex: 1 }}><div style={S.cardName}>{sn}</div></div>
              <div style={{ textAlign: "right" }}>
                <div style={S.saleName}>{money(tot)}</div>
                <div style={{ fontSize: 11, color: accent, fontWeight: 700 }}>Tap ›</div>
              </div>
            </button>
          ))}
        </div>
      </>}

      {/* Level 3: per-product summary (only this category's products) */}
      {drillCat && drillSeller && <>
        <div style={{ ...S.cartTotalRow, marginBottom: 10 }}>
          <span>{drillSeller} · {drillCat}</span><span>{money(drillSellerTotal)}</span>
        </div>
        {drillProducts.length === 0 && <p style={S.empty}>No {drillCat} sales for {drillSeller} on this day.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {drillProducts.map(([name, d]) => (
            <div key={name} style={S.card}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{name}</div>
                <div style={S.cardMeta}>{d.qty} sold</div>
              </div>
              <div style={S.saleName}>{money(d.total)}</div>
            </div>
          ))}
        </div>
      </>}

      <div style={{ height: 1, background: line, margin: "22px 0" }} />

      <button style={{ ...S.btn, ...S.btnGhost, width: "100%", justifyContent: "space-between" }} onClick={() => setShowFind(!showFind)}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Search size={16} /> Find a specific sale</span>
        <span style={{ color: muted }}>{showFind ? "▲" : "▼"}</span>
      </button>
      {showFind && <div style={{ marginTop: 12 }}>
      <div style={S.searchWrap}>
        <Search size={16} style={{ color: muted, flexShrink: 0 }} />
        <input style={S.searchInput} value={prodQ} placeholder="Search product, invoice no, or customer…" onChange={(e) => setProdQ(e.target.value)} />
        {prodQ && <button style={S.searchClear} onClick={() => setProdQ("")}><X size={15} /></button>}
      </div>
      <label style={{ ...S.fieldWrap, marginBottom: 10 }}>
        <span style={S.fieldLabel}>Category</span>
        <select style={S.input} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="All">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <label style={{ ...S.fieldWrap, flex: 1, marginBottom: 0 }}>
          <span style={S.fieldLabel}>From</span>
          <input style={S.input} type="date" value={fromQ} onChange={(e) => setFromQ(e.target.value)} />
        </label>
        <label style={{ ...S.fieldWrap, flex: 1, marginBottom: 0 }}>
          <span style={S.fieldLabel}>To</span>
          <input style={S.input} type="date" value={toQ} onChange={(e) => setToQ(e.target.value)} />
        </label>
      </div>
      {(fromQ || toQ) && <button style={{ ...S.btn, ...S.btnGhost, padding: "8px 12px", marginBottom: 12 }} onClick={() => { setFromQ(""); setToQ(""); }}>Clear dates</button>}

      {prodSummary && (
        <div style={{ ...S.reportHead, background: `linear-gradient(135deg,${accent},${lime})` }}>
          <Package size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ ...S.cardName, color: "#fff" }}>“{prodQ.trim()}” sold</div>
            <div style={{ ...S.cardMeta, color: "rgba(255,255,255,0.85)" }}>
              {prodSummary.units} pack{prodSummary.units === 1 ? "" : "s"} · {money(prodSummary.total)} · {prodSummary.count} sale{prodSummary.count === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      )}

      {invoices.length === 0 && <p style={S.empty}>No invoices match your search.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {invoices.map((inv) => (
          <div key={inv.key} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <button onClick={() => setViewing(inv)}
              style={{ display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{inv.customer || "No name"} {inv.invoice_no && <span style={S.invTag}>{inv.invoice_no}</span>}</div>
                <div style={S.cardMeta}>
                  {new Date(inv.when).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {" · "}{inv.lines.length} item{inv.lines.length > 1 ? "s" : ""} · {inv.seller}
                </div>
                {inv.phone && <div style={S.cardMeta}>{inv.phone}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={S.saleName}>{money(inv.total)}</div>
                <div style={{ fontSize: 11, color: accent, fontWeight: 700 }}>Tap to view ›</div>
              </div>
            </button>
            {inv.invoice_no && (
              <div style={{ display: "flex", gap: 8, borderTop: `1px solid ${line}`, paddingTop: 8 }}>
                <button style={{ ...S.btn, ...S.btnGhost, flex: 1, padding: "9px 0" }} onClick={() => setEditing(inv)}>
                  <Pencil size={15} /> Edit
                </button>
                <button style={{ ...S.btn, flex: 1, padding: "9px 0", background: "rgba(192,57,43,0.15)", color: "#FF8B7A", border: `1px solid rgba(192,57,43,0.3)` }}
                  onClick={() => setConfirmDel(inv)}>
                  <X size={15} /> Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      </div>}

      {editing && (
        <EditInvoiceModal invoice={editing} products={products}
          onClose={() => setEditing(null)} onChange={onChange} />
      )}

      {viewing && (
        <Modal onClose={() => setViewing(null)} title={viewing.invoice_no || "Invoice"}>
          <div style={{ ...S.cardMeta, marginBottom: 8 }}>
            {viewing.customer || "No name"}{viewing.phone ? ` · ${viewing.phone}` : ""}<br/>
            {new Date(viewing.when).toLocaleString()} · sold by {viewing.seller}
          </div>
          {viewing.lines.map((l, i) => (
            <div key={i} style={{ ...S.receiptLine }}>
              <span style={{ flex: 1 }}>{l.product_name} <span style={{ color: muted }}>×{l.qty}</span></span>
              <span style={{ fontWeight: 700 }}>{money(l.total)}</span>
            </div>
          ))}
          <div style={{ ...S.cartTotalRow, marginTop: 10 }}>
            <span>Total</span><span>{money(viewing.total)}</span>
          </div>
          {viewing.invoice_no && (
            <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 12 }}
              onClick={() => { const inv = viewing; setViewing(null); setEditing(inv); }}>
              <Pencil size={16} /> Edit this invoice
            </button>
          )}
        </Modal>
      )}

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="Delete this invoice?">
          <p style={{ ...S.hint, marginTop: 0 }}>
            {confirmDel.invoice_no} · {confirmDel.customer || "No name"} · {money(confirmDel.total)}
          </p>
          <p style={{ ...S.hint, color: "#FF8B7A" }}>
            This permanently removes the sale and returns its stock. It cannot be undone.
          </p>
          <button style={{ ...S.btn, width: "100%", background: "rgba(192,57,43,0.9)", color: "#fff" }}
            onClick={() => { onDeleteSale(confirmDel.lines[0]); setConfirmDel(null); }}>
            Yes, delete it
          </button>
          <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={() => setConfirmDel(null)}>
            Cancel
          </button>
        </Modal>
      )}

      {catchingUp && (
        <CatchUpSaleModal businessId={businessId} day={anaDay} recordedTotal={dayTotal}
          defaultSeller={user && user.name}
          onClose={() => setCatchingUp(false)}
          onAdded={async () => { setCatchingUp(false); await onChange(); }} />
      )}
    </>
  );
}

// A seller who only knows the TOTAL they actually made (worked out by
// hand) but forgot to log some items can enter that true total here —
// only the shortfall gets recorded, as one entry not tied to any specific
// product, rather than forcing them to itemize sales they don't remember.
function CatchUpSaleModal({ businessId, day, recordedTotal, defaultSeller, onClose, onAdded }) {
  const [actualTotal, setActualTotal] = useState("");
  const [tithePct, setTithePct] = useState("");
  const [seller, setSeller] = useState(defaultSeller || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const actualNum = parseFloat(actualTotal);
  const hasActual = actualTotal !== "" && !isNaN(actualNum);
  const shortfall = hasActual ? Math.max(0, actualNum - recordedTotal) : 0;

  const submit = async () => {
    setErr("");
    if (!hasActual) { setErr("Enter the actual total you calculated."); return; }
    if (shortfall <= 0) { setErr("The actual total isn't higher than what's already recorded — nothing to add."); return; }
    if (!seller.trim()) { setErr("Enter who this sale is being recorded for."); return; }
    setBusy(true);
    try {
      await sb.rpc("record_catchup_sale", {
        p_business_id: businessId, p_seller: seller.trim(), p_amount: shortfall,
        p_tithe_pct: parseFloat(tithePct) || 0, p_note: note.trim() || null,
        p_sold_at: `${day}T${new Date().toTimeString().slice(0, 8)}`,
      });
      await onAdded();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Add missing sales">
      <p style={{ ...S.hint, marginTop: 0 }}>
        For when you know the real total you made that day but didn't log every item — enter the true total below
        and only the difference gets added, as one entry (it won't affect stock).
      </p>
      <div style={S.cartTotalRow}>
        <span>Already recorded for {new Date(day + "T00:00:00").toLocaleDateString()}</span>
        <span>{money(recordedTotal)}</span>
      </div>
      <Field label="Actual total you calculated ($)" value={actualTotal} onChange={setActualTotal} type="number" placeholder="0.00" />
      {hasActual && (
        <div style={{ ...S.cartTotalRow, background: shortfall > 0 ? "rgba(245,166,35,0.15)" : "rgba(43,208,122,0.15)", color: shortfall > 0 ? mango : accent }}>
          <span>{shortfall > 0 ? "Will add" : "Matches — nothing to add"}</span>
          <span>{money(shortfall)}</span>
        </div>
      )}
      <Field label="Seller name" value={seller} onChange={setSeller} placeholder="e.g. P Maisiri" />
      <Field label="To God (%) on this amount" value={tithePct} onChange={setTithePct} type="number" placeholder="0" />
      <Field label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. forgot to log a few sales" />
      {err && <p style={S.errTxt}>{err}</p>}
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 6 }} disabled={busy || shortfall <= 0} onClick={submit}>
        <Check size={17} /> {busy ? "Adding…" : `Add ${money(shortfall)}`}
      </button>
    </Modal>
  );
}

// Edit an invoice's items, customer details
function EditInvoiceModal({ invoice, products, onClose, onChange }) {
  const [customer, setCustomer] = useState(invoice.customer);
  const [phone, setPhone] = useState(invoice.phone);
  const [lines, setLines] = useState(
    invoice.lines.map((l) => ({ product_id: l.product_id, name: l.product_name, packs: l.qty, price: Number(l.unit_price) }))
  );
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);

  const setPacks = (i, v) => setLines((prev) => prev.map((l, j) => j === i ? { ...l, packs: parseFloat(v) || 0 } : l));
  const removeLine = (i) => setLines((prev) => prev.filter((_, j) => j !== i));
  const addLine = () => {
    const p = products.find((x) => x.id === addId);
    if (!p) return;
    if (lines.some((l) => l.product_id === p.id)) { setAddId(""); return; }
    setLines((prev) => [...prev, { product_id: p.id, name: p.name, packs: 1, price: Number(p.price) }]);
    setAddId("");
  };
  const total = lines.reduce((a, l) => a + l.packs * l.price, 0);

  const save = async () => {
    setBusy(true);
    try {
      const items = lines.filter((l) => l.packs > 0).map((l) => ({ product_id: l.product_id, packs: l.packs }));
      await sb.rpc("edit_invoice", {
        p_invoice_no: invoice.invoice_no, p_items: items,
        p_customer: customer.trim() || null, p_phone: phone.trim() || null,
      });
      onClose(); await onChange();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={`Edit ${invoice.invoice_no}`}>
      <div style={{ display: "flex", gap: 10 }}>
        <Field label="Customer name" value={customer} onChange={setCustomer} />
        <Field label="Phone" value={phone} onChange={setPhone} type="tel" />
      </div>
      <SectionTitle>Items</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((l, i) => (
          <div key={l.product_id} style={S.cartLine}>
            <div style={{ fontSize: 20 }}>{emojiFor(l.name)}</div>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{l.name}</div>
              <div style={S.cardMeta}>{priceFmt(l.price)}/pack</div>
            </div>
            <input style={{ ...S.input, width: 64, textAlign: "center" }} type="number" value={l.packs}
              onChange={(e) => setPacks(i, e.target.value)} />
            <button style={S.delBtn} onClick={() => removeLine(i)}><X size={16} /></button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <select style={{ ...S.input, flex: 1 }} value={addId} onChange={(e) => setAddId(e.target.value)}>
          <option value="">Add a product…</option>
          {[...products].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button style={{ ...S.btn, ...S.btnGhost }} onClick={addLine}><Plus size={16} /></button>
      </div>
      <div style={{ ...S.cartTotalRow, marginTop: 12 }}>
        <span>New total</span><span>{money(total)}</span>
      </div>
      <p style={{ ...S.hint, marginBottom: 4 }}>Saving adjusts stock to match these changes.</p>
      <button style={{ ...S.btn, ...S.btnDark, width: "100%" }} disabled={busy} onClick={save}>
        <Check size={18} /> {busy ? "Saving…" : "Save changes"}
      </button>
    </Modal>
  );
}

// Admin reviews seller day-end cash-ups and confirms them
function CashUps({ businessId, sales = [] }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setReports(await sb.select("day_reports", `business_id=eq.${businessId}&order=report_date.desc,created_at.desc`));
    } catch {}
    setLoading(false);
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const confirm = async (id) => {
    await sb.patch("day_reports", `id=eq.${id}`, { confirmed: true });
    await load();
  };
  const reopen = async (id) => {
    await sb.patch("day_reports", `id=eq.${id}`, { confirmed: false });
    await load();
  };
  const remove = async (id) => {
    await sb.del("day_reports", `id=eq.${id}`);
    await load();
  };
  const saveEdit = async (id, fields) => {
    await sb.patch("day_reports", `id=eq.${id}`, fields);
    setEditing(null);
    await load();
  };

  if (loading) return <Loading />;

  // Who sold today but hasn't submitted a cash-up today?
  const todayStr = localDateStr(new Date());
  const soldToday = [...new Set(sales.filter((s) => localDateStr(new Date(s.sold_at)) === todayStr).map((s) => s.seller_name))];
  const cashedToday = new Set(reports.filter((r) => r.report_date === todayStr).map((r) => r.seller_name));
  const notDone = soldToday.filter((n) => !cashedToday.has(n));

  return (
    <>
      {notDone.length > 0 && (
        <div style={{ ...S.alert, background: "rgba(245,166,35,0.15)", color: mango }}>
          <AlertTriangle size={16} />
          <span><b>Not cashed up today:</b> {notDone.join(", ")}. They sold today but haven’t submitted a cash-up.</span>
        </div>
      )}
      <SectionTitle>Day-end cash-ups</SectionTitle>
      {reports.length === 0 && <p style={S.empty}>No cash-ups submitted yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {reports.map((r) => {
          const expTotal = Number(r.expenses_total || 0);
          const expected = Number(r.sales_total) - expTotal;
          const diff = Number(r.cash_in_hand) - expected;
          const short = diff < -0.005, over = diff > 0.005;
          const expList = Array.isArray(r.expenses) ? r.expenses : [];
          return (
            <div key={r.id} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>
                    {r.seller_name}
                    {r.confirmed
                      ? <span style={{ ...S.invTag, background: "#EAF7EE", color: accent }}>confirmed</span>
                      : <span style={{ ...S.invTag, background: "#FFF1DA", color: "#B26A00" }}>pending</span>}
                  </div>
                  <div style={S.cardMeta}>{new Date(r.report_date).toLocaleDateString()} · {r.tx_count} sale{r.tx_count === 1 ? "" : "s"}</div>
                </div>
                <button style={S.editBtn} onClick={() => setEditing(r)}><Pencil size={15} /></button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...S.miniStat }}><div style={S.miniLabel}>Sales</div><div style={S.miniVal}>{money(r.sales_total)}</div></div>
                <div style={{ ...S.miniStat }}><div style={S.miniLabel}>Spent</div><div style={S.miniVal}>{money(expTotal)}</div></div>
                <div style={{ ...S.miniStat }}><div style={S.miniLabel}>Cash</div><div style={S.miniVal}>{money(r.cash_in_hand)}</div></div>
                <div style={{ ...S.miniStat, background: short ? "#FFE2E2" : over ? "#FFF1DA" : "#EAF7EE" }}>
                  <div style={S.miniLabel}>{short ? "Short" : over ? "Over" : "Match"}</div>
                  <div style={{ ...S.miniVal, color: short ? "#C0392B" : accent }}>{Math.abs(diff) < 0.005 ? "✓" : money(Math.abs(diff))}</div>
                </div>
              </div>
              {expList.length > 0 && (
                <div style={{ ...S.cardMeta }}>
                  Expenses:
                  {expList.map((e, i) => (
                    <span key={i}> {money(e.amount)} ({e.note || "?"}){e.photo_url ? <a href={e.photo_url} target="_blank" rel="noreferrer" style={{ color: accent, marginLeft: 3 }}>📎</a> : ""}{i < expList.length - 1 ? "," : ""}</span>
                  ))}
                </div>
              )}
              {r.note && <div style={S.cardMeta}>Note: {r.note}</div>}
              {r.confirmed
                ? <button style={{ ...S.btn, ...S.btnGhost, width: "100%" }} onClick={() => reopen(r.id)}>Re-open (mark pending)</button>
                : <button style={{ ...S.btn, ...S.btnDark, width: "100%" }} onClick={() => confirm(r.id)}>
                    <Check size={17} /> Confirm this cash-up
                  </button>}
            </div>
          );
        })}
      </div>
      {editing && <EditCashUpModal report={editing} onClose={() => setEditing(null)} onSave={saveEdit}
        onDelete={async () => {
          try { await remove(editing.id); setEditing(null); }
          catch (e) { alert(e.message); }
        }} />}
    </>
  );
}

// Admin edits a cash-up's figures
function EditCashUpModal({ report, onClose, onSave, onDelete }) {
  const [sales, setSales] = useState(String(report.sales_total));
  const [cash, setCash] = useState(String(report.cash_in_hand));
  const [note, setNote] = useState(report.note || "");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const save = async () => {
    setBusy(true);
    await onSave(report.id, {
      sales_total: parseFloat(sales) || 0,
      cash_in_hand: parseFloat(cash) || 0,
      note: note.trim() || null,
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={`Edit cash-up — ${report.seller_name}`}>
      <p style={{ ...S.hint, marginTop: 0 }}>{new Date(report.report_date).toLocaleDateString()}</p>
      <Field label="Sales total ($)" value={sales} onChange={setSales} type="number" />
      <Field label="Cash in hand ($)" value={cash} onChange={setCash} type="number" />
      <Field label="Note" value={note} onChange={setNote} placeholder="optional" />
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 4 }} disabled={busy} onClick={save}>
        <Check size={18} /> {busy ? "Saving…" : "Save changes"}
      </button>
      {onDelete && <>
        {!confirmDel ? (
          <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 10, color: "#C0392B" }} onClick={() => setConfirmDel(true)}>
            Delete this cash-up
          </button>
        ) : (
          <div style={{ border: "1px solid #C0392B", borderRadius: 12, padding: 14, marginTop: 10 }}>
            <p style={{ ...S.hint, marginTop: 0 }}>Permanently delete this cash-up? Type <b>DELETE</b> to confirm.</p>
            <input style={S.input} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Type DELETE" />
            <button style={{ ...S.btn, width: "100%", marginTop: 8, background: "#C0392B", color: "#fff" }}
              disabled={confirmText !== "DELETE"} onClick={onDelete}>Permanently delete</button>
            <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={() => { setConfirmDel(false); setConfirmText(""); }}>Cancel</button>
          </div>
        )}
      </>}
    </Modal>
  );
}

// Reorder-suggestion math, standalone so both the local share/PDF flow and the
// in-app "send to agent" flow compute the exact same numbers.
export function computeReorderSuggestions(products, sales) {
  // Sales in the last 7 days, per product name
  const weekAgo = Date.now() - 7 * 86400000;
  const soldLastWeek = {};
  sales.forEach((s) => {
    if (new Date(s.sold_at).getTime() >= weekAgo) {
      soldLastWeek[s.product_name] = (soldLastWeek[s.product_name] || 0) + Number(s.qty);
    }
  });

  // Items at or below their low level
  return products
    .filter((p) => p.qty <= p.low_at)
    .map((p) => {
      const box = Math.max(1, p.order_box || 1);   // selling-units per order-box
      const sold = soldLastWeek[p.name] || 0;
      // loose selling-units needed to cover next week
      const looseNeeded = Math.max(0, Math.ceil(sold - Math.max(0, p.qty)));
      const fallbackLoose = p.qty <= 0 ? Math.max(1, p.low_at) : 0;
      const loose = looseNeeded > 0 ? looseNeeded : fallbackLoose;
      // convert to boxes, rounding UP so we never under-order
      const proposeBoxes = Math.ceil(loose / box);
      return { p, sold, box, loose, propose: proposeBoxes };
    })
    .sort((a, b) => (a.p.category || "").localeCompare(b.p.category || "") || a.p.name.localeCompare(b.p.name));
}

async function fetchSupplierLink(businessId) {
  try {
    const rows = await sb.select("business_supplier_links", `business_id=eq.${businessId}`);
    return rows[0] || null;
  } catch { return null; } // table may not exist yet on older deployments
}
async function saveSupplierLink(businessId, fields) {
  const existing = await sb.select("business_supplier_links", `business_id=eq.${businessId}`).catch(() => []);
  const row = { ...fields, updated_at: new Date().toISOString() };
  if (existing.length) return sb.patch("business_supplier_links", `business_id=eq.${businessId}`, row);
  return sb.insert("business_supplier_links", { business_id: businessId, ...row });
}

async function fetchSalarySettings(businessId) {
  const fallback = { outside_salary: 0, outside_tithe_pct: 10 };
  try {
    const rows = await sb.select("business_salary_settings", `business_id=eq.${businessId}`);
    return rows[0] || fallback;
  } catch { return fallback; } // table may not exist yet on older deployments
}
async function saveSalarySettings(businessId, fields) {
  const existing = await sb.select("business_salary_settings", `business_id=eq.${businessId}`).catch(() => []);
  const row = { ...fields, updated_at: new Date().toISOString() };
  if (existing.length) return sb.patch("business_salary_settings", `business_id=eq.${businessId}`, row);
  return sb.insert("business_salary_settings", { business_id: businessId, ...row });
}

// One row per (business, category) — a business selling for several
// companies can draw a different salary percentage from each one, each with
// its own "to God" percentage on that resulting salary amount.
async function fetchSalaryCategories(businessId) {
  try { return await sb.select("business_salary_categories", `business_id=eq.${businessId}`); }
  catch { return []; } // table may not exist yet on older deployments
}
// `rows` is { [category]: { pct, tithe_pct } } — only categories whose
// values actually changed are written, so saving doesn't touch every
// category every time.
async function saveSalaryCategoryPcts(businessId, existingRows, rows) {
  const existingByCat = {};
  existingRows.forEach((r) => { existingByCat[r.category] = r; });
  const writes = Object.entries(rows)
    .filter(([category, v]) => {
      const ex = existingByCat[category];
      return Number(ex?.pct || 0) !== Number(v.pct) || Number(ex?.tithe_pct ?? 10) !== Number(v.tithe_pct);
    })
    .map(([category, v]) => {
      const row = { pct: Number(v.pct) || 0, tithe_pct: Number(v.tithe_pct) || 0, updated_at: new Date().toISOString() };
      const enc = encodeURIComponent(category);
      if (existingByCat[category]) return sb.patch("business_salary_categories", `business_id=eq.${businessId}&category=eq.${enc}`, row);
      return sb.insert("business_salary_categories", { business_id: businessId, category, ...row });
    });
  await Promise.all(writes);
}

// Which of a business's own categories are actually resold on behalf of
// another registered Pamusika business (e.g. Samah Valley selling for
// Munonwa) — { [category]: target_business_id }.
async function fetchCategoryLinks(businessId) {
  try { return await sb.select("category_business_links", `business_id=eq.${businessId}`); }
  catch { return []; } // table may not exist yet on older deployments
}
async function saveCategoryLink(businessId, category, targetBusinessId) {
  const enc = encodeURIComponent(category);
  const existing = await sb.select("category_business_links", `business_id=eq.${businessId}&category=eq.${enc}`).catch(() => []);
  const row = { target_business_id: targetBusinessId, updated_at: new Date().toISOString() };
  if (existing.length) return sb.patch("category_business_links", `business_id=eq.${businessId}&category=eq.${enc}`, row);
  return sb.insert("category_business_links", { business_id: businessId, category, ...row });
}
async function removeCategoryLink(businessId, category) {
  return sb.del("category_business_links", `business_id=eq.${businessId}&category=eq.${encodeURIComponent(category)}`);
}

// Sends one category's week to the business it's linked to — sending again
// for the same week updates the same row (the unique constraint on
// receiving_business_id/from_business_id/category/week_start) rather than
// piling up duplicates.
async function sendResellerReport({ receivingBusinessId, fromBusinessId, fromBusinessName, category, weekStart, weekEnd, totalSales, totalTithe }) {
  const enc = encodeURIComponent(category);
  const existing = await sb.select("received_reseller_reports",
    `receiving_business_id=eq.${receivingBusinessId}&from_business_id=eq.${fromBusinessId}&category=eq.${enc}&week_start=eq.${weekStart}`
  ).catch(() => []);
  const row = { total_sales: totalSales, total_tithe: totalTithe, from_business_name: fromBusinessName, week_end: weekEnd };
  if (existing.length) return sb.patch("received_reseller_reports", `id=eq.${existing[0].id}`, row);
  return sb.insert("received_reseller_reports", { receiving_business_id: receivingBusinessId, from_business_id: fromBusinessId, category, week_start: weekStart, ...row });
}
// Matched by where the report's LAST day (week_end) falls, not by an exact
// week_start match — the sender and receiver can have different "week
// starts on" settings (see report-settings.sql), so a report covering a
// period ending Monday belongs to whichever of the receiver's own weeks
// Monday falls in, even if the receiver's own week doesn't start Tuesday.
async function fetchReceivedReports(businessId, rangeStartStr, rangeEndStr) {
  try {
    return await sb.select("received_reseller_reports",
      `receiving_business_id=eq.${businessId}&week_end=gte.${rangeStartStr}&week_end=lte.${rangeEndStr}`);
  } catch { return []; } // table may not exist yet on older deployments
}

// Which day of the week a business's report cycle starts on — defaults to
// Tuesday (2) so nothing changes until someone deliberately sets this.
async function fetchReportWeekStartDay(businessId) {
  try {
    const rows = await sb.select("business_report_settings", `business_id=eq.${businessId}`);
    return rows[0] ? Number(rows[0].week_start_day) : 2;
  } catch { return 2; } // table may not exist yet on older deployments
}
async function saveReportWeekStartDay(businessId, day) {
  const existing = await sb.select("business_report_settings", `business_id=eq.${businessId}`).catch(() => []);
  const row = { week_start_day: day, updated_at: new Date().toISOString() };
  if (existing.length) return sb.patch("business_report_settings", `business_id=eq.${businessId}`, row);
  return sb.insert("business_report_settings", { business_id: businessId, ...row });
}

// This week's [start, end] date strings for a given week-start-day, same
// Tuesday-cycle math the Report tab uses, just for the CURRENT week only
// (no offset/custom-range) — used to file platform revenue under the
// right week regardless of what day Munonwa's own report happens to start on.
function currentWeekRange(weekStartDay) {
  const now = new Date();
  const daysSinceStart = (now.getDay() - weekStartDay + 7) % 7;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - daysSinceStart);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { startStr: localDateStr(start), endStr: localDateStr(end) };
}

// Credits one approved payment to the platform-owner business's own
// revenue, under the "Pamusika" category — reuses the same
// received_reseller_reports table the B2B reseller-report feature uses,
// but ADDS to any existing figure for the week instead of replacing it,
// since several different businesses' payments can land in the same week.
async function creditPaymentRevenue({ receivingBusinessId, fromBusinessId, fromBusinessName, weekStart, weekEnd, amount }) {
  const category = "Pamusika";
  const enc = encodeURIComponent(category);
  const existing = await sb.select("received_reseller_reports",
    `receiving_business_id=eq.${receivingBusinessId}&from_business_id=eq.${fromBusinessId}&category=eq.${enc}&week_start=eq.${weekStart}`
  ).catch(() => []);
  if (existing.length) {
    const newTotal = Number(existing[0].total_sales) + amount;
    return sb.patch("received_reseller_reports", `id=eq.${existing[0].id}`, { total_sales: newTotal, from_business_name: fromBusinessName, week_end: weekEnd });
  }
  return sb.insert("received_reseller_reports", {
    receiving_business_id: receivingBusinessId, from_business_id: fromBusinessId, from_business_name: fromBusinessName,
    category, week_start: weekStart, week_end: weekEnd, total_sales: amount, total_tithe: 0,
  });
}
// Makes sure a category exists so it's ready to pick a salary % for —
// silently ignored if it's already there.
async function ensureCategoryExists(businessId, name) {
  try { await sb.insert("categories", { business_id: businessId, name }); } catch {}
}

// A product's own supplier if it has one, else the business's default link
// (already-loaded `business_supplier_links` row) — a product with no
// override just inherits whatever the business has set as default, same as
// before this feature existed.
function effectiveSupplierFor(p, link) {
  if (p.supplier_business_id || p.supplier_name) {
    return { supplier_business_id: p.supplier_business_id || null, supplier_name: p.supplier_name || "", supplier_phone: p.supplier_phone || null };
  }
  if (link && (link.supplier_business_id || link.supplier_name)) {
    return { supplier_business_id: link.supplier_business_id || null, supplier_name: link.supplier_name || "", supplier_phone: link.supplier_phone || null };
  }
  return null;
}
// Group key: a registered business groups by id (its name can change), a
// free-text agent groups by name+phone (no id to key on), and items with no
// supplier at all share a single "none" group.
function supplierGroupKey(eff) {
  if (!eff) return "none";
  if (eff.supplier_business_id) return `biz:${eff.supplier_business_id}`;
  if (eff.supplier_name) return `text:${eff.supplier_name}|${eff.supplier_phone || ""}`;
  return "none";
}

// Procurement / reorder list — suggests quantities from last 7 days of sales
function OrderList({ products, sales, businessName, businessId }) {
  const [qtys, setQtys] = useState({});   // productId -> adjusted order qty
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState(null);          // business_supplier_links row, or null
  const [supplierName, setSupplierName] = useState("");
  const [editingLink, setEditingLink] = useState(false);
  const [sendingGroupKey, setSendingGroupKey] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);

  const loadLink = useCallback(async () => {
    const row = await fetchSupplierLink(businessId);
    setLink(row);
    if (row && row.supplier_business_id) {
      try {
        const biz = await sb.select("businesses", `id=eq.${row.supplier_business_id}&select=name`);
        setSupplierName((biz[0] || {}).name || row.supplier_name || "");
      } catch { setSupplierName(row.supplier_name || ""); }
    } else {
      setSupplierName(row ? (row.supplier_name || "") : "");
    }
  }, [businessId]);
  useEffect(() => { if (businessId) loadLink(); }, [businessId, loadLink]);

  const items = computeReorderSuggestions(products, sales);

  const orderQty = (it) => (qtys[it.p.id] !== undefined ? qtys[it.p.id] : it.propose);  // in BOXES
  const setQty = (id, v) => setQtys((prev) => ({ ...prev, [id]: Math.max(0, parseInt(v) || 0) }));

  const toOrder = items.filter((it) => orderQty(it) > 0);

  // The default-link group displays the freshly-looked-up `supplierName`
  // (kept current if the linked business renamed itself); a per-product
  // override displays its own cached `supplier_name` label as saved at
  // pick time, same as business_supplier_links already does — no extra
  // per-group business lookups.
  const groups = {};
  items.forEach((it) => {
    const hasOverride = !!(it.p.supplier_business_id || it.p.supplier_name);
    let eff = effectiveSupplierFor(it.p, link);
    if (eff && !hasOverride && supplierName) eff = { ...eff, supplier_name: supplierName };
    const key = supplierGroupKey(eff);
    if (!groups[key]) groups[key] = { key, supplier: eff, items: [] };
    groups[key].items.push(it);
  });
  // Registered/free-text supplier groups first, the unassigned "none" group last
  const groupList = Object.values(groups).sort((a, b) => {
    if (a.key === "none") return 1;
    if (b.key === "none") return -1;
    return (a.supplier.supplier_name || "").localeCompare(b.supplier.supplier_name || "");
  });
  const groupAgentName = (g) => g.supplier.supplier_name || (g.supplier.supplier_business_id ? `Business ${g.supplier.supplier_business_id}` : "agent");
  const groupToOrder = (g) => g.items.filter((it) => orderQty(it) > 0);

  // Human label for a line, e.g. "2 boxes of 24" or just "3" when box size is 1
  const lineLabel = (it) => {
    const n = orderQty(it);
    return it.box > 1 ? `${n} box${n === 1 ? "" : "es"} of ${it.box}` : `${n}`;
  };

  const orderText = () => {
    const byCat = {};
    toOrder.forEach((it) => {
      const c = it.p.category || "Uncategorised";
      byCat[c] = byCat[c] || [];
      byCat[c].push(`  ${it.p.name}: ${lineLabel(it)}`);
    });
    let out = `${businessName} — Order list\n${new Date().toLocaleDateString()}\n`;
    Object.entries(byCat).forEach(([c, lines]) => { out += `\n${c}:\n${lines.join("\n")}`; });
    return out;
  };

  const shareText = async () => {
    const t = orderText();
    try {
      if (navigator.share) await navigator.share({ title: "Order list", text: t });
      else { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    } catch {}
  };
  const pdf = () => {
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow pop-ups to save the PDF."); return; }
    const byCat = {};
    toOrder.forEach((it) => { const c = it.p.category || "Uncategorised"; (byCat[c] = byCat[c] || []).push(it); });
    let body = "";
    Object.entries(byCat).forEach(([c, list]) => {
      body += `<h3>${c}</h3><table>`;
      list.forEach((it) => { body += `<tr><td>${it.p.name}</td><td style="text-align:right">${lineLabel(it)}</td></tr>`; });
      body += `</table>`;
    });
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Order list</title>
      <style>body{font-family:Arial;max-width:460px;margin:24px auto;padding:0 16px;color:#152019}
      h1{font-size:22px;text-align:center;margin:0}.meta{text-align:center;color:#666;font-size:13px;margin-bottom:12px}
      h3{margin:16px 0 4px;color:#1F9D55}table{width:100%;border-collapse:collapse;font-size:14px}
      td{padding:5px 0;border-bottom:1px solid #eee}</style></head><body>
      <h1>${businessName}</h1><div class="meta">Order list · ${new Date().toLocaleDateString()}</div>
      ${body || "<p>Nothing to order.</p>"}
      <script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  };

  const sendingGroup = sendingGroupKey ? groups[sendingGroupKey] : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <SectionTitle>Order list</SectionTitle>
        <div style={{ display: "flex", gap: 8 }}>
          {link && link.supplier_business_id && (
            <button style={{ ...S.btn, ...S.btnGhost, padding: "6px 10px", fontSize: 12.5 }} onClick={() => setChatOpen(true)}>
              <Send size={13} /> Chat with {supplierName || "agent"}
            </button>
          )}
          <button style={{ ...S.btn, ...S.btnGhost, padding: "6px 10px", fontSize: 12.5 }} onClick={() => setEditingLink(true)}>
            <Pencil size={13} /> {supplierName ? "Change agent" : "Set your agent"}
          </button>
        </div>
      </div>
      <p style={S.hint}>
        Shows items at or below their low-stock level, grouped by supplier — a product's own supplier if you've set
        one for it in its edit screen, otherwise your business's default agent{supplierName ? ` (${supplierName})` : ""}.
        Suggestions come from last 7 days of sales and are shown in BOXES (set each product's box size in its edit
        screen). Adjust any number, then send each group, or use Share/PDF below for the full list.
      </p>

      {items.length === 0 && <p style={S.empty}>Nothing is low right now. 🎉</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {groupList.map((g) => (
          <div key={g.key}>
            <div style={{ ...S.cardName, marginBottom: 8 }}>
              {g.supplier ? `For ${groupAgentName(g)}` : "No supplier set — set one below to send this group directly."}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {g.items.map((it) => (
                <div key={it.p.id} style={S.card}>
                  <div style={{ flex: 1 }}>
                    <div style={S.cardName}>{it.p.name} {it.p.category && <span style={{ ...S.cardMeta, color: goldLt }}>{it.p.category}</span>}</div>
                    <div style={S.cardMeta}>
                      sold {it.sold} last week · {it.p.qty} left
                      {it.box > 1 ? ` → ${it.loose} needed = ${it.propose} box${it.propose === 1 ? "" : "es"} of ${it.box}` : ` → suggest ${it.propose}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <input style={{ ...S.input, width: 64, textAlign: "center", fontWeight: 800 }} type="number"
                      value={orderQty(it)} onChange={(e) => setQty(it.p.id, e.target.value)} />
                    <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>{it.box > 1 ? "boxes" : "qty"}</div>
                  </div>
                </div>
              ))}
            </div>
            {g.supplier ? (
              <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 8, background: `linear-gradient(135deg,${sky},#1E7FAE)` }}
                onClick={() => setSendingGroupKey(g.key)}>
                <ShoppingCart size={16} /> {g.supplier.supplier_business_id ? `Message ${groupAgentName(g)}` : `Order via WhatsApp — ${groupAgentName(g)}`}
              </button>
            ) : (
              <p style={S.hint}>
                Set your business's default agent above ("Set your agent"), or open one of these products' edit
                screen and set a supplier just for it.
              </p>
            )}
          </div>
        ))}
      </div>

      {toOrder.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button style={{ ...S.btn, ...S.btnDark, flex: 1 }} onClick={shareText}>
            <Send size={16} /> {copied ? "✓ Copied" : "Share (text)"}
          </button>
          <button style={{ ...S.btn, ...S.btnGold, flex: 1 }} onClick={pdf}>
            <FileText size={16} /> PDF
          </button>
        </div>
      )}

      {editingLink && (
        <SupplierLinkModal businessId={businessId} link={link} onClose={() => setEditingLink(false)}
          onSaved={async () => { setEditingLink(false); await loadLink(); }} />
      )}
      {sendingGroup && (
        <SupplierThreadModal businessId={businessId} businessName={businessName}
          link={{ supplier_business_id: sendingGroup.supplier.supplier_business_id, supplier_phone: sendingGroup.supplier.supplier_phone }}
          supplierName={groupAgentName(sendingGroup)}
          items={groupToOrder(sendingGroup)} onClose={() => setSendingGroupKey(null)} />
      )}
      {chatOpen && (
        <SupplierThreadModal businessId={businessId} businessName={businessName}
          link={link} supplierName={supplierName} items={[]} onClose={() => setChatOpen(false)} />
      )}
    </>
  );
}

// Search an existing business (find_business) or fall back to a free-text
// name/phone — the picked/typed result is reported to the parent via
// onChange as it changes, the parent decides where it gets persisted
// (business_supplier_links for the business default, products for a
// per-product override). `allowDefault` adds a third "Use default" tab,
// only meaningful for the per-product override case.
function SupplierPicker({ initialBusinessId, initialName, initialPhone, allowDefault, onChange }) {
  const [mode, setMode] = useState(
    allowDefault && !initialBusinessId && !initialName ? "default" : initialBusinessId ? "search" : initialName ? "text" : "search"
  );
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(initialBusinessId ? { id: initialBusinessId, name: initialName } : null);
  const [name, setName] = useState(initialBusinessId ? "" : (initialName || ""));
  const [phone, setPhone] = useState(initialBusinessId ? "" : (initialPhone || ""));

  const search = async () => {
    if (!q.trim()) { setResults([]); return; }
    try { setResults(await sb.rpc("find_business", { p_name: q.trim() })); } catch { setResults([]); }
  };

  useEffect(() => {
    if (mode === "default") onChange({ supplier_business_id: null, supplier_name: null, supplier_phone: null, isDefault: true });
    else if (mode === "search") onChange({ supplier_business_id: picked ? picked.id : null, supplier_name: picked ? picked.name : null, supplier_phone: null, isDefault: false });
    else {
      const trimmed = name.trim();
      onChange({ supplier_business_id: null, supplier_name: trimmed || null, supplier_phone: trimmed ? (phone.trim() || null) : null, isDefault: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, picked, name, phone]);

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {allowDefault && <button style={{ ...S.btn, flex: 1, ...(mode === "default" ? S.btnDark : S.btnGhost) }} onClick={() => setMode("default")}>Use default</button>}
        <button style={{ ...S.btn, flex: 1, ...(mode === "search" ? S.btnDark : S.btnGhost) }} onClick={() => setMode("search")}>On Pamusika</button>
        <button style={{ ...S.btn, flex: 1, ...(mode === "text" ? S.btnDark : S.btnGhost) }} onClick={() => setMode("text")}>Not on the app</button>
      </div>

      {mode === "search" && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...S.input, flex: 1 }} value={q} placeholder="Search business name"
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
            <button style={{ ...S.btn, ...S.btnGhost }} onClick={search}><Search size={16} /></button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {results.map((b) => (
              <button key={b.id} style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer", ...(picked && picked.id === b.id ? S.cardInCart : {}) }}
                onClick={() => setPicked(b)}>
                <div style={{ flex: 1 }}><div style={S.cardName}>{b.name}</div></div>
                {picked && picked.id === b.id && <Check size={16} style={{ color: accent }} />}
              </button>
            ))}
          </div>
          {picked && <p style={{ ...S.hint }}>Selected: <b style={{ color: ink }}>{picked.name}</b></p>}
        </>
      )}
      {mode === "text" && (
        <>
          <Field label="Agent's name" value={name} onChange={setName} placeholder="e.g. Samah Wholesalers" />
          <Field label="Phone (optional)" value={phone} onChange={setPhone} type="tel" placeholder="077…" />
        </>
      )}
      {mode === "default" && (
        <p style={{ ...S.hint, marginTop: 0 }}>This product will order from your business's default agent (see “Set your agent” on the Order list).</p>
      )}
    </>
  );
}

function SupplierLinkModal({ businessId, link, onClose, onSaved }) {
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);

  const valid = current && (current.supplier_business_id || current.supplier_name);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await saveSupplierLink(businessId, {
        supplier_business_id: current.supplier_business_id,
        supplier_name: current.supplier_name,
        supplier_phone: current.supplier_phone,
      });
      await onSaved();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Your supplying agent">
      <p style={{ ...S.hint, marginTop: 0 }}>Link the business that supplies your stock. If they use Pamusika too, search for them below to send orders straight into their Orders tab. Otherwise just save their name and number.</p>
      <SupplierPicker initialBusinessId={link && link.supplier_business_id} initialName={link && link.supplier_name} initialPhone={link && link.supplier_phone} onChange={setCurrent} />
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 10 }}
        disabled={busy || !valid} onClick={save}>
        <Check size={17} /> {busy ? "Saving…" : "Save agent"}
      </button>
    </Modal>
  );
}

// Mirrors create_order_request's server-side composition exactly (see
// church-approval-and-order-chat.sql) — used to preview a message before
// sending, and as the only source of the message text for a free-text
// (not-yet-registered) supplier, since that path never inserts an
// order_requests row for the server to compose it for.
function composeOrderMessage(requesterName, items, note) {
  let msg = `Order request from ${requesterName || "a reseller"}:\n`;
  items.forEach((it) => { msg += `- ${it.qty} ${it.unit || "unit(s)"} of ${it.product_name}\n`; });
  if (note && note.trim()) msg += `\nNote: ${note.trim()}`;
  return msg.trim();
}

// Legacy fallback for an order_requests row saved before the `message`
// column existed — reconstructs a readable line list from its raw items.
function legacyOrderText(o) {
  return (o.items || []).map((it) => `- ${it.qty} ${it.unit || "unit(s)"} of ${it.product_name}`).join("\n");
}

// Powers the floating "new messages" button, visible from any tab — counts
// anything from someone else (the open room, or a direct/agent message)
// newer than this business's own last-checked time.
async function fetchLastMessagesRead(businessId) {
  try {
    const rows = await sb.select("business_message_reads", `business_id=eq.${businessId}`);
    return rows[0] ? rows[0].last_read_at : new Date(0).toISOString();
  } catch { return new Date(0).toISOString(); } // table may not exist yet on older deployments
}
async function markMessagesRead(businessId) {
  const now = new Date().toISOString();
  const existing = await sb.select("business_message_reads", `business_id=eq.${businessId}`).catch(() => []);
  if (existing.length) return sb.patch("business_message_reads", `business_id=eq.${businessId}`, { last_read_at: now });
  return sb.insert("business_message_reads", { business_id: businessId, last_read_at: now });
}
async function fetchUnreadMessageCount(businessId) {
  try {
    const since = await fetchLastMessagesRead(businessId);
    const enc = encodeURIComponent(since);
    const [room, dm] = await Promise.all([
      sb.select("community_chat_messages", `business_id=neq.${businessId}&created_at=gt.${enc}&select=id`),
      sb.select("order_request_messages",
        `or=(requester_business_id.eq.${businessId},supplier_business_id.eq.${businessId})&sender_business_id=neq.${businessId}&created_at=gt.${enc}&select=id`),
    ]);
    return room.length + dm.length;
  } catch { return 0; } // table(s) may not exist yet on older deployments
}

// Every free-text message between two businesses, oldest first — independent
// of whether any order exists yet between them, and independent of which one
// got stored as "requester" vs "supplier" (a plain business-to-business DM,
// started from Community rather than an agent relationship, has no fixed
// direction — whoever opens the conversation first names themselves
// "requester" in the insert, so both directions have to be checked here).
// Same "table may not exist yet on older deployments" fallback as
// fetchSupplierLink, since this ships as an additive migration.
async function fetchThreadMessages(businessIdA, businessIdB) {
  if (!businessIdA || !businessIdB) return [];
  try {
    return await sb.select("order_request_messages",
      `or=(and(requester_business_id.eq.${businessIdA},supplier_business_id.eq.${businessIdB}),and(requester_business_id.eq.${businessIdB},supplier_business_id.eq.${businessIdA}))&order=created_at.asc`);
  } catch { return []; }
}
// orderRequestId is optional context (tags the message to a specific order)
// — a message can be sent any time, order or no order. replyToId, when set,
// quotes one earlier message instead of just appending to the end of a
// thread that may have many messages in it.
function sendOrderRequestMessage(requesterBusinessId, supplierBusinessId, senderBusinessId, body, orderRequestId, replyToId) {
  return sb.rpc("send_order_request_message", {
    p_requester_business_id: requesterBusinessId, p_supplier_business_id: supplierBusinessId,
    p_sender_business_id: senderBusinessId, p_body: body, p_order_request_id: orderRequestId || null,
    p_reply_to_id: replyToId || null,
  });
}

// Merges an order_requests thread with its order_request_messages into one
// chronological timeline, each entry tagged `mine` from the viewing
// business's own point of view — the same thread reads correctly whether
// it's rendered for the requester (their orders are "mine") or the supplier
// (the requester's orders are "theirs", their own replies are "mine").
function buildThreadTimeline(thread, messages, viewerBusinessId) {
  const events = [];
  thread.forEach((o) => {
    events.push({ type: "order", at: o.created_at, o, mine: o.requester_business_id === viewerBusinessId });
    if (o.status !== "pending") events.push({ type: "resolution", at: o.fulfilled_at || o.created_at, o });
  });
  messages.forEach((m) => {
    events.push({ type: "message", at: m.created_at, m, mine: m.sender_business_id === viewerBusinessId });
  });
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

// One bubble per order_requests row (plus a "system reply" once it's
// resolved) interleaved chronologically with free-text order_request_messages
// bubbles — a running history per requester↔supplier pair. "Mine" floats
// right in the existing outgoing style, the other party's in the existing
// system-bubble style, so real replies look like natural additions to the
// chat that already existed here rather than a new visual language.
// `onFulfill`/`onReject` (supplier-only) render inline under a pending order
// that isn't "mine" — i.e. one this viewer received, not sent.
function ChatThread({ thread, messages = [], viewerBusinessId, onFulfill, onReject, busy, onReply }) {
  const events = buildThreadTimeline(thread, messages, viewerBusinessId);
  const messagesById = {};
  messages.forEach((m) => { messagesById[m.id] = m; });
  if (events.length === 0) return <p style={S.empty}>No messages yet — say hello, or send an order below.</p>;
  return (
    <div style={S.chatThread}>
      {events.map((ev) => {
        if (ev.type === "order") {
          return (
            <React.Fragment key={`o-${ev.o.id}`}>
              <div style={ev.mine ? S.chatBubbleOut : S.chatBubbleSystem}>
                {ev.o.message || legacyOrderText(ev.o)}
                <div style={S.chatMeta}>{new Date(ev.o.created_at).toLocaleString()}</div>
              </div>
              {!ev.mine && ev.o.status === "pending" && onFulfill && (
                <div style={{ display: "flex", gap: 8, alignSelf: "flex-start", maxWidth: "88%", width: "88%" }}>
                  <button style={{ ...S.btn, ...S.btnDark, flex: 1, padding: "8px 12px", fontSize: 13 }}
                    disabled={busy} onClick={() => onFulfill(ev.o.id)}><Check size={14} /> Fulfill</button>
                  <button style={{ ...S.btn, ...S.btnGhost, flex: 1, padding: "8px 12px", fontSize: 13, color: "#FF8B7A" }}
                    disabled={busy} onClick={() => onReject(ev.o.id)}>Reject</button>
                </div>
              )}
            </React.Fragment>
          );
        }
        if (ev.type === "resolution") {
          return (
            <div key={`r-${ev.o.id}`} style={{ ...S.chatBubbleSystem, ...(ev.o.status === "rejected" ? S.chatBubbleSystemBad : {}) }}>
              {ev.o.status === "fulfilled" ? "✓ Fulfilled" : `✗ Rejected${ev.o.rejection_reason ? " — " + ev.o.rejection_reason : ""}`}
              {ev.o.fulfilled_at && <div style={S.chatMeta}>{new Date(ev.o.fulfilled_at).toLocaleString()}</div>}
            </div>
          );
        }
        const parent = ev.m.reply_to_id ? messagesById[ev.m.reply_to_id] : null;
        return (
          <div key={`m-${ev.m.id}`} style={ev.mine ? S.chatBubbleOut : S.chatBubbleSystem}>
            {parent && (
              <div style={S.chatQuote}>
                {(parent.sender_business_id === viewerBusinessId ? "You" : "Them")}: {parent.body.length > 60 ? parent.body.slice(0, 60) + "…" : parent.body}
              </div>
            )}
            {ev.m.body}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={S.chatMeta}>{new Date(ev.m.created_at).toLocaleString()}</div>
              {onReply && <button style={S.chatReplyLink} onClick={() => onReply(ev.m)}>Reply</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Plain text + send button, reusing the app's ordinary input/button chrome
// rather than inventing new form styling.
function MessageComposer({ onSend, disabled, disabledHint, replyingTo, onCancelReply }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSend(trimmed, replyingTo ? replyingTo.id : null);
      setBody("");
      if (onCancelReply) onCancelReply();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  if (disabled) return disabledHint ? <p style={{ ...S.hint, marginTop: 0 }}>{disabledHint}</p> : null;
  return (
    <div>
      {replyingTo && (
        <div style={S.chatReplyPreview}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.7 }}>Replying to</div>
            <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{replyingTo.body}</div>
          </div>
          <button style={S.delBtn} onClick={onCancelReply}><X size={14} /></button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...S.input, flex: 1 }} value={body} placeholder="Type a message…" autoComplete="off"
          onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button style={{ ...S.btn, ...S.btnGhost, padding: "11px 14px" }} disabled={busy || !body.trim()} onClick={send}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

// Shared chat layout: a bounded-height box with the message list scrolling
// on its own and the composer always visible as a plain flex sibling at the
// bottom — not scrolled past, not `position: fixed` (which fights mobile
// keyboards in some browsers). `height` should be a dvh-based value on
// mobile so the box — and the composer glued to its bottom — shrinks with
// the on-screen keyboard instead of hiding behind it. Used by every chat
// surface (agent threads, direct messages) so they all behave the same way.
function ChatPanel({ height, thread = [], messages, viewerBusinessId, onFulfill, onReject, busy, onSend, extra }) {
  const [replyingTo, setReplyingTo] = useState(null);
  const sendWithReply = async (body, replyToId) => {
    await onSend(body, replyToId);
    setReplyingTo(null);
  };
  return (
    <div style={{ ...S.chatPanel, height }}>
      <div style={S.chatPanelScroll}>
        <ChatThread thread={thread} messages={messages} viewerBusinessId={viewerBusinessId}
          onFulfill={onFulfill} onReject={onReject} busy={busy} onReply={setReplyingTo} />
      </div>
      {extra}
      <div style={S.chatComposerBar}>
        <MessageComposer onSend={sendWithReply} replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} />
      </div>
    </div>
  );
}

// A per-supplier conversation thread: every order_requests row between this
// business and a registered supplier renders as one outgoing bubble, with
// its eventual fulfilled/rejected outcome as a second bubble, plus any
// free-text order_request_messages interleaved in — and a composer to start
// a new structured order alongside the plain-text reply box. A free-text
// (not-yet-registered) supplier has no server-side history (order_requests
// requires a real supplier_business_id), so that case skips straight to the
// composer and hands off to WhatsApp.
function SupplierThreadModal({ businessId, businessName, link, supplierName, items, onClose }) {
  const supplierBusinessId = link && link.supplier_business_id;
  const supplierPhone = link && link.supplier_phone;
  const [thread, setThread] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(!!supplierBusinessId);
  const [composing, setComposing] = useState(!supplierBusinessId);

  const loadThread = useCallback(async () => {
    if (!supplierBusinessId) return;
    try {
      const [rows, msgs] = await Promise.all([
        sb.select("order_requests", `requester_business_id=eq.${businessId}&supplier_business_id=eq.${supplierBusinessId}&order=created_at.asc`),
        fetchThreadMessages(businessId, supplierBusinessId),
      ]);
      setThread(rows);
      setMessages(msgs);
    } catch { setThread([]); setMessages([]); }
    setLoading(false);
  }, [businessId, supplierBusinessId]);
  useEffect(() => { loadThread(); }, [loadThread]);

  const sendInApp = async (payload, note) => {
    await sb.rpc("create_order_request", {
      p_requester_business_id: businessId, p_supplier_business_id: supplierBusinessId,
      p_items: payload, p_note: note || null,
    });
    setComposing(false);
    await loadThread();
  };

  const latestOrderId = thread.length ? thread[thread.length - 1].id : null;
  const sendMessage = async (body, replyToId) => {
    await sendOrderRequestMessage(businessId, supplierBusinessId, businessId, body, latestOrderId, replyToId);
    await loadThread();
  };

  return (
    <Modal onClose={onClose} title={supplierName || "Agent"}>
      {supplierBusinessId && (loading ? <Loading /> : (
        <ChatPanel height="52dvh" thread={thread} messages={messages} viewerBusinessId={businessId} onSend={sendMessage} />
      ))}
      {!composing ? (
        <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginTop: 12 }} onClick={() => setComposing(true)}>
          <Plus size={16} /> New order
        </button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <OrderComposer
            businessName={businessName} supplierBusinessId={supplierBusinessId} supplierPhone={supplierPhone}
            supplierName={supplierName} items={items}
            onSend={sendInApp}
            onCancel={() => setComposing(supplierBusinessId ? false : true)}
            onSentWhatsapp={() => { if (!supplierBusinessId) onClose(); }}
          />
        </div>
      )}
    </Modal>
  );
}

// Compose a new message: pick products/quantities (from the reorder
// suggestions computed above) and an optional note — never free-typed.
// `onSend` performs the actual create_order_request call (the parent knows
// businessId/supplierBusinessId); `onSentWhatsapp` fires after the WhatsApp
// hand-off for a free-text supplier, since nothing is persisted there.
function OrderComposer({ businessName, supplierBusinessId, supplierPhone, supplierName, items, onSend, onCancel, onSentWhatsapp }) {
  const [lines, setLines] = useState(items.map((it) => ({ product_name: it.p.name, qty: it.propose, unit: it.box > 1 ? `box of ${it.box}` : "unit" })));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setQty = (i, v) => setLines((prev) => prev.map((l, j) => j === i ? { ...l, qty: Math.max(0, parseInt(v) || 0) } : l));
  const removeLine = (i) => setLines((prev) => prev.filter((_, j) => j !== i));
  const payload = lines.filter((l) => l.qty > 0);
  const preview = payload.length ? composeOrderMessage(businessName, payload, note) : "";

  const sendInApp = async () => {
    if (payload.length === 0) return;
    setBusy(true); setErr("");
    try { await onSend(payload, note.trim() || null); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const openWhatsapp = () => {
    if (payload.length === 0) return;
    const digits = (supplierPhone || "").replace(/\D/g, "");
    if (!digits) { setErr("No phone number saved for this agent — add one in \"Set your agent\"."); return; }
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(preview)}`, "_blank");
    onSentWhatsapp();
  };

  return (
    <div style={{ borderTop: `1px solid ${line}`, paddingTop: 14, marginTop: 4 }}>
      <SectionTitle>New order</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((l, i) => (
          <div key={i} style={S.cartLine}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{l.product_name}</div>
              <div style={S.cardMeta}>{l.unit}</div>
            </div>
            <input style={{ ...S.input, width: 64, textAlign: "center" }} type="number" value={l.qty}
              onChange={(e) => setQty(i, e.target.value)} />
            <button style={S.delBtn} onClick={() => removeLine(i)}><X size={16} /></button>
          </div>
        ))}
        {lines.length === 0 && <p style={S.empty}>Nothing left to order.</p>}
      </div>
      <Field label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. deliver Friday please" />
      {preview && (
        <div style={{ ...S.sellSummary, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <span style={{ ...S.fieldLabel, marginBottom: 0 }}>Message preview</span>
          <span style={{ whiteSpace: "pre-wrap", fontWeight: 600 }}>{preview}</span>
        </div>
      )}
      {err && <p style={S.errTxt}>{err}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {supplierBusinessId ? (
          <button style={{ ...S.btn, ...S.btnDark, flex: 1 }} disabled={busy || payload.length === 0} onClick={sendInApp}>
            <Send size={17} /> {busy ? "Sending…" : "Send order"}
          </button>
        ) : (
          <button style={{ ...S.btn, ...S.btnDark, flex: 1 }} disabled={payload.length === 0} onClick={openWhatsapp}>
            <Send size={17} /> Open WhatsApp with this order
          </button>
        )}
        <button style={{ ...S.btn, ...S.btnGhost, flex: 1 }} onClick={onCancel}>Cancel</button>
      </div>
      {!supplierBusinessId && (
        <p style={{ ...S.hint, marginTop: 8 }}>
          This agent isn't on Pamusika yet, so there's no in-app history — opening WhatsApp with the message
          already filled in is the record; you still send it yourself.
        </p>
      )}
    </div>
  );
}

// A plain 1:1 conversation between two businesses — no order attached, just
// messages. Reuses the same storage as the agent conversations
// (order_request_messages) since that table is already just "messages
// between a business pair" underneath; this simply never has any
// order_requests rows in the mix, so ChatThread gets an empty `thread`.
function DirectMessageModal({ businessId, otherId, otherName, onClose }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setMessages(await fetchThreadMessages(businessId, otherId));
    setLoading(false);
  }, [businessId, otherId]);
  useEffect(() => { load(); }, [load]);

  const sendMessage = async (body, replyToId) => {
    await sendOrderRequestMessage(businessId, otherId, businessId, body, null, replyToId);
    await load();
  };

  return (
    <Modal onClose={onClose} title={otherName || "Business"}>
      {loading ? <Loading /> : (
        <ChatPanel height="68dvh" messages={messages} viewerBusinessId={businessId} onSend={sendMessage} />
      )}
    </Modal>
  );
}

// Search any business by name (find_business, same lookup Login/SupplierPicker
// use) and start a direct conversation with them — the way to message someone
// you haven't talked to before and didn't just see post in the room.
function StartDirectMessage({ businessId, onOpen }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { setResults(await sb.rpc("find_business", { p_name: q.trim() })); } catch { setResults([]); }
    setBusy(false);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...S.input, flex: 1 }} value={q} placeholder="Find a business by name…"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
        <button style={{ ...S.btn, ...S.btnGhost }} disabled={busy || !q.trim()} onClick={search}><Search size={16} /></button>
      </div>
      {results.filter((b) => b.id !== businessId).map((b) => (
        <button key={b.id} style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer", marginTop: 8 }}
          onClick={() => { onOpen({ id: b.id, name: b.name }); setResults([]); setQ(""); }}>
          <div style={{ flex: 1 }}><div style={S.cardName}>{b.name}</div></div>
          <Send size={15} style={{ color: muted }} />
        </button>
      ))}
    </div>
  );
}

// One open room every business on the app shares, plus direct messages to
// any one business — separate from the private business↔agent threads
// above (those live under the Order/Orders tabs). Polls while mounted since
// there's no realtime subscription in this app, same idea as useData's 60s
// refresh.
function CommunityChat({ businessId, businessName }) {
  const [view, setView] = useState("room"); // "room" | "dms"
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [dmPartners, setDmPartners] = useState([]); // [{id, name}]
  const [dmTarget, setDmTarget] = useState(null);   // {id, name} or null
  const [replyingTo, setReplyingTo] = useState(null); // message being replied to, or null

  const load = useCallback(async () => {
    try {
      const rows = await sb.select("community_chat_messages", "order=created_at.desc&limit=200");
      setMessages(rows.slice().reverse());
    } catch { setMessages([]); }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const loadDmPartners = useCallback(async () => {
    try {
      const [asRequester, asSupplier] = await Promise.all([
        sb.select("order_request_messages", `requester_business_id=eq.${businessId}&select=supplier_business_id`),
        sb.select("order_request_messages", `supplier_business_id=eq.${businessId}&select=requester_business_id`),
      ]);
      const ids = [...new Set([
        ...asRequester.map((r) => r.supplier_business_id),
        ...asSupplier.map((r) => r.requester_business_id),
      ])];
      if (ids.length === 0) { setDmPartners([]); return; }
      const bizzes = await sb.select("businesses", `id=in.(${ids.join(",")})&select=id,name`);
      setDmPartners(bizzes.map((b) => ({ id: b.id, name: b.name })));
    } catch { setDmPartners([]); }
  }, [businessId]);
  useEffect(() => { if (view === "dms") loadDmPartners(); }, [view, loadDmPartners]);

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await sb.rpc("send_community_message", {
        p_business_id: businessId, p_sender_name: businessName, p_body: trimmed,
        p_reply_to_id: replyingTo ? replyingTo.id : null,
      });
      setBody("");
      setReplyingTo(null);
      await load();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  const messagesById = {};
  messages.forEach((m) => { messagesById[m.id] = m; });

  return (
    <>
      <SectionTitle>Community</SectionTitle>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button style={{ ...S.btn, flex: 1, ...(view === "room" ? S.btnDark : S.btnGhost) }} onClick={() => setView("room")}>Room</button>
        <button style={{ ...S.btn, flex: 1, ...(view === "dms" ? S.btnDark : S.btnGhost) }} onClick={() => setView("dms")}>Direct messages</button>
      </div>

      {view === "dms" ? (
        <>
          <p style={S.hint}>Message one business directly, instead of the whole room.</p>
          <StartDirectMessage businessId={businessId} onOpen={setDmTarget} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dmPartners.map((p) => (
              <button key={p.id} style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer" }}
                onClick={() => setDmTarget(p)}>
                <div style={{ flex: 1 }}><div style={S.cardName}>{p.name}</div></div>
                <Send size={15} style={{ color: muted }} />
              </button>
            ))}
            {dmPartners.length === 0 && <p style={S.empty}>No direct messages yet — search above to start one.</p>}
          </div>
        </>
      ) : (
        // Bounded-height box, not the normal page flow: the message list is
        // the only part that scrolls, and the composer sits as a plain flex
        // sibling at the bottom of the box — always visible, never something
        // you have to scroll down past the whole history to reach. `dvh`
        // (dynamic viewport height) means on a phone this box automatically
        // shrinks when the on-screen keyboard opens, so the composer stays
        // sat right above the keyboard instead of hiding behind it.
        <div style={{ ...S.chatPanel, height: "calc(100dvh - 280px)", minHeight: 220 }}>
          <p style={{ ...S.hint, marginTop: 0 }}>One open chat for every business on Pamusika — say hello, ask a question, share a tip. Tap a name to message them directly instead.</p>
          {loading ? <Loading /> : (
            <div style={S.chatPanelScroll}>
              {messages.length === 0 && <p style={S.empty}>No messages yet — be the first to say something.</p>}
              <div style={S.chatThread}>
                {messages.map((m) => {
                  const mine = m.business_id === businessId;
                  const parent = m.reply_to_id ? messagesById[m.reply_to_id] : null;
                  return (
                    <div key={m.id} style={mine ? S.chatBubbleOut : S.chatBubbleSystem}>
                      {!mine && (
                        <button
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11.5, fontWeight: 800, opacity: 0.75, marginBottom: 2, color: "inherit", display: "block" }}
                          onClick={() => setDmTarget({ id: m.business_id, name: m.sender_name })}>
                          {m.sender_name}
                        </button>
                      )}
                      {parent && (
                        <div style={S.chatQuote}>
                          {parent.sender_name}: {parent.body.length > 60 ? parent.body.slice(0, 60) + "…" : parent.body}
                        </div>
                      )}
                      {m.body}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={S.chatMeta}>{new Date(m.created_at).toLocaleString()}</div>
                        <button style={S.chatReplyLink} onClick={() => setReplyingTo(m)}>Reply</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div style={S.chatComposerBar}>
            {replyingTo && (
              <div style={S.chatReplyPreview}>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.7 }}>Replying to {replyingTo.sender_name}</div>
                  <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{replyingTo.body}</div>
                </div>
                <button style={S.delBtn} onClick={() => setReplyingTo(null)}><X size={14} /></button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...S.input, flex: 1 }} value={body} placeholder="Type a message…" autoComplete="off"
                onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
              <button style={{ ...S.btn, ...S.btnGhost, padding: "11px 14px" }} disabled={busy || !body.trim()} onClick={send}>
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {dmTarget && (
        <DirectMessageModal businessId={businessId} otherId={dmTarget.id} otherName={dmTarget.name}
          onClose={() => { setDmTarget(null); if (view === "dms") loadDmPartners(); }} />
      )}
    </>
  );
}

// Agent's inbox of incoming order requests from businesses that link to it as supplier
function OrdersInbox({ businessId }) {
  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]); // every business that has linked us as their agent
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [threadRequesterId, setThreadRequesterId] = useState(null);   // opens the full conversation with one requester

  const load = useCallback(async () => {
    try {
      const [rows, links] = await Promise.all([
        sb.select("order_requests", `supplier_business_id=eq.${businessId}&order=created_at.desc`),
        sb.select("business_supplier_links", `supplier_business_id=eq.${businessId}&select=business_id`).catch(() => []),
      ]);
      setOrders(rows);
      setClients(links.map((l) => l.business_id));
      const ids = [...new Set([...rows.map((r) => r.requester_business_id), ...links.map((l) => l.business_id)])];
      if (ids.length) {
        const bizzes = await sb.select("businesses", `id=in.(${ids.join(",")})&select=id,name`);
        const map = {}; bizzes.forEach((b) => { map[b.id] = b.name; });
        setNames(map);
      }
    } catch {}
    setLoading(false);
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const fulfill = async (id) => {
    setBusy(true);
    try { await sb.rpc("fulfill_order_request", { p_id: id }); await load(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const reject = async (id) => {
    const reason = window.prompt("Reason for rejecting (optional):") || null;
    setBusy(true);
    try { await sb.rpc("reject_order_request", { p_id: id, p_reason: reason }); await load(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  if (loading) return <Loading />;
  const pending = orders.filter((o) => o.status === "pending");
  const done = orders.filter((o) => o.status !== "pending");
  const requesterLabel = (id) => names[id] || `Business ${id}`;
  // Clients who've linked us as their agent but never sent an order yet —
  // without this they'd have no way to be messaged first.
  const orderedIds = new Set(orders.map((o) => o.requester_business_id));
  const chatOnlyClients = clients.filter((id) => !orderedIds.has(id));

  return (
    <>
      {chatOnlyClients.length > 0 && (
        <>
          <SectionTitle>Chats</SectionTitle>
          <p style={S.hint}>Businesses using you as their agent — message them any time, even before they've ordered.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
            {chatOnlyClients.map((id) => (
              <button key={id} style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer" }}
                onClick={() => setThreadRequesterId(id)}>
                <div style={{ flex: 1 }}><div style={S.cardName}>{requesterLabel(id)}</div></div>
                <Send size={15} style={{ color: muted }} />
              </button>
            ))}
          </div>
        </>
      )}
      <SectionTitle>Incoming orders</SectionTitle>
      <p style={S.hint}>Requests sent to you by businesses that use you as their supplier.</p>
      {pending.length === 0 && <p style={S.empty}>No pending orders.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {pending.map((o) => (
          <div key={o.id} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{requesterLabel(o.requester_business_id)}
                  <span style={{ ...S.invTag, background: "#FFF1DA", color: "#B26A00" }}>pending</span>
                </div>
                <div style={S.cardMeta}>{new Date(o.created_at).toLocaleString()}</div>
              </div>
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.5, background: "rgba(255,255,255,0.05)", border: `1px solid ${line}`, borderRadius: 10, padding: "10px 12px" }}>
              {o.message || legacyOrderText(o)}
            </div>
            {!o.message && o.note && <div style={S.cardMeta}>Note: {o.note}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.btn, ...S.btnDark, flex: 1 }} disabled={busy} onClick={() => fulfill(o.id)}><Check size={16} /> Fulfill</button>
              <button style={{ ...S.btn, ...S.btnGhost, flex: 1, color: "#FF8B7A" }} disabled={busy} onClick={() => reject(o.id)}>Reject</button>
            </div>
            <button style={{ ...S.btn, ...S.btnGhost, padding: "8px 12px", fontSize: 12.5 }}
              onClick={() => setThreadRequesterId(o.requester_business_id)}>
              <Send size={13} /> Messages
            </button>
          </div>
        ))}
      </div>
      {done.length > 0 && <>
        <SectionTitle>History</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {done.map((o) => (
            <div key={o.id} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>{requesterLabel(o.requester_business_id)}
                    <span style={{ ...S.invTag, ...(o.status === "fulfilled" ? {} : { background: "#FFE2E2", color: "#C0392B" }) }}>{o.status}</span>
                  </div>
                  <div style={S.cardMeta}>{new Date(o.created_at).toLocaleString()}</div>
                </div>
              </div>
              <button style={{ ...S.btn, ...S.btnGhost, padding: "8px 12px", fontSize: 12.5 }}
                onClick={() => setThreadRequesterId(o.requester_business_id)}>
                <Send size={13} /> Messages
              </button>
            </div>
          ))}
        </div>
      </>}
      {threadRequesterId && (
        <SupplierOrderThreadModal businessId={businessId} requesterId={threadRequesterId}
          requesterName={requesterLabel(threadRequesterId)}
          onClose={() => setThreadRequesterId(null)} onActioned={load} />
      )}
    </>
  );
}

// The supplier's side of the same conversation SupplierThreadModal shows the
// requester — reuses the same merged order+message ChatThread timeline, just
// viewed with this business as `viewerBusinessId` so the requester's orders
// render as "theirs" and pick up inline Fulfill/Reject, while this business's
// own replies render as "mine". Scoped to one requester at a time, same as
// SupplierThreadModal is scoped to one supplier at a time.
function SupplierOrderThreadModal({ businessId, requesterId, requesterName, onClose, onActioned }) {
  const [thread, setThread] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rows, msgs] = await Promise.all([
        sb.select("order_requests", `requester_business_id=eq.${requesterId}&supplier_business_id=eq.${businessId}&order=created_at.asc`),
        fetchThreadMessages(requesterId, businessId),
      ]);
      setThread(rows);
      setMessages(msgs);
    } catch { setThread([]); setMessages([]); }
    setLoading(false);
  }, [businessId, requesterId]);
  useEffect(() => { load(); }, [load]);

  const fulfill = async (id) => {
    setBusy(true);
    try { await sb.rpc("fulfill_order_request", { p_id: id }); await load(); await onActioned(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const reject = async (id) => {
    const reason = window.prompt("Reason for rejecting (optional):") || null;
    setBusy(true);
    try { await sb.rpc("reject_order_request", { p_id: id, p_reason: reason }); await load(); await onActioned(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const latestOrderId = thread.length ? thread[thread.length - 1].id : null;
  const sendMessage = async (body, replyToId) => {
    await sendOrderRequestMessage(requesterId, businessId, businessId, body, latestOrderId, replyToId);
    await load();
  };

  return (
    <Modal onClose={onClose} title={requesterName || "Business"}>
      {loading ? <Loading /> : (
        <ChatPanel height="68dvh" thread={thread} messages={messages} viewerBusinessId={businessId}
          onFulfill={fulfill} onReject={reject} busy={busy} onSend={sendMessage} />
      )}
    </Modal>
  );
}

// Admin customer list, built from sales history — for building a WhatsApp group etc.
function Customers({ sales }) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState("");
  const [menuFor, setMenuFor] = useState(null);   // customer name whose menu is open
  const [salesFor, setSalesFor] = useState(null);  // customer whose sales we're viewing

  // unique customers with phone, purchase count, last seen, total spent
  const map = {};
  sales.forEach((s) => {
    const name = (s.customer_name || "").trim();
    if (!name) return;
    if (!map[name]) map[name] = { name, phone: s.customer_phone || "", count: 0, total: 0, at: s.sold_at };
    map[name].count += 1;
    map[name].total += Number(s.total);
    if (s.customer_phone) map[name].phone = map[name].phone || s.customer_phone;
    if (new Date(s.sold_at) > new Date(map[name].at)) {
      map[name].at = s.sold_at;
      if (s.customer_phone) map[name].phone = s.customer_phone;
    }
  });
  let list = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  const query = q.trim().toLowerCase();
  if (query) list = list.filter((c) => c.name.toLowerCase().includes(query) || (c.phone || "").includes(query));

  const withPhones = list.filter((c) => c.phone);

  const copy = async (textVal, label) => {
    try {
      await navigator.clipboard.writeText(textVal);
      setCopied(label); setTimeout(() => setCopied(""), 1600);
    } catch { alert("Could not copy automatically. Long-press to copy:\n\n" + textVal); }
  };
  const copyAllNumbers = () => copy(withPhones.map((c) => c.phone).join(", "), "all");

  return (
    <>
      <SectionTitle>Customers ({list.length})</SectionTitle>
      <p style={S.hint}>Built automatically from sales. Use the numbers to create your WhatsApp group.</p>

      <SearchBar value={q} onChange={setQ} />

      {withPhones.length > 0 && (
        <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginBottom: 12 }} onClick={copyAllNumbers}>
          {copied === "all" ? "✓ Copied all numbers" : `Copy all ${withPhones.length} phone numbers`}
        </button>
      )}

      {list.length === 0 && <p style={S.empty}>No customers yet. They’re added automatically when a sale records a name.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((c) => (
          <div key={c.name} style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{c.name}</div>
                <div style={S.cardMeta}>
                  {c.phone || "no number"} · {c.count} purchase{c.count === 1 ? "" : "s"} · {money(c.total)}
                </div>
              </div>
              <button style={{ background: "none", border: "none", color: ink, cursor: "pointer", fontSize: 22, padding: "0 6px", fontWeight: 800 }}
                onClick={() => setMenuFor(menuFor === c.name ? null : c.name)}>⋯</button>
            </div>
            {menuFor === c.name && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {c.phone && <button style={{ ...S.btn, ...S.btnGhost, flex: 1, padding: "9px 0" }} onClick={() => { copy(c.phone, c.name); }}>{copied === c.name ? "✓ Copied" : "Copy number"}</button>}
                {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} style={{ ...S.btn, ...S.btnGhost, flex: 1, padding: "9px 0", textDecoration: "none", textAlign: "center" }}>Call</a>}
                <button style={{ ...S.btn, ...S.btnDark, flex: 1, padding: "9px 0" }} onClick={() => { setSalesFor(c); setMenuFor(null); }}>See sales</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {salesFor && <CustomerSalesModal customer={salesFor} sales={sales.filter((s) => (s.customer_name || "").trim() === salesFor.name)} onClose={() => setSalesFor(null)} />}
    </>
  );
}

// View a single customer's purchase history
function CustomerSalesModal({ customer, sales, onClose }) {
  const invoices = groupByInvoice(sales);
  return (
    <Modal onClose={onClose} title={customer.name}>
      <div style={{ ...S.cardMeta, marginBottom: 10 }}>{customer.phone || "no number"} · {money(customer.total)} total</div>
      {invoices.length === 0 && <p style={S.empty}>No sales found.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {invoices.map((inv) => (
          <div key={inv.key} style={S.saleRow}>
            <div style={{ flex: 1 }}>
              <div style={S.saleName}>{inv.invoice_no || "—"}</div>
              <div style={S.cardMeta}>{new Date(inv.when).toLocaleDateString()} · {inv.lines.length} item{inv.lines.length > 1 ? "s" : ""}</div>
            </div>
            <div style={S.saleName}>{money(inv.total)}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// Admin comparisons: two periods side by side + week-by-week trend
function Compare({ sales }) {
  const today = localDateStr(new Date());
  const weekAgo = localDateStr(new Date(Date.now() - 6 * 86400000));
  const twoWeek = localDateStr(new Date(Date.now() - 13 * 86400000));
  const eightDays = localDateStr(new Date(Date.now() - 7 * 86400000));

  const [aFrom, setAFrom] = useState(weekAgo);
  const [aTo, setATo] = useState(today);
  const [bFrom, setBFrom] = useState(twoWeek);
  const [bTo, setBTo] = useState(eightDays);
  // Only compute after the user taps Filter (so selecting dates doesn't jump early)
  const [applied, setApplied] = useState(null);

  const stats = (from, to) => {
    const rows = sales.filter((s) => {
      const d = localDateStr(new Date(s.sold_at));
      return d >= from && d <= to;
    });
    const total = rows.reduce((a, s) => a + Number(s.total), 0);
    const god = rows.reduce((a, s) => a + Number(s.tithe), 0);
    const invoices = new Set(rows.map((s) => s.invoice_no || s.id));
    const customers = new Set(rows.map((s) => (s.customer_name || "").trim().toLowerCase()).filter(Boolean));
    return { total, god, tx: invoices.size, customers: customers.size, rows };
  };

  const Row = ({ label, a, b, fmt }) => {
    const diff = a - b;
    const up = diff > 0, down = diff < 0;
    return (
      <div style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${line}` }}>
        <div style={{ flex: 1, fontWeight: 600 }}>{label}</div>
        <div style={{ width: 90, textAlign: "right", fontWeight: 800, color: accent }}>{fmt(a)}</div>
        <div style={{ width: 90, textAlign: "right", fontWeight: 800, color: muted }}>{fmt(b)}</div>
        <div style={{ width: 70, textAlign: "right", fontSize: 12, fontWeight: 700, color: up ? "#1F9D55" : down ? "#C0392B" : muted }}>
          {up ? "▲" : down ? "▼" : ""}{fmt(Math.abs(diff))}
        </div>
      </div>
    );
  };

  // Week-by-week trend, weeks running Tuesday → Monday (last 6 weeks)
  // Find the most recent Tuesday (start of the current business week).
  const now = new Date();
  const dow = now.getDay();               // 0=Sun..6=Sat; Tuesday=2
  const daysSinceTue = (dow - 2 + 7) % 7;
  const thisTue = new Date(now); thisTue.setDate(now.getDate() - daysSinceTue);
  const weeks = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(thisTue); start.setDate(thisTue.getDate() - i * 7);
    const end = new Date(start); end.setDate(start.getDate() + 6);   // Monday
    const st = stats(localDateStr(start), localDateStr(end));
    weeks.push({ label: `${localDateStr(start).slice(5)}–${localDateStr(end).slice(5)}`, total: st.total });
  }
  const maxWeek = Math.max(...weeks.map((w) => w.total), 1);

  const A = applied ? stats(applied.aFrom, applied.aTo) : null;
  const B = applied ? stats(applied.bFrom, applied.bTo) : null;

  return (
    <>
      <SectionTitle>Compare two periods</SectionTitle>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...S.fieldLabel, color: accent }}>Period A</div>
          <input style={{ ...S.input, marginBottom: 4 }} type="date" value={aFrom} onChange={(e) => setAFrom(e.target.value)} />
          <input style={S.input} type="date" value={aTo} onChange={(e) => setATo(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ ...S.fieldLabel, color: muted }}>Period B</div>
          <input style={{ ...S.input, marginBottom: 4 }} type="date" value={bFrom} onChange={(e) => setBFrom(e.target.value)} />
          <input style={S.input} type="date" value={bTo} onChange={(e) => setBTo(e.target.value)} />
        </div>
      </div>
      <button style={{ ...S.btn, ...S.btnGold, width: "100%", marginBottom: 14 }}
        onClick={() => setApplied({ aFrom, aTo, bFrom, bTo })}>
        <Search size={17} /> Filter &amp; compare
      </button>

      {!applied && <p style={S.empty}>Pick your two date ranges, then tap “Filter &amp; compare”.</p>}

      {applied && (
        <div style={{ ...S.card, flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ display: "flex", fontSize: 11, color: muted, fontWeight: 700, textTransform: "uppercase" }}>
            <div style={{ flex: 1 }}></div>
            <div style={{ width: 90, textAlign: "right" }}>A</div>
            <div style={{ width: 90, textAlign: "right" }}>B</div>
            <div style={{ width: 70, textAlign: "right" }}>Diff</div>
          </div>
          <Row label="Total sales" a={A.total} b={B.total} fmt={money} />
          <Row label="To God" a={A.god} b={B.god} fmt={money} />
          <Row label="Transactions" a={A.tx} b={B.tx} fmt={(n) => String(Math.round(n))} />
          <Row label="Customers" a={A.customers} b={B.customers} fmt={(n) => String(Math.round(n))} />
        </div>
      )}

      <SectionTitle>Week-by-week (Tue–Mon, last 6 weeks)</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {weeks.map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 96, fontSize: 11, color: muted }}>{w.label}</div>
            <div style={{ flex: 1, background: "rgba(255,255,255,0.08)", borderRadius: 6, height: 22, position: "relative", overflow: "hidden" }}>
              <div style={{ width: `${(w.total / maxWeek) * 100}%`, background: `linear-gradient(90deg,${accent},${lime})`, height: "100%", borderRadius: 6 }} />
            </div>
            <div style={{ width: 70, textAlign: "right", fontWeight: 800, fontSize: 13 }}>{money(w.total)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

const WEEKDAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function Report({ sales, products, low, cats = [], businessId, businessName, weekStartDay = 2, onWeekStartDayChange }) {
  // The week runs from whichever day is chosen (default Tuesday) to the day
  // before it, next week. Let the admin step back through weeks, or switch
  // to picking an exact date range instead — not everyone reports weekly.
  const [weekOffset, setWeekOffset] = useState(0);   // 0 = current week
  const [cat, setCat] = useState("All");
  const [customRange, setCustomRange] = useState(false);
  const [fromDate, setFromDate] = useState(() => localDateStr(new Date()));
  const [toDate, setToDate] = useState(() => localDateStr(new Date()));
  const [salary, setSalary] = useState({ outside_salary: 0, outside_tithe_pct: 10 });
  const [salaryCats, setSalaryCats] = useState([]); // [{category, pct}] — a business can pull salary from several
  const [editingSalary, setEditingSalary] = useState(false);
  const [copied, setCopied] = useState(false);
  // A business reselling for other companies (e.g. on consignment) may not
  // want every company's sales going out in ITS OWN shared report — this
  // only affects what "Share report" sends, never the on-screen totals
  // above, which still show everything for the owner's own tracking.
  const [excludedCats, setExcludedCats] = useState(() => new Set());
  const toggleExcluded = (c) => setExcludedCats((prev) => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next;
  });
  // A category resold on behalf of another registered Pamusika business —
  // e.g. Samah Valley selling for Munonwa — can be sent straight into that
  // business's own report instead of (or as well as) staying in this one.
  const [categoryLinks, setCategoryLinks] = useState([]); // [{category, target_business_id}]
  const [receivedReports, setReceivedReports] = useState([]); // reports sent TO this business, this week
  const [resaleBizNames, setResaleBizNames] = useState({}); // business_id -> name
  const [linkingCat, setLinkingCat] = useState(null); // category currently being linked/relinked
  const [sendingCat, setSendingCat] = useState(null); // category currently being sent, for a busy spinner
  const [sentToast, setSentToast] = useState("");

  const loadSalary = useCallback(async () => {
    if (!businessId) return;
    const [settings, catPcts] = await Promise.all([fetchSalarySettings(businessId), fetchSalaryCategories(businessId)]);
    setSalary(settings);
    setSalaryCats(catPcts);
  }, [businessId]);
  useEffect(() => { loadSalary(); }, [loadSalary]);

  const catOf = {}, pctOf = {};
  (products || []).forEach((p) => { catOf[p.name] = p.category || "Uncategorised"; pctOf[p.name] = Number(p.tithe_pct) || 0; });
  // Live "to God" for a sale row, using the product's CURRENT percentage —
  // except a catch-up entry (no product_id, so it can never match a real
  // product here) always uses whatever tithe was actually stamped on it at
  // the time, since there's no live product rate to look up instead.
  const titheOf = (s) => s.product_id == null ? Number(s.tithe || 0) : Number(s.total) * (pctOf[s.product_name] || 0) / 100;

  const now = new Date();
  const dow = now.getDay();
  const daysSinceStart = (dow - weekStartDay + 7) % 7;
  const cycleStart = new Date(now); cycleStart.setHours(0,0,0,0);
  cycleStart.setDate(now.getDate() - daysSinceStart - weekOffset * 7);
  const cycleEnd = new Date(cycleStart); cycleEnd.setDate(cycleStart.getDate() + 6);
  // A custom date range replaces the weekly cycle entirely when it's on —
  // not everyone reports on a fixed weekly schedule.
  const weekStart = customRange ? new Date(fromDate + "T00:00:00") : cycleStart;
  const weekEnd = customRange ? new Date(toDate + "T00:00:00") : cycleEnd;
  const startStr = customRange ? fromDate : localDateStr(weekStart);
  const endStr = customRange ? toDate : localDateStr(weekEnd);
  const startDayName = WEEKDAY_NAMES[weekStartDay];
  const endDayName = WEEKDAY_NAMES[(weekStartDay + 6) % 7];
  const startDayAbbr = startDayName.slice(0, 3), endDayAbbr = endDayName.slice(0, 3);
  const rangeLabel = customRange
    ? `${weekStart.toLocaleDateString()} → ${weekEnd.toLocaleDateString()}`
    : `${weekStart.toLocaleDateString()} (${startDayAbbr}) → ${weekEnd.toLocaleDateString()} (${endDayAbbr})`;

  const loadResale = useCallback(async () => {
    if (!businessId) return;
    const [links, received] = await Promise.all([fetchCategoryLinks(businessId), fetchReceivedReports(businessId, startStr, endStr)]);
    setCategoryLinks(links);
    setReceivedReports(received);
    const ids = [...new Set([...links.map((l) => l.target_business_id), ...received.map((r) => r.from_business_id)])];
    if (ids.length) {
      try {
        const bizzes = await sb.select("businesses", `id=in.(${ids.join(",")})&select=id,name`);
        const map = {}; bizzes.forEach((b) => { map[b.id] = b.name; });
        setResaleBizNames(map);
      } catch {}
    }
  }, [businessId, startStr, endStr]);
  useEffect(() => { loadResale(); }, [loadResale]);

  const inWeek = (s) => {
    const d = localDateStr(new Date(s.sold_at));
    return d >= startStr && d <= endStr;
  };
  const weekRows = sales.filter(inWeek);                 // all categories, this week
  const inCat = (s) => cat === "All" || (catOf[s.product_name] || "Uncategorised") === cat;
  const rows = weekRows.filter(inCat);                   // selected category

  const totalSales = rows.reduce((a, s) => a + Number(s.total), 0);
  const totalTithe = rows.reduce((a, s) => a + titheOf(s), 0);
  const cash = totalSales - totalTithe;

  // Per-category breakdown for the whole week (always shown)
  const catRows = {};
  weekRows.forEach((s) => {
    const c = catOf[s.product_name] || "Uncategorised";
    catRows[c] = catRows[c] || { sales: 0, tithe: 0 };
    catRows[c].sales += Number(s.total);
    catRows[c].tithe += titheOf(s);
  });
  // Reports sent in by resellers count under their OWN category (e.g.
  // "Pamusika" for approved payments) — not a per-sender label — so a
  // salary % set on that category actually finds this revenue. Several
  // received reports in the same category (e.g. many businesses' payments,
  // all tagged "Pamusika") combine into one row here; who each part came
  // from is still shown separately in "Received from resellers" below.
  receivedReports.forEach((r) => {
    const c = r.category;
    catRows[c] = catRows[c] || { sales: 0, tithe: 0 };
    catRows[c].sales += Number(r.total_sales);
    catRows[c].tithe += Number(r.total_tithe);
  });
  const weekTotalSales = Object.values(catRows).reduce((a, c) => a + c.sales, 0);
  const weekTotalTithe = Object.values(catRows).reduce((a, c) => a + c.tithe, 0);

  const linkFor = (c) => categoryLinks.find((l) => l.category === c);
  const sendCategoryReport = async (c) => {
    const link = linkFor(c);
    if (!link) return;
    setSendingCat(c);
    try {
      const d = catRows[c] || { sales: 0, tithe: 0 };
      await sendResellerReport({
        receivingBusinessId: link.target_business_id, fromBusinessId: businessId, fromBusinessName: businessName,
        category: c, weekStart: startStr, weekEnd: endStr, totalSales: d.sales, totalTithe: d.tithe,
      });
      setExcludedCats((prev) => new Set(prev).add(c)); // sent elsewhere — leave it out of this business's own report
      setSentToast(`Sent to ${resaleBizNames[link.target_business_id] || "the other business"}`);
      setTimeout(() => setSentToast(""), 2000);
    } catch (e) { alert(e.message); }
    setSendingCat(null);
  };
  const receivedTotal = receivedReports.reduce((a, r) => a + Number(r.total_sales), 0);
  const receivedTithe = receivedReports.reduce((a, r) => a + Number(r.total_tithe), 0);

  // A business can sell for several companies/categories at once, each with
  // its own salary percentage — never one combined rate on the total.
  // "To God" is its OWN independent percentage of that category's sales,
  // not a percentage taken out of the salary figure — a category can be
  // set up as pure giving (e.g. "Pamusika" at 50% to God, 0% salary)
  // without needing a salary cut to exist first.
  // Looked up from catRows (below) so it always reflects that week's actual
  // sales per company, regardless of the page's own category filter above.
  const salaryBreakdown = salaryCats
    .filter((c) => Number(c.pct) > 0 || Number(c.tithe_pct) > 0)
    .map((c) => {
      const catSales = catRows[c.category]?.sales || 0;
      const pct = Number(c.pct) || 0;
      const tithePct = Number(c.tithe_pct ?? 10);
      return { category: c.category, pct, sales: catSales, amount: catSales * pct / 100, tithePct, tithe: catSales * tithePct / 100 };
    });
  const salesSalary = salaryBreakdown.reduce((a, c) => a + c.amount, 0);
  const salesSalaryTithe = salaryBreakdown.reduce((a, c) => a + c.tithe, 0);
  const outsideSalary = Number(salary.outside_salary) || 0;
  const outsideTithe = outsideSalary * (Number(salary.outside_tithe_pct) || 0) / 100;

  const reportText = () => {
    // Only what's still checked under "Include in shared report" goes out —
    // a business reselling for other companies can leave those off its own
    // report entirely, while still seeing them in its own totals above.
    const sentRows = weekRows.filter((s) => !excludedCats.has(catOf[s.product_name] || "Uncategorised"));
    // What resellers sent in is real income for this business too, so it's
    // folded into the one combined figure that goes out — same as it's
    // folded into the totals shown on screen.
    const sentSales = sentRows.reduce((a, s) => a + Number(s.total), 0) + receivedTotal;
    const sentTithe = sentRows.reduce((a, s) => a + titheOf(s), 0) + receivedTithe;
    const sentSalaryBreakdown = salaryBreakdown.filter((c) => !excludedCats.has(c.category));

    let out = `${businessName || "Business"} — Weekly report\n${rangeLabel}\n\n`;
    out += `Sales: ${money(sentSales)}\nTo God (from sales): ${money(sentTithe)}\n`;
    if (sentSalaryBreakdown.length > 0 || outsideSalary > 0) {
      out += `\nSalary\n`;
      sentSalaryBreakdown.forEach((c) => {
        if (c.pct > 0) out += `Salary from ${c.category} sales (${c.pct}%): ${money(c.amount)}\n`;
        if (c.tithePct > 0) out += `To God from ${c.category} sales (${c.tithePct}%): ${money(c.tithe)}\n`;
      });
      if (outsideSalary > 0) {
        out += `Salary from my job: ${money(outsideSalary)}\n`;
        out += `To God from that salary (${salary.outside_tithe_pct}%): ${money(outsideTithe)}\n`;
      }
    }
    return out.trim();
  };
  const shareReport = async () => {
    const t = reportText();
    try {
      if (navigator.share) await navigator.share({ title: "Weekly report", text: t });
      else { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    } catch {}
  };

  const byProduct = {};
  rows.forEach((s) => {
    const k = s.product_name;
    byProduct[k] = byProduct[k] || { qty: 0, total: 0, tithe: 0 };
    byProduct[k].qty += Number(s.qty);
    byProduct[k].total += Number(s.total);
    byProduct[k].tithe += titheOf(s);
  });

  return (
    <>
      <div style={S.reportHead}>
        <FileText size={18} />
        <div>
          <div style={{ ...S.cardName, color: "#fff" }}>{cat === "All" ? "Weekly report" : `${cat} — weekly`}</div>
          <div style={{ ...S.cardMeta, color: "rgba(255,255,255,0.8)" }}>{rangeLabel}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button style={{ ...S.btn, flex: 1, ...(!customRange ? S.btnDark : S.btnGhost) }} onClick={() => setCustomRange(false)}>
          Weekly ({startDayAbbr}–{endDayAbbr})
        </button>
        <button style={{ ...S.btn, flex: 1, ...(customRange ? S.btnDark : S.btnGhost) }} onClick={() => setCustomRange(true)}>
          Pick dates
        </button>
      </div>
      {customRange ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <label style={{ ...S.fieldWrap, flex: 1, marginBottom: 0 }}>
            <span style={S.fieldLabel}>From</span>
            <input style={S.input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label style={{ ...S.fieldWrap, flex: 1, marginBottom: 0 }}>
            <span style={S.fieldLabel}>To</span>
            <input style={S.input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button style={{ ...S.btn, ...S.btnGhost, flex: 1 }} onClick={() => setWeekOffset(weekOffset + 1)}>‹ Previous</button>
            <button style={{ ...S.btn, ...S.btnGhost, flex: 1 }} disabled={weekOffset === 0} onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))}>Next ›</button>
          </div>
          <label style={{ ...S.fieldWrap, marginBottom: 12 }}>
            <span style={S.fieldLabel}>Your report week starts on</span>
            <select style={S.input} value={weekStartDay}
              onChange={async (e) => {
                const day = parseInt(e.target.value);
                setWeekOffset(0);
                if (onWeekStartDayChange) onWeekStartDayChange(day); // reflect immediately regardless of save
                try { await saveReportWeekStartDay(businessId, day); } catch {} // table may not exist yet
              }}>
              {WEEKDAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </label>
        </>
      )}
      {cats.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span style={S.fieldLabel}>Include in shared report</span>
          <p style={{ ...S.hint, marginTop: 2 }}>
            Selling for other companies on top of your own? Untick theirs, or link it to their Pamusika business
            and send it straight into their own report instead.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cats.map((c) => {
              const included = !excludedCats.has(c);
              const link = linkFor(c);
              return (
                <div key={c} style={{ ...S.card, flexWrap: "wrap" }}>
                  <button onClick={() => toggleExcluded(c)}
                    style={{ ...S.btn, padding: "7px 12px", fontSize: 12.5, ...(included ? S.btnDark : S.btnGhost) }}>
                    {included ? <Check size={13} /> : null} {c}
                  </button>
                  <div style={{ flex: 1 }} />
                  {link ? (
                    <>
                      <span style={{ ...S.cardMeta, marginRight: 4 }}>→ {resaleBizNames[link.target_business_id] || `Business ${link.target_business_id}`}</span>
                      <button style={{ ...S.btn, ...S.btnGhost, padding: "6px 10px", fontSize: 12 }}
                        disabled={sendingCat === c} onClick={() => sendCategoryReport(c)}>
                        {sendingCat === c ? "Sending…" : "Send"}
                      </button>
                      <button style={{ ...S.btn, ...S.btnGhost, padding: "6px 8px" }} onClick={() => setLinkingCat(c)}>
                        <Pencil size={12} />
                      </button>
                    </>
                  ) : (
                    <button style={{ ...S.btn, ...S.btnGhost, padding: "6px 10px", fontSize: 12 }} onClick={() => setLinkingCat(c)}>
                      Link to a business
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {sentToast && <p style={{ ...S.hint, color: accent, marginTop: 6 }}>✓ {sentToast}</p>}
        </div>
      )}
      {linkingCat && (
        <CategoryLinkModal category={linkingCat} currentTargetId={linkFor(linkingCat)?.target_business_id}
          onClose={() => setLinkingCat(null)}
          onSave={async (targetId) => { await saveCategoryLink(businessId, linkingCat, targetId); setLinkingCat(null); await loadResale(); }}
          onRemove={async () => { await removeCategoryLink(businessId, linkingCat); setLinkingCat(null); await loadResale(); }} />
      )}
      {receivedReports.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span style={S.fieldLabel}>Received from resellers this week</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {receivedReports.map((r) => (
              <div key={r.id} style={S.card}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>{r.from_business_name}</div>
                  <div style={S.cardMeta}>{r.category}</div>
                </div>
                <div style={{ fontWeight: 800 }}>{money(r.total_sales)}</div>
              </div>
            ))}
          </div>
          <p style={{ ...S.hint, marginTop: 6 }}>Already counted in the totals below — shown here just so it's clear where it came from.</p>
        </div>
      )}
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginBottom: 12 }} onClick={shareReport}>
        <Send size={16} /> {copied ? "✓ Copied" : "Share report"}
      </button>
      <label style={{ ...S.fieldWrap, marginBottom: 12 }}>
        <span style={S.fieldLabel}>Company / category</span>
        <select style={S.input} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="All">All companies</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <div className="pk-statgrid" style={S.statGrid}>
        <Stat icon={<TrendingUp size={16} />} label="Week sales" value={money(totalSales)} accent delay={0} />
        <Stat icon={<Wallet size={16} />} label="Cash (sales − God)" value={money(cash)} tint={mango} delay={0.05} />
        <Stat icon={<Church size={16} />} label="To God" value={money(totalTithe)} tint={grape} delay={0.1} />
        <Stat icon={<Package size={16} />} label="Packs sold" value={Object.values(byProduct).reduce((a,p)=>a+p.qty,0)} tint={sky} delay={0.15} />
      </div>

      <SectionTitle>This week by company</SectionTitle>
      <div style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 0 }}>
        <div style={{ display: "flex", fontSize: 11, color: muted, fontWeight: 700, textTransform: "uppercase", paddingBottom: 6, borderBottom: `1px solid ${line}` }}>
          <div style={{ flex: 1 }}>Company</div>
          <div style={{ width: 90, textAlign: "right" }}>Sales</div>
          <div style={{ width: 90, textAlign: "right" }}>To God</div>
        </div>
        {[...new Set([...cats, ...Object.keys(catRows)])].map((c) => {
          const d = catRows[c] || { sales: 0, tithe: 0 };
          return (
            <div key={c} style={{ display: "flex", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${line}` }}>
              <div style={{ flex: 1, fontWeight: 600 }}>{c}</div>
              <div style={{ width: 90, textAlign: "right", fontWeight: 700 }}>{money(d.sales)}</div>
              <div style={{ width: 90, textAlign: "right", fontWeight: 700, color: goldLt }}>{money(d.tithe)}</div>
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", padding: "10px 0 0", fontWeight: 800 }}>
          <div style={{ flex: 1 }}>TOTAL</div>
          <div style={{ width: 90, textAlign: "right", color: accent }}>{money(weekTotalSales)}</div>
          <div style={{ width: 90, textAlign: "right", color: goldLt }}>{money(weekTotalTithe)}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <SectionTitle>Salary & giving</SectionTitle>
        <button style={{ ...S.btn, ...S.btnGhost, padding: "6px 10px", fontSize: 12.5 }} onClick={() => setEditingSalary(true)}>
          <Pencil size={13} /> Edit
        </button>
      </div>
      <p style={S.hint}>
        Each company can have its own salary percentage and its own "To God" percentage — two separate cuts of
        that company's sales, not one taken out of the other.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {salaryBreakdown.map((c) => (
          <React.Fragment key={c.category}>
            {c.pct > 0 && (
              <div style={S.card}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>Salary from {c.category}</div>
                  <div style={S.cardMeta}>{c.pct}% of {money(c.sales)}</div>
                </div>
                <div style={{ fontWeight: 800 }}>{money(c.amount)}</div>
              </div>
            )}
            {c.tithePct > 0 && (
              <div style={S.card}>
                <div style={{ flex: 1 }}>
                  <div style={S.cardName}>To God from {c.category}</div>
                  <div style={S.cardMeta}>{c.tithePct}% of {money(c.sales)}</div>
                </div>
                <div style={{ fontWeight: 800, color: goldLt }}>{money(c.tithe)}</div>
              </div>
            )}
          </React.Fragment>
        ))}
        {salaryBreakdown.length > 1 && (
          <>
            <div style={{ ...S.card, background: "rgba(255,255,255,0.04)" }}>
              <div style={{ flex: 1 }}><div style={S.cardName}>Total salary from sales</div></div>
              <div style={{ fontWeight: 800, color: accent }}>{money(salesSalary)}</div>
            </div>
            <div style={{ ...S.card, background: "rgba(255,255,255,0.04)" }}>
              <div style={{ flex: 1 }}><div style={S.cardName}>Total to God from those companies</div></div>
              <div style={{ fontWeight: 800, color: goldLt }}>{money(salesSalaryTithe)}</div>
            </div>
          </>
        )}
        {outsideSalary > 0 && (
          <>
            <div style={S.card}>
              <div style={{ flex: 1 }}><div style={S.cardName}>Salary from my job</div></div>
              <div style={{ fontWeight: 800 }}>{money(outsideSalary)}</div>
            </div>
            <div style={S.card}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>To God from that salary</div>
                <div style={S.cardMeta}>{salary.outside_tithe_pct}%</div>
              </div>
              <div style={{ fontWeight: 800, color: goldLt }}>{money(outsideTithe)}</div>
            </div>
          </>
        )}
        {salaryBreakdown.length === 0 && outsideSalary <= 0 && (
          <p style={S.empty}>Nothing set up yet — tap Edit to add a salary percentage or a salary from your job.</p>
        )}
      </div>
      {editingSalary && (
        <SalarySettingsModal businessId={businessId} salary={salary} salaryCats={salaryCats} cats={cats}
          onSaved={(s, cp) => { setSalary(s); setSalaryCats(cp); setEditingSalary(false); }}
          onClose={() => setEditingSalary(false)} />
      )}

      <SectionTitle>By product{cat !== "All" ? ` — ${cat}` : ""}</SectionTitle>
      {Object.keys(byProduct).length === 0 && <p style={S.empty}>No sales for this week{cat !== "All" ? ` in ${cat}` : ""}.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(byProduct).sort((a,b)=>b[1].total-a[1].total).map(([name, d]) => (
          <div key={name} style={S.card}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{name}</div>
              <div style={S.cardMeta}>{d.qty} sold · {money(d.total)} · {money(d.tithe)} To God</div>
            </div>
          </div>
        ))}
      </div>
      {low.length > 0 && <>
        <SectionTitle>Reorder these</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {low.map((p) => (
            <div key={p.id} style={S.card}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{p.name}</div>
                <div style={S.cardMeta}>Only {p.qty} left</div>
              </div>
            </div>
          ))}
        </div>
      </>}
    </>
  );
}

// Business-wide salary settings (not per-seller) — a percentage of the
// week's sales, and a separate fixed salary from the owner's own job
// elsewhere with its own "to God" percentage, editable here.
// Picks which registered Pamusika business one category is actually
// resold on behalf of — same find_business lookup Login/SupplierPicker use.
function CategoryLinkModal({ category, currentTargetId, onClose, onSave, onRemove }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { setResults(await sb.rpc("find_business", { p_name: q.trim() })); } catch { setResults([]); }
    setBusy(false);
  };
  const pick = async (b) => {
    setBusy(true); setErr("");
    try { await onSave(b.id); } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title={`Link "${category}" to a business`}>
      <p style={{ ...S.hint, marginTop: 0 }}>
        Find the business this category is really sold on behalf of. Once linked, you can send that category's
        weekly figures straight into their own report.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input style={{ ...S.input, flex: 1 }} value={q} placeholder="Find a business by name…"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
        <button style={{ ...S.btn, ...S.btnGhost }} disabled={busy || !q.trim()} onClick={search}><Search size={16} /></button>
      </div>
      {err && <p style={S.errTxt}>{err}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {results.map((b) => (
          <button key={b.id} style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer" }}
            disabled={busy} onClick={() => pick(b)}>
            <div style={{ flex: 1 }}><div style={S.cardName}>{b.name}</div></div>
            {b.id === currentTargetId && <Check size={16} style={{ color: accent }} />}
          </button>
        ))}
      </div>
      {currentTargetId && (
        <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 12, color: "#FF8B7A" }}
          disabled={busy} onClick={onRemove}>
          Remove link
        </button>
      )}
    </Modal>
  );
}

function SalarySettingsModal({ businessId, salary, salaryCats = [], cats = [], onSaved, onClose }) {
  const initialRows = {};
  cats.forEach((c) => {
    const existing = salaryCats.find((r) => r.category === c);
    initialRows[c] = { pct: String(existing?.pct ?? 0), tithe_pct: String(existing?.tithe_pct ?? 10) };
  });
  const [rows, setRows] = useState(initialRows);
  const [outsideSalary, setOutsideSalary] = useState(String(salary.outside_salary ?? 0));
  const [outsideTithePct, setOutsideTithePct] = useState(String(salary.outside_tithe_pct ?? 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Keep a default row ready for any category that shows up in `cats`
  // after this modal first opened (added from Stock → Manage categories).
  useEffect(() => {
    setRows((prev) => {
      const next = { ...prev };
      let changed = false;
      cats.forEach((c) => { if (!next[c]) { next[c] = { pct: "0", tithe_pct: "10" }; changed = true; } });
      return changed ? next : prev;
    });
  }, [cats]);

  const setField = (c, field, v) =>
    setRows((prev) => ({ ...prev, [c]: { ...prev[c], [field]: v.replace(/[^0-9.]/g, "") } }));

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const settingsFields = {
        outside_salary: Math.max(0, Number(outsideSalary) || 0),
        outside_tithe_pct: Math.max(0, Number(outsideTithePct) || 0),
      };
      const rowsForSave = {};
      Object.entries(rows).forEach(([c, v]) => { rowsForSave[c] = { pct: Number(v.pct) || 0, tithe_pct: Number(v.tithe_pct) || 0 }; });
      await Promise.all([
        saveSalarySettings(businessId, settingsFields),
        saveSalaryCategoryPcts(businessId, salaryCats, rowsForSave),
      ]);
      const newSalaryCats = cats.map((c) => {
        const r = rowsForSave[c] || { pct: 0, tithe_pct: 0 };
        return { category: c, pct: r.pct, tithe_pct: r.tithe_pct };
      });
      onSaved({ ...settingsFields }, newSalaryCats);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Salary settings">
      <p style={{ ...S.hint, marginTop: 0 }}>
        Each company you sell for can have its own salary percentage and its own "To God" percentage — two
        separate cuts of that company's sales, not one taken out of the other, so a company can be pure giving
        (e.g. 0% salary, 50% to God) if that's all it is. Separately, add your normal salary from your own job
        below. Leave any percentage at 0 to skip it.
      </p>
      {cats.length > 0 && <SectionTitle>Salary from sales, per company</SectionTitle>}
      {cats.map((c) => (
        <div key={c} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ ...S.fieldWrap, flex: 1, marginBottom: 0 }}>
            <span style={S.fieldLabel}>{c} — salary (%)</span>
            <input style={S.input} value={rows[c]?.pct ?? "0"} inputMode="decimal"
              onChange={(e) => setField(c, "pct", e.target.value)} placeholder="e.g. 5" />
          </div>
          <div style={{ ...S.fieldWrap, flex: 1, marginBottom: 0 }}>
            <span style={S.fieldLabel}>To God (%)</span>
            <input style={S.input} value={rows[c]?.tithe_pct ?? "10"} inputMode="decimal"
              onChange={(e) => setField(c, "tithe_pct", e.target.value)} placeholder="e.g. 10" />
          </div>
        </div>
      ))}
      {cats.length === 0 && (
        <p style={S.hint}>No companies/categories set up yet on your products, so there's nothing to pick from here.</p>
      )}
      <SectionTitle>Salary from your job</SectionTitle>
      <div style={S.fieldWrap}>
        <span style={S.fieldLabel}>Fixed amount</span>
        <input style={S.input} value={outsideSalary} inputMode="decimal"
          onChange={(e) => setOutsideSalary(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 200" />
      </div>
      <div style={S.fieldWrap}>
        <span style={S.fieldLabel}>To God from that salary (%)</span>
        <input style={S.input} value={outsideTithePct} inputMode="decimal"
          onChange={(e) => setOutsideTithePct(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 10" />
      </div>
      {err && <p style={S.errTxt}>{err}</p>}
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 6 }} disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save"}
      </button>
    </Modal>
  );
}

// ============================================================
// 9. TEAM MANAGER (admin) — create salespeople with a PIN
// ============================================================
function TeamManager({ onChange, businessId, sales = [], user }) {
  const [members, setMembers] = useState([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [myPin, setMyPin] = useState("");
  const [myPin2, setMyPin2] = useState("");
  const [changing, setChanging] = useState(false);

  const load = useCallback(async () => {
    try { setMembers(await sb.select("members", `business_id=eq.${businessId}&select=id,name,role,created_at&order=created_at.asc`)); } catch {}
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const changeMyPin = async () => {
    if (myPin.length !== 4) { alert("PIN must be 4 digits."); return; }
    if (myPin !== myPin2) { alert("The two PINs don't match. Please type the same PIN twice."); return; }
    setChanging(true);
    try {
      await sb.rpc("upsert_member", { p_name: user.name, p_pin: myPin, p_role: user.role, p_business_id: businessId });
      setMyPin(""); setMyPin2(""); alert("Your PIN has been changed. Use it next time you sign in.");
    } catch (e) { alert(e.message); }
    setChanging(false);
  };

  const add = async () => {
    if (!name.trim() || pin.length < 4) return;
    setBusy(true);
    try {
      await sb.rpc("upsert_member", { p_name: name.trim(), p_pin: pin, p_role: "seller", p_business_id: businessId });
      setName(""); setPin(""); await load();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  const remove = async (id) => { await sb.del("members", `id=eq.${id}`); await load(); };
  const [viewing, setViewing] = useState(null);

  return (
    <>
      {user && <>
        <SectionTitle>My PIN</SectionTitle>
        <p style={S.hint}>Change your own sign-in PIN. You’ll use the new one next time you log in.</p>
        <div style={S.fieldWrap}>
          <span style={S.fieldLabel}>New PIN (4 digits)</span>
          <input style={S.input} value={myPin} onChange={(e)=>setMyPin(e.target.value.replace(/\D/g,"").slice(0,4))}
            inputMode="numeric" placeholder="••••" />
        </div>
        <div style={S.fieldWrap}>
          <span style={S.fieldLabel}>Type it again</span>
          <input style={S.input} value={myPin2} onChange={(e)=>setMyPin2(e.target.value.replace(/\D/g,"").slice(0,4))}
            inputMode="numeric" placeholder="••••" />
        </div>
        <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginBottom: 20 }} disabled={changing || myPin.length !== 4} onClick={changeMyPin}>
          <Check size={17} /> {changing ? "Saving…" : "Change my PIN"}
        </button>
      </>}

      <SectionTitle>Add a salesperson</SectionTitle>
      <p style={S.hint}>Add a salesperson with a 4-digit PIN. They sign in with their name and PIN.</p>
      <Field label="Name" value={name} onChange={setName} placeholder="e.g. Tendai" />
      <div style={S.fieldWrap}>
        <span style={S.fieldLabel}>PIN (4 digits)</span>
        <input style={S.input} value={pin} onChange={(e)=>setPin(e.target.value.replace(/\D/g,"").slice(0,4))}
          inputMode="numeric" placeholder="••••" />
      </div>
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginBottom: 18 }} disabled={busy} onClick={add}>
        <Plus size={18} /> {busy ? "Saving…" : "Add salesperson"}
      </button>
      <SectionTitle>Team</SectionTitle>
      <p style={S.hint}>Tap a person to see their details or reset their PIN.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {members.map((m) => (
          <button key={m.id} onClick={() => setViewing(m)}
            style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer" }}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{m.name}</div>
              <div style={S.cardMeta}>{m.role}{m.created_at ? ` · since ${new Date(m.created_at).toLocaleDateString()}` : ""}</div>
            </div>
            <ChevronRight size={18} style={{ color: muted }} />
          </button>
        ))}
      </div>
      {viewing && (
        <MemberDetail member={viewing} businessId={businessId}
          onClose={() => setViewing(null)}
          onChanged={async () => { await load(); }}
          onRemoved={async () => { setViewing(null); await load(); }} />
      )}

      <div style={{ height: 1, background: line, margin: "24px 0" }} />
      <SellerCompare sales={sales} />
    </>
  );
}

// Employee detail: info, reset PIN, protected delete
function MemberDetail({ member, businessId, onClose, onChanged, onRemoved }) {
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const resetPin = async () => {
    if (newPin.length !== 4) { alert("PIN must be 4 digits."); return; }
    setBusy(true);
    try {
      await sb.rpc("upsert_member", { p_name: member.name, p_pin: newPin, p_role: member.role, p_business_id: businessId });
      setNewPin(""); alert("PIN updated."); await onChanged();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  const doDelete = async () => {
    setBusy(true);
    try { await sb.del("members", `id=eq.${member.id}`); await onRemoved(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={member.name}>
      <div style={S.cardMeta}>Role: <b style={{ color: ink }}>{member.role}</b></div>
      <div style={{ ...S.cardMeta, marginBottom: 14 }}>
        Employed: <b style={{ color: ink }}>{member.created_at ? new Date(member.created_at).toLocaleDateString() : "unknown"}</b>
      </div>

      <SectionTitle>Reset PIN</SectionTitle>
      <p style={S.hint}>For security, the current PIN can’t be shown — but you can set a new one.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...S.input, flex: 1 }} value={newPin} inputMode="numeric" placeholder="New 4-digit PIN"
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        <button style={{ ...S.btn, ...S.btnDark }} disabled={busy || newPin.length !== 4} onClick={resetPin}>Set</button>
      </div>

      {member.role !== "admin" && <>
        <SectionTitle>Remove from team</SectionTitle>
        {!confirmDel ? (
          <button style={{ ...S.btn, ...S.btnGhost, width: "100%", color: "#C0392B" }} onClick={() => setConfirmDel(true)}>
            Remove {member.name}
          </button>
        ) : (
          <div style={{ border: `1px solid #C0392B`, borderRadius: 12, padding: 14 }}>
            <p style={{ ...S.hint, marginTop: 0 }}>This permanently removes {member.name}. Type <b>DELETE</b> to confirm.</p>
            <input style={S.input} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Type DELETE" />
            <button style={{ ...S.btn, width: "100%", marginTop: 8, background: "#C0392B", color: "#fff" }}
              disabled={busy || confirmText !== "DELETE"} onClick={doDelete}>
              Permanently remove
            </button>
            <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={() => { setConfirmDel(false); setConfirmText(""); }}>Cancel</button>
          </div>
        )}
      </>}
    </Modal>
  );
}

// ============================================================
// 10. SHARED UI
// ============================================================
export function Header({ title, sub, onExit, onRefresh, exitLabel }) {
  return (
    <div style={S.header}>
      <div>
        <div style={S.headTitle}>{title}</div>
        <div style={S.headSub}>{sub}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {onRefresh && <button style={S.exitBtn} onClick={onRefresh}><RefreshCw size={15} /></button>}
        <button style={S.exitBtn} onClick={onExit}><LogOut size={16} /> {exitLabel || "Sign out"}</button>
      </div>
    </div>
  );
}
export function Tabs({ tab, setTab, items }) {
  return (
    <div style={S.tabs}>
      {items.map(([k, label]) => (
        <button key={k} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }} onClick={() => setTab(k)}>{label}</button>
      ))}
    </div>
  );
}

// ============================================================
// RESPONSIVE SHELL — mobile keeps today's exact single-column,
// top-tab layout (nothing below changes it); a wide viewport (the
// breakpoint is a judgment call — 900px, wide enough that a real
// phone/Capacitor webview never crosses it) gets a left sidebar and
// a much wider content column instead. One hook + one shell so
// Admin/ChurchApp don't each reinvent this.
// ============================================================
export function useIsDesktop(breakpoint = 900) {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(`(min-width: ${breakpoint}px)`).matches
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const onChange = (e) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [breakpoint]);
  return isDesktop;
}

// Shared chrome for tabbed screens (Admin, ChurchApp): header + tabs + body
// on mobile (byte-for-byte what those screens rendered before), a sidebar +
// wide content pane on desktop. `decoration` is an optional absolutely-
// positioned background layer (e.g. a watermark); `toolbar`/`alerts` render
// between the header and the tab content on both layouts.
export function AppShell({ title, subtitle, icon, tab, setTab, labels, keys, items, onExit, onRefresh, exitLabel, toolbar, alerts, decoration, children }) {
  const isDesktop = useIsDesktop();
  const tabItems = items || keys.map((k) => [k, labels[k]]);

  if (!isDesktop) {
    return (
      <div style={S.shell}>
        {decoration}
        <Header title={title} sub={subtitle} onExit={onExit} onRefresh={onRefresh} exitLabel={exitLabel} />
        {alerts}
        {toolbar && <div style={{ padding: "0 20px 10px", position: "relative", zIndex: 1 }}>{toolbar}</div>}
        <Tabs tab={tab} setTab={setTab} items={tabItems} />
        <div style={S.body}>{children}</div>
      </div>
    );
  }

  return (
    <div style={S.deskShell}>
      {decoration}
      <aside style={S.deskSidebar}>
        <div style={S.deskBrand}>
          <span style={S.deskBrandIcon}>{icon}</span>
          <div>
            <div style={S.deskBrandTitle}>{title}</div>
            <div style={S.deskBrandSub}>{subtitle}</div>
          </div>
        </div>
        <nav style={S.deskNav}>
          {tabItems.map(([k, label]) => (
            <button key={k} style={{ ...S.deskNavItem, ...(tab === k ? S.deskNavItemActive : {}) }} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div style={S.deskSidebarFoot}>
          {onRefresh && <button style={S.deskFootBtn} onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>}
          <button style={S.deskFootBtn} onClick={onExit}><LogOut size={14} /> {exitLabel || "Sign out"}</button>
        </div>
      </aside>
      <main style={S.deskMain}>
        {toolbar && <div style={{ marginBottom: 16 }}>{toolbar}</div>}
        {alerts}
        <div style={S.deskContent}>{children}</div>
      </main>
    </div>
  );
}
function Stat({ icon, label, value, accent, tint, delay = 0 }) {
  return (
    <div style={{ ...S.stat, ...(accent ? S.statAccent : {}), animationDelay: `${delay}s` }}>
      <div style={{ ...S.statIcon,
        ...(accent ? { color: "#fff", background: "rgba(255,255,255,0.22)" }
                   : tint ? { color: "#fff", background: tint } : {}) }}>{icon}</div>
      <div style={{ ...S.statLabel, ...(accent ? { color: "rgba(255,255,255,0.85)" } : {}) }}>{label}</div>
      <div style={{ ...S.statValue, ...(accent ? { color: "#fff" } : {}) }}>{value}</div>
    </div>
  );
}
function SalesList({ sales, showSeller, onDelete, showTithe }) {
  if (!sales.length) return <p style={S.empty}>No sales yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sales.map((s) => (
        <div key={s.id} style={S.saleRow}>
          <div style={{ flex: 1 }}>
            <div style={S.saleName}>{s.product_name} <span style={S.saleQty}>×{s.qty}</span></div>
            <div style={S.cardMeta}>
              {new Date(s.sold_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              {showSeller && ` · ${s.seller_name}`}
              {s.customer_name && ` · ${s.customer_name}`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={S.saleName}>{money(s.total)}</div>
            {showTithe && <div style={S.titheTag}>{money(s.tithe)} To God</div>}
          </div>
          {onDelete && (
            <button style={S.delBtn} onClick={() => onDelete(s)} title="Remove this sale"><X size={16} /></button>
          )}
        </div>
      ))}
    </div>
  );
}
export function SectionTitle({ children }) { return <div style={S.sectionTitle}>{children}</div>; }
function SearchBar({ value, onChange }) {
  return (
    <div style={S.searchWrap}>
      <Search size={16} style={{ color: muted, flexShrink: 0 }} />
      <input style={S.searchInput} value={value} placeholder="Search products…"
        onChange={(e) => onChange(e.target.value)} />
      {value && <button style={S.searchClear} onClick={() => onChange("")}><X size={15} /></button>}
    </div>
  );
}
export function Loading() { return <div style={{ textAlign: "center", padding: "40px 0" }}><div style={S.loadDot} /></div>; }
export function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label style={S.fieldWrap}>
      <span style={S.fieldLabel}>{label}</span>
      <input style={S.input} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
export function Modal({ children, onClose, title }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>{title}</span>
          <button style={S.delBtn} onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function LightWatermark() {
  return (
    <svg viewBox="0 0 400 520" style={S.watermarkLight} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="none" stroke={accent} strokeWidth="2">
        {Array.from({ length: 5 }).map((_, r) =>
          Array.from({ length: 4 }).map((_, c) => {
            const x = 40 + c * 100, y = 50 + r * 110;
            const k = (r + c) % 3;
            if (k === 0) return <g key={`${r}-${c}`}><circle cx={x} cy={y} r="15" /><path d={`M${x} ${y - 15} q4 -8 10 -5`} /></g>;
            if (k === 1) return <path key={`${r}-${c}`} d={`M${x - 16} ${y - 10} h32 l-5 26 h-22 z`} />;
            return <g key={`${r}-${c}`}><rect x={x - 16} y={y - 12} width="32" height="22" rx="4" /><path d={`M${x - 16} ${y - 3} h32`} /></g>;
          })
        )}
      </g>
    </svg>
  );
}

export function MarketWatermark() {
  // Faint repeating grocery icons behind the dark login
  return (
    <svg viewBox="0 0 400 600" style={S.watermark} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="none" stroke="#CDE8C4" strokeWidth="2" opacity="0.5">
        {Array.from({ length: 6 }).map((_, r) =>
          Array.from({ length: 4 }).map((_, c) => {
            const x = 30 + c * 100, y = 40 + r * 100;
            const k = (r + c) % 3;
            if (k === 0) return <g key={`${r}-${c}`}><circle cx={x} cy={y} r="14" /><path d={`M${x} ${y - 14} q4 -8 10 -5`} /></g>;
            if (k === 1) return <path key={`${r}-${c}`} d={`M${x - 16} ${y - 10} h32 l-5 26 h-22 z`} />;
            return <g key={`${r}-${c}`}><rect x={x - 16} y={y - 12} width="32" height="22" rx="4" /><path d={`M${x - 16} ${y - 3} h32`} /></g>;
          })
        )}
      </g>
    </svg>
  );
}

function DeliveryScene() {
  // Code-drawn abstract mark, no external image needed — echoes PamusikaMark's
  // layered-diamond motif at hero scale instead of a literal illustrated scene,
  // matching a premium/editorial feel rather than a clip-art vibe.
  const rings = [
    { r: 74, op: 0.10 }, { r: 56, op: 0.16 }, { r: 40, op: 0.24 },
  ];
  return (
    <div style={S.heroWrap}>
      <svg viewBox="0 0 360 200" style={{ width: "100%", display: "block" }} aria-hidden="true">
        <defs>
          <linearGradient id="heroSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#153a2d" />
            <stop offset="1" stopColor="#0a1e17" />
          </linearGradient>
          <radialGradient id="heroGlow" cx="50%" cy="42%" r="60%">
            <stop offset="0" stopColor="#E6C44D" stopOpacity="0.35" />
            <stop offset="1" stopColor="#E6C44D" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="heroDiamond" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F3DA84" />
            <stop offset="1" stopColor="#C9A227" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="360" height="200" fill="url(#heroSky)" />
        <circle cx="180" cy="86" r="90" fill="url(#heroGlow)" />

        {rings.map((ring, i) => (
          <circle key={i} cx="180" cy="86" r={ring.r} fill="none" stroke="#E6C44D" strokeWidth="1" opacity={ring.op} />
        ))}

        <g style={{ transformOrigin: "180px 86px", animation: "bob 5s ease-in-out infinite" }}>
          <path d="M180 40 L228 66 L180 92 L132 66 Z" fill="url(#heroDiamond)" opacity="0.94" />
          <path d="M180 60 L216 80 L180 100 L144 80 Z" fill="url(#heroDiamond)" opacity="0.66" />
          <path d="M180 80 L204 94 L180 108 L156 94 Z" fill="url(#heroDiamond)" opacity="0.38" />
        </g>

        <text x="180" y="150" textAnchor="middle" fontSize="13" fontWeight="600" letterSpacing="0.28em"
          fill="#EAF3EC" opacity="0.55" fontFamily="Inter, sans-serif">SMART BUSINESS</text>

        <g opacity="0.85">
          <circle cx="86" cy="52" r="2" fill="#F5C443" style={{ animation: "rise 3.4s ease-in-out infinite" }} />
          <circle cx="276" cy="118" r="2" fill="#F5C443" style={{ animation: "rise 2.8s ease-in-out infinite 0.6s" }} />
          <circle cx="264" cy="46" r="1.6" fill="#F5C443" style={{ animation: "rise 3s ease-in-out infinite 1.1s" }} />
        </g>
      </svg>
    </div>
  );
}

export function HeroImage() {
  // Optional real photo / 3D render: drop hero.jpg into the project's public folder.
  // It renders here in a premium gold-edged frame with a soft glow.
  const [ok, setOk] = useState(true);
  if (!ok) return <DeliveryScene />;
  return (
    <div style={{ position: "relative", marginBottom: 16, borderRadius: 20, overflow: "hidden",
      border: "1px solid rgba(230,196,77,0.45)", boxShadow: "0 20px 50px rgba(0,0,0,0.55), 0 0 0 1px rgba(230,196,77,0.15)" }}>
      <img src="/hero.jpg" alt="" onError={() => setOk(false)}
        style={{ width: "100%", height: 200, objectFit: "cover", objectPosition: "center 22%", display: "block" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(7,22,15,0) 40%, rgba(7,22,15,0.55) 100%)" }} />
    </div>
  );
}
function SetupNotice() {
  return (
    <div style={S.shell}>
      <div style={S.loginCard}>
        <div style={S.logoMark}><PamusikaMark size={30} /></div>
        <h1 style={S.loginTitle}>Almost ready</h1>
        <p style={{ ...S.loginSub, textAlign: "left", lineHeight: 1.6 }}>
          Open the code and paste your Supabase <b>Project URL</b> and <b>anon key</b> into the
          two lines at the top (marked “YOUR-PROJECT” / “YOUR-ANON-KEY”). You’ll find them in
          Supabase → Project Settings → API. Then run the setup.sql file once in the SQL Editor.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// 11. STYLES
// ============================================================
export const ink = "#EAF3EC", paper = "#0c241d", accent = "#2bd07a", line = "rgba(230,196,77,0.18)";
export const lime = "#7CC243", mango = "#F5A623", berry = "#E0457B", sky = "#2FA7D8", grape = "#7C5CD6";
export const gold = "#C9A227", goldLt = "#E6C44D", darkbg = "#0c241d", darkbg2 = "#11342a", darkcard = "rgba(255,255,255,0.05)";
// Native <option> popups ignore the parent <select>'s CSS in most browsers —
// this has to go on every <option> inside an S.inputDark select, or its text
// renders unreadably (dark text/background mismatch) until the row is hovered.
export const optionDark = { background: darkbg, color: "#EAF3EC" };
export const cardBg = "rgba(255,255,255,0.05)", muted = "rgba(234,243,236,0.55)";
export const S = {
  shell: { maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: `radial-gradient(130% 70% at 50% -10%, ${darkbg2} 0%, ${darkbg} 55%, #07160f 100%)`, fontFamily: "'Inter', system-ui, sans-serif", color: ink, paddingBottom: 60, position: "relative" },

  // Desktop shell (>=900px, see useIsDesktop): fixed-width sidebar + a wide
  // scrolling content pane, replacing the mobile shell's header+top-tabs.
  deskShell: { display: "flex", minHeight: "100vh", background: `radial-gradient(130% 70% at 50% -10%, ${darkbg2} 0%, ${darkbg} 55%, #07160f 100%)`, fontFamily: "'Inter', system-ui, sans-serif", color: ink, position: "relative" },
  deskSidebar: { width: 260, flexShrink: 0, display: "flex", flexDirection: "column", padding: "26px 18px", borderRight: `1px solid ${line}`, background: "rgba(7,22,15,0.35)", position: "sticky", top: 0, height: "100vh", zIndex: 1 },
  deskBrand: { display: "flex", alignItems: "center", gap: 12, padding: "0 6px 22px" },
  deskBrandIcon: { width: 40, height: 40, borderRadius: 12, background: `linear-gradient(150deg,${goldLt},${gold})`, color: darkbg, display: "grid", placeItems: "center", flexShrink: 0, boxShadow: "0 8px 18px rgba(201,162,39,0.35)" },
  deskBrandTitle: { fontSize: 18, fontWeight: 600, fontFamily: "'Fraunces', Georgia, serif", color: ink, lineHeight: 1.2 },
  deskBrandSub: { fontSize: 11.5, color: muted, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 },
  deskNav: { display: "flex", flexDirection: "column", gap: 3 },
  deskNavItem: { textAlign: "left", padding: "11px 14px", border: "none", background: "transparent", fontSize: 14, fontWeight: 600, color: muted, cursor: "pointer", borderRadius: 10 },
  deskNavItemActive: { background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", boxShadow: "0 4px 12px rgba(31,157,85,0.3)" },
  deskSidebarFoot: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 14, borderTop: `1px solid ${line}` },
  deskFootBtn: { display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${line}`, padding: "9px 12px", borderRadius: 10, fontSize: 13, color: ink, cursor: "pointer", justifyContent: "flex-start" },
  deskMain: { flex: 1, minWidth: 0, padding: "34px 44px 60px", position: "relative", zIndex: 1 },
  deskContent: { maxWidth: 1120, margin: "0 auto" },
  loadDot: { width: 22, height: 22, borderRadius: "50%", border: `3px solid ${line}`, borderTopColor: accent, animation: "spin 0.8s linear infinite", margin: "0 auto" },

  loginCard: { padding: "30px 26px 40px", maxWidth: 390, margin: "0 auto", textAlign: "center", animation: "popIn 0.5s ease", background: "rgba(12,36,29,0.72)", backdropFilter: "blur(10px)", borderRadius: 26, border: "1px solid rgba(230,196,77,0.25)", boxShadow: "0 30px 70px rgba(0,0,0,0.5)" },
  loginDarkShell: { maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: `radial-gradient(130% 80% at 50% -10%, ${darkbg2} 0%, ${darkbg} 60%, #07160f 100%)`, fontFamily: "'Inter', system-ui, sans-serif", color: "#EAF3EC", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", position: "relative", overflow: "hidden" },
  heroWrap: { borderRadius: 18, overflow: "hidden", marginBottom: 16, border: "1px solid rgba(230,196,77,0.2)", boxShadow: "0 14px 34px rgba(0,0,0,0.4)" },
  watermark: { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.05, pointerEvents: "none", zIndex: 0 },
  watermarkLight: { position: "absolute", top: 60, left: 0, width: "100%", height: 520, opacity: 0.035, pointerEvents: "none", zIndex: 0 },
  logoMark: { width: 62, height: 62, borderRadius: 20, background: `linear-gradient(150deg,${goldLt},${gold})`, color: darkbg, display: "grid", placeItems: "center", margin: "0 auto 16px", boxShadow: "0 12px 34px rgba(201,162,39,0.35), inset 0 1px 0 rgba(255,255,255,0.4)", animation: "bob 4s ease-in-out infinite" },
  loginTitle: { fontSize: 42, fontWeight: 600, letterSpacing: "-0.01em", margin: "0 0 6px", fontFamily: "'Fraunces', Georgia, serif", color: goldLt },
  loginSub: { fontSize: 14, color: "rgba(234,243,236,0.7)", margin: "0 0 22px", lineHeight: 1.5 },
  errTxt: { color: "#C0392B", fontSize: 13.5, marginTop: 12 },

  pinDot: { width: 14, height: 14, borderRadius: "50%", border: `2px solid rgba(230,196,77,0.5)`, background: "rgba(255,255,255,0.06)", transition: "all 0.2s ease" },
  pinDotFull: { background: goldLt, borderColor: goldLt, transform: "scale(1.2)" },
  keypad: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 6 },
  key: { padding: "16px 0", fontSize: 20, fontWeight: 700, background: cardBg, border: `1px solid ${line}`, borderRadius: 14, cursor: "pointer", color: ink, display: "grid", placeItems: "center" },
  keyDark: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(230,196,77,0.22)", color: "#EAF3EC", boxShadow: "none" },
  inputDark: { width: "100%", boxSizing: "border-box", padding: "13px 14px", border: "1px solid rgba(230,196,77,0.25)", borderRadius: 12, fontSize: 15, background: "rgba(255,255,255,0.07)", color: "#fff", outline: "none", colorScheme: "dark" },
  btnGold: { background: `linear-gradient(135deg,${goldLt},${gold})`, color: darkbg, boxShadow: "0 8px 22px rgba(201,162,39,0.4)", fontWeight: 800 },

  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 20px 14px", position: "relative", zIndex: 1 },
  headTitle: { fontSize: 25, fontWeight: 600, letterSpacing: "-0.01em", fontFamily: "'Fraunces', Georgia, serif", color: ink },
  headSub: { fontSize: 12, color: muted, textTransform: "uppercase", letterSpacing: "0.06em" },
  exitBtn: { display: "flex", alignItems: "center", gap: 6, background: cardBg, border: `1px solid ${line}`, padding: "7px 12px", borderRadius: 10, fontSize: 13, color: ink, cursor: "pointer" },

  alert: { display: "flex", alignItems: "center", gap: 8, margin: "0 20px 8px", padding: "11px 14px", background: "#FFF1DA", color: "#B26A00", borderRadius: 12, fontSize: 13, animation: "popIn 0.3s ease" },

  tabs: { display: "flex", gap: 4, padding: "6px 16px 0", overflowX: "auto", position: "relative", zIndex: 1 },
  tab: { padding: "9px 14px", border: "none", background: "transparent", fontSize: 13.5, fontWeight: 600, color: muted, cursor: "pointer", borderRadius: 10, whiteSpace: "nowrap" },
  tabActive: { background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", boxShadow: "0 4px 12px rgba(31,157,85,0.3)" },

  body: { padding: "16px 20px 0", position: "relative", zIndex: 1 },
  // Column count for .pk-statgrid lives in CSS (below) so it can widen at the
  // desktop breakpoint — an inline gridTemplateColumns here would always win
  // over the media query, so every usage of this style also needs
  // className="pk-statgrid".
  statGrid: { display: "grid", gap: 10, marginBottom: 8 },
  stat: { background: cardBg, border: `1px solid ${line}`, borderRadius: 16, padding: "14px 15px", animation: "rise 0.4s ease both" },
  statAccent: { background: `linear-gradient(135deg,${accent} 0%, ${lime} 100%)`, border: "none", boxShadow: "0 12px 26px rgba(31,157,85,0.34)", position: "relative", overflow: "hidden", borderTop: `3px solid ${goldLt}` },
  statIcon: { width: 32, height: 32, borderRadius: 10, background: "rgba(43,208,122,0.15)", color: accent, display: "grid", placeItems: "center", marginBottom: 9 },
  statLabel: { fontSize: 11.5, color: muted, marginBottom: 3 },
  statValue: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" },

  sectionTitle: { fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", fontFamily: "'Fraunces', Georgia, serif", color: ink, margin: "22px 0 10px" },
  hint: { fontSize: 13, color: muted, margin: "-4px 0 12px", lineHeight: 1.5 },
  empty: { fontSize: 13.5, color: muted, textAlign: "center", padding: "20px 0" },

  card: { display: "flex", alignItems: "center", gap: 12, background: cardBg, border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 14, padding: "14px 16px", boxShadow: "0 2px 10px rgba(0,0,0,0.16)" },
  cardName: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" },
  cardMeta: { fontSize: 12.5, color: muted, marginTop: 2 },
  lowTag: { fontSize: 10, background: "#FFE2E2", color: "#C0392B", padding: "2px 7px", borderRadius: 20, fontWeight: 700, marginLeft: 6, verticalAlign: "middle" },
  outTag: { fontSize: 10, background: "#C0392B", color: "#fff", padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginLeft: 6, verticalAlign: "middle" },
  invTag: { fontSize: 10, background: "rgba(43,208,122,0.15)", color: accent, padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginLeft: 6, verticalAlign: "middle", fontFamily: "monospace" },
  sugBox: { position: "absolute", top: "100%", left: 0, right: 0, background: "#123026", border: `1px solid ${line}`, borderRadius: 10, boxShadow: "0 8px 20px rgba(0,0,0,0.4)", zIndex: 30, overflow: "hidden", marginTop: 2 },
  sugItem: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "10px 13px", border: "none", borderBottom: `1px solid ${line}`, background: "#123026", color: ink, cursor: "pointer", textAlign: "left" },
  miniStat: { flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "8px 10px", textAlign: "center" },
  miniLabel: { fontSize: 10.5, color: muted, textTransform: "uppercase", letterSpacing: "0.04em" },
  miniVal: { fontSize: 15, fontWeight: 800, marginTop: 2 },

  qtyCtrl: { display: "flex", alignItems: "center", gap: 8 },
  qtyCol: { display: "flex", flexDirection: "column", gap: 6 },
  qtyTiny: { minWidth: 30, textAlign: "center", fontSize: 11, color: muted, fontWeight: 600 },
  qtyBtn: { width: 30, height: 30, borderRadius: 9, border: `1px solid ${line}`, background: "rgba(255,255,255,0.05)", display: "grid", placeItems: "center", cursor: "pointer", color: accent },
  qtyNum: { minWidth: 28, textAlign: "center", fontWeight: 800, fontSize: 16 },
  delBtn: { background: "transparent", border: "none", color: "#C0392B", cursor: "pointer", padding: 4, display: "grid", placeItems: "center" },
  editBtn: { background: "transparent", border: "none", color: accent, cursor: "pointer", padding: 4, display: "grid", placeItems: "center" },

  sellBtn: { background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", border: "none", padding: "10px 18px", borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 12px rgba(31,157,85,0.3)" },
  sellBtnOff: { background: "#D9D3C4", color: "#fff", cursor: "not-allowed", boxShadow: "none" },

  saleRow: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: cardBg, border: `1px solid ${line}`, borderRadius: 13 },
  saleName: { fontSize: 14, fontWeight: 700 },
  saleQty: { color: muted, fontWeight: 500 },
  titheTag: { fontSize: 11.5, color: accent, fontWeight: 600, marginTop: 1 },

  reportHead: { display: "flex", alignItems: "center", gap: 12, background: `linear-gradient(135deg,${grape},${berry})`, color: "#fff", padding: "16px 18px", borderRadius: 16, marginBottom: 14, boxShadow: "0 8px 22px rgba(124,92,214,0.3)" },

  btn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", padding: "13px 16px", borderRadius: 12, fontSize: 14.5, fontWeight: 700, cursor: "pointer" },
  btnDark: { background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", boxShadow: "0 6px 16px rgba(31,157,85,0.3)" },
  btnGhost: { background: "rgba(255,255,255,0.06)", color: ink, border: `1px solid ${line}` },
  btnWarn: { background: `linear-gradient(135deg,${mango},#E8820C)`, color: "#fff", boxShadow: "0 6px 16px rgba(245,166,35,0.35)" },

  fieldWrap: { display: "block", marginBottom: 12, textAlign: "left" },
  fieldLabel: { display: "block", fontSize: 12.5, fontWeight: 600, color: muted, marginBottom: 6 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 10, border: `1px solid ${line}`, fontSize: 15, background: "rgba(255,255,255,0.06)", color: ink, outline: "none" },

  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "end center", zIndex: 50 },
  modal: { background: "#0f2c22", width: "100%", maxWidth: 520, borderRadius: "20px 20px 0 0", padding: "20px 20px 30px", maxHeight: "88vh", overflowY: "auto", border: `1px solid ${line}`, color: ink },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { fontSize: 19, fontWeight: 800 },

  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1c4d3d", color: "#fff", padding: "11px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 60, border: `1px solid ${line}` },

  searchWrap: { display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.06)", border: `1px solid ${line}`, borderRadius: 11, padding: "9px 13px", marginBottom: 12 },
  searchInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14.5, color: ink },
  searchClear: { background: "transparent", border: "none", color: muted, cursor: "pointer", padding: 0, display: "grid", placeItems: "center" },
  sellSummary: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(230,196,77,0.12)", border: `1px solid ${line}`, color: ink, borderRadius: 10, padding: "11px 14px", fontSize: 14.5, marginTop: 4 },

  cardPop: { animation: "pop 0.25s ease", transition: "transform 0.12s ease, box-shadow 0.12s ease" },
  cardInCart: { borderColor: accent, boxShadow: "0 0 0 1px #3A7D5C inset" },
  cartBadge: { fontSize: 10, background: accent, color: "#fff", padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginLeft: 8, verticalAlign: "middle" },
  cartFab: { position: "fixed", bottom: 22, left: 0, right: 0, marginLeft: "auto", marginRight: "auto", width: "fit-content", display: "flex", alignItems: "center", gap: 4, background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", border: "none", padding: "14px 24px", borderRadius: 30, fontSize: 15, cursor: "pointer", boxShadow: "0 10px 28px rgba(31,157,85,0.45)", zIndex: 55, animation: "popIn 0.3s ease" },
  cartFabCount: { background: "#fff", color: accent, borderRadius: "50%", minWidth: 22, height: 22, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800, marginLeft: 4 },
  cartLine: { display: "flex", alignItems: "center", gap: 10, background: cardBg, border: `1px solid ${line}`, borderRadius: 11, padding: "10px 13px" },
  cartTotalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 18, fontWeight: 800, padding: "12px 14px", background: "rgba(230,196,77,0.12)", border: `1px solid ${line}`, color: ink, borderRadius: 11 },
  crumb: { background: "rgba(255,255,255,0.06)", border: `1px solid ${line}`, color: ink, padding: "5px 10px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 700 },
  receipt: { background: "#123026", border: `1px solid ${line}`, borderRadius: 14, padding: "18px 16px" },
  receiptDivider: { borderTop: `1px dashed ${line}`, margin: "10px 0" },
  receiptLine: { display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" },

  // Chat-style ordering thread: one outgoing bubble per order_requests row,
  // plus a visually distinct "system reply" bubble once it's resolved.
  chatThread: { display: "flex", flexDirection: "column", gap: 10, padding: "2px" },
  // A bounded-height flex column: the message list is the only part that
  // scrolls (flex:1), the composer is a normal trailing flex sibling — so it
  // just sits at the bottom of the box instead of scrolling away, and on
  // mobile, using dvh for the outer height means the box (and the composer
  // pinned to its bottom) automatically shrinks to sit right above the
  // on-screen keyboard rather than being hidden behind it or off-screen.
  chatPanel: { display: "flex", flexDirection: "column", minHeight: 0 },
  chatPanelScroll: { flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 2px 10px" },
  chatComposerBar: { borderTop: `1px solid ${line}`, paddingTop: 10, marginTop: 2, background: darkbg2 },
  chatBubbleOut: { alignSelf: "flex-end", maxWidth: "88%", background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "10px 13px", fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", boxShadow: "0 4px 12px rgba(31,157,85,0.25)" },
  chatBubbleSystem: { alignSelf: "flex-start", maxWidth: "88%", background: "rgba(255,255,255,0.06)", border: `1px solid ${line}`, color: ink, borderRadius: "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13, fontWeight: 700 },
  chatBubbleSystemBad: { background: "rgba(192,57,43,0.16)", border: "1px solid rgba(192,57,43,0.35)", color: "#FF8B7A" },
  chatMeta: { fontSize: 10.5, opacity: 0.75, marginTop: 4, fontWeight: 500 },
  // Quoted parent message shown inside a reply's own bubble
  chatQuote: { borderLeft: "2px solid rgba(255,255,255,0.4)", paddingLeft: 8, marginBottom: 6, fontSize: 11.5, opacity: 0.85, fontStyle: "italic", fontWeight: 500 },
  chatReplyLink: { background: "none", border: "none", padding: 0, fontSize: 10.5, fontWeight: 700, opacity: 0.75, cursor: "pointer", color: "inherit", textDecoration: "underline", flexShrink: 0 },
  // The "replying to…" preview bar shown above the composer input while a reply is queued up
  chatReplyPreview: { display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.06)", border: `1px solid ${line}`, borderRadius: 10, padding: "6px 10px", marginBottom: 8 },
  // Floating "new messages" button, visible over any tab except Community itself
  floatingMsgBtn: { position: "fixed", right: 20, bottom: 20, zIndex: 40, width: 54, height: 54, borderRadius: "50%", border: "none", cursor: "pointer", display: "grid", placeItems: "center", background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", boxShadow: "0 10px 28px rgba(31,157,85,0.45)" },
  floatingMsgBadge: { position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, padding: "0 5px", borderRadius: 10, background: "#C0392B", color: "#fff", fontSize: 11, fontWeight: 800, display: "grid", placeItems: "center", border: "2px solid #07160f" },
};

if (typeof document !== "undefined" && !document.getElementById("sf-spin")) {
  // Load a distinctive display face (Fraunces) for the wordmark/headings, paired
  // with Inter for body & numbers. This gives a considered, premium feel rather
  // than the default single-sans look.
  const f = document.createElement("link");
  f.rel = "stylesheet";
  f.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&display=swap";
  document.head.appendChild(f);

  const st = document.createElement("style");
  st.id = "sf-spin";
  st.textContent = `
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes pop{0%{transform:scale(0.97);opacity:0.6}100%{transform:scale(1);opacity:1}}
    @keyframes rise{0%{transform:translateY(14px);opacity:0}100%{transform:translateY(0);opacity:1}}
    @keyframes popIn{0%{transform:scale(0.9);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes slideIn{0%{transform:translateX(-100%)}100%{transform:translateX(0)}}
    @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
    button{transition:transform 0.08s ease, filter 0.12s ease}
    button:active{transform:scale(0.97)}
    @media (prefers-reduced-motion: reduce){*{animation:none !important}}
    .pk-statgrid{grid-template-columns:1fr 1fr;}
    @media (min-width: 900px){.pk-statgrid{grid-template-columns:repeat(4,1fr);gap:14px;}}
    .pk-shopgrid{display:flex;flex-direction:column;gap:8px;}
    @media (min-width: 900px){.pk-shopgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}}
  `;
  document.head.appendChild(st);
}
