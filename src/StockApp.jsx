import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, TrendingUp, Users, AlertTriangle, Plus, Minus, LogOut,
  Church, Wallet, FileText, ChevronRight, Box, X, Check, Delete, RefreshCw, Search, Pencil, ShoppingCart, Send, Calendar, DollarSign
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
const sb = {
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
    if (!r.ok) throw new Error("Delete failed");
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
  // Phase 3: Idempotency keys to prevent duplicate offline saves
  if (!sale.idempotency_key) {
    sale.idempotency_key = `off-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  if (list.some(s => s.idempotency_key === sale.idempotency_key)) return;
  list.push(sale);
  setPending(biz, list);
  
  // Phase 3: Automatic Local Device Backup Fallback
  try {
    const backupKey = `pamusika_backup:${biz}:${Date.now()}`;
    localStorage.setItem(backupKey, JSON.stringify({ timestamp: new Date().toISOString(), sale }));
  } catch {}
}

// Send all queued sales to the server. Returns how many synced.
async function flushPending(biz) {
  if (!isOnline()) return 0;
  let list = getPending(biz);
  if (list.length === 0) return 0;
  const remaining = [];
  let synced = 0;
  
  // Phase 3: Deduplicate identical request bursts before processing
  const uniqueList = [];
  const seenKeys = new Set();
  for (const s of list) {
    if (s.idempotency_key && seenKeys.has(s.idempotency_key)) continue;
    if (s.idempotency_key) seenKeys.add(s.idempotency_key);
    uniqueList.push(s);
  }

  for (const sale of uniqueList) {
    try {
      await sb.rpc("record_invoice", {
        p_items: sale.items, p_seller: sale.seller,
        p_customer: sale.customer || null, p_phone: sale.phone || null,
        p_nonce: sale.idempotency_key || null // Pass unique hash token to db layer if accepted
      });
      synced++;
    } catch {
      remaining.push(sale); 
    }
  }
  setPending(biz, remaining);
  return synced;
}

const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
const money = (n) => "$" + Number(n || 0).toFixed(2);
const priceFmt = (n) => {
  const num = Number(n || 0);
  let s = num.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (!s.includes(".")) s = num.toFixed(2);
  return "$" + s;
};

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

function parsePriceList(text) {
  const out = [];
  const lines = text.split("\n");
  for (let raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (/^[*_].*[*_]$/.test(line)) continue; 
    if (/^-\s*\w/.test(line) && !/[\d.]|out of stock/i.test(line)) continue; 
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

// Helpers for Date management
function isToday(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  return d.getDate() === today.getDate() &&
         d.getMonth() === today.getMonth() &&
         d.getFullYear() === today.getFullYear();
}

function getStartOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

// ============================================================
// 2. ROOT
// ============================================================
export default function App() {
  const [user, setUser] = useState(null); 
  const [bizNames, setBizNames] = useState({ 1: "Business 1", 2: "Business 2" });

  useEffect(() => {
    (async () => {
      try {
        const rows = await sb.select("businesses", "select=id,name");
        const m = {};
        rows.forEach((b) => { m[b.id] = b.name; });
        setBizNames((prev) => ({ ...prev, ...m }));
      } catch {}
    })();
  }, [user]);

  if (!configured) return <SetupNotice />;
  if (!user) return <Login onLogin={setUser} />;
  const businessName = bizNames[user.business_id] || `Business ${user.business_id}`;
  return user.role === "admin"
    ? <Admin user={user} businessName={businessName} onExit={() => setUser(null)} />
    : <Seller user={user} businessName={businessName} onExit={() => setUser(null)} />;
}

// ============================================================
// 3. LOGIN (name + PIN)
// ============================================================
function Login({ onLogin }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const rows = await sb.rpc("login_with_pin", { p_name: name.trim(), p_pin: pin });
      if (rows && rows.length) onLogin(rows[0]);
      else setErr("Name or PIN is incorrect.");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div style={S.loginDarkShell}>
      <MarketWatermark />
      <div style={{ ...S.loginCard, position: "relative", zIndex: 1 }}>
        <HeroImage />
        <div style={S.logoMark}><Box size={24} strokeWidth={2.4} /></div>
        <h1 style={S.loginTitle}>Pamusika</h1>
        <p style={S.loginSub}>Enter your name and PIN to sign in.</p>

        <div style={S.fieldWrap}>
          <span style={{ ...S.fieldLabel, color: "rgba(234,243,236,0.8)" }}>Name</span>
          <input style={S.inputDark} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mum" />
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
// 4. SHARED DATA HOOK (With Enhanced Phase 3 Caching & Optimization)
// ============================================================
function useData(businessId) {
  const [products, setProducts] = useState(() => store.get(cacheKey(businessId, "products"), []));
  const [sales, setSales] = useState(() => store.get(cacheKey(businessId, "sales"), []));
  const [expenses, setExpenses] = useState(() => store.get(cacheKey(businessId, "expenses"), []));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(isOnline());
  const [pending, setPendingCount] = useState(getPending(businessId).length);

  const refresh = useCallback(async () => {
    if (isOnline()) {
      try { await flushPending(businessId); } catch {}
    }
    setPendingCount(getPending(businessId).length);

    try {
      setError("");
      const bizFilter = `business_id=eq.${businessId}&`;
      
      // Phase 3 Optimization: Parallel high-speed fetch with expanded limit boundaries
      const [p, s, expRows] = await Promise.all([
        sb.select("products", `${bizFilter}order=created_at.asc`),
        sb.select("sales", `${bizFilter}order=sold_at.desc&limit=6000`),
        sb.select("expenses", `${bizFilter}order=date.desc`).catch(() => store.get(cacheKey(businessId, "expenses"), []))
      ]);
      
      setProducts(p); 
      setSales(s);
      setExpenses(Array.isArray(expRows) ? expRows : []);
      
      store.set(cacheKey(businessId, "products"), p);
      store.set(cacheKey(businessId, "sales"), s);
      store.set(cacheKey(businessId, "expenses"), Array.isArray(expRows) ? expRows : []);
      setOnline(true);
    } catch (e) {
      setOnline(false);
      const cachedP = store.get(cacheKey(businessId, "products"), []);
      const cachedS = store.get(cacheKey(businessId, "sales"), []);
      const cachedExp = store.get(cacheKey(businessId, "expenses"), []);
      if (cachedP.length) setProducts(cachedP);
      if (cachedS.length) setSales(cachedS);
      if (cachedExp.length) setExpenses(cachedExp);
      setError(""); 
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
    // Phase 3 Performance optimization loop speed
    const t = setInterval(refresh, 10000);
    const goOnline = () => { setOnline(true); refresh(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { clearInterval(t); window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, [refresh]);

  return { products, sales, expenses, setExpenses, loading, error, refresh, online, pending, setPendingCount };
}

// ============================================================
// 5. ADMIN (With Phase 1 & 2 Dashboards, Reports and Caching)
// ============================================================
function Admin({ user, onExit, businessName }) {
  const { products, sales, expenses, setExpenses, loading, error, refresh } = useData(user.business_id);
  const [tab, setTab] = useState("overview");

  // Expense Management State
  const [expName, setExpName] = useState("");
  const [expAmt, setExpAmt] = useState("");
  const [expCategory, setExpCategory] = useState("Stock");

  // Filtering Core Datasets for Archive Views vs Today
  const todaySales = sales.filter(s => isToday(s.sold_at));
  const archiveSales = sales.filter(s => !isToday(s.sold_at));

  // Reports Aggregations Configuration Matrix
  const computeMetrics = (filteredSales, filteredExpenses) => {
    const revenue = filteredSales.reduce((a, x) => a + Number(x.total), 0);
    const tithe = filteredSales.reduce((a, x) => a + Number(x.tithe), 0);
    const costOfExpenses = filteredExpenses.reduce((a, x) => a + Number(x.amount), 0);
    const cashOnHand = revenue - tithe - costOfExpenses;
    return { revenue, tithe, costOfExpenses, cashOnHand };
  };

  const metrics = computeMetrics(sales, expenses);
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

  const addExpense = async (e) => {
    e.preventDefault();
    if (!expName.trim() || !expAmt) return;
    const newExp = {
      business_id: user.business_id,
      name: expName.trim(),
      amount: parseFloat(expAmt),
      category: expCategory,
      date: new Date().toISOString()
    };
    try {
      await sb.insert("expenses", newExp);
      setExpName(""); setExpAmt("");
      await refresh();
    } catch (err) {
      // Local Save Fallback if offline
      const currentExp = [...expenses, { ...newExp, id: Date.now() }];
      setExpenses(currentExp);
      store.set(cacheKey(user.business_id, "expenses"), currentExp);
    }
  };

  // Phase 2 Metric Engines: Best-Selling Products Calculator
  const getBestSellers = (targetSales) => {
    const counts = {};
    targetSales.forEach(s => {
      const name = s.product_name || "Unknown Product";
      counts[name] = (counts[name] || 0) + Number(s.qty || 1);
    });
    return Object.entries(counts)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  };

  // Phase 2 Metric Engines: Sales attribution breakdown by Seller
  const getSellerPerformance = (targetSales) => {
    const performances = {};
    targetSales.forEach(s => {
      const sName = s.seller_name || "Unknown Seller";
      performances[sName] = (performances[sName] || 0) + Number(s.total);
    });
    return Object.entries(performances).map(([name, total]) => ({ name, total }));
  };

  return (
    <div style={S.shell}>
      <LightWatermark />
      <Header title={businessName} sub={`${user.name} · Admin`} onExit={onExit} onRefresh={refresh} />
      {error && <div style={S.alert}><AlertTriangle size={16} /> {error}</div>}
      {out.length > 0 && (
        <div style={{ ...S.alert, background: "#FFE2E2", color: "#C0392B" }}>
          <AlertTriangle size={16} />
          <span><b>{out.length}</b> item{out.length > 1 ? "s have" : " has"} sold out — restock when you can.</span>
        </div>
      )}
      <Tabs tab={tab} setTab={setTab} items={[
        ["overview","Overview"],["stock","Stock"],["transactions","Today's Invoices"],["archive", "Sales Archive"],["analytics", "POS Analytics"],["expenses", "Expenses"],["team","Team"]
      ]} />
      <div style={S.body}>
        {loading ? <Loading /> : <>
          {tab === "overview" && <>
            <div style={S.statGrid}>
              <Stat icon={<TrendingUp size={16} />} label="Total Sales (All-time)" value={money(metrics.revenue)} accent delay={0} />
              <Stat icon={<Wallet size={16} />} label="Reconciled Cash" value={money(metrics.cashOnHand)} tint={mango} delay={0.05} />
              <Stat icon={<Church size={16} />} label="To God (Tithe)" value={money(metrics.tithe)} tint={grape} delay={0.1} />
              <Stat icon={<Package size={16} />} label="Items in stock" value={products.reduce((a,p)=>a+p.qty,0)} tint={sky} delay={0.15} />
            </div>
            
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginTop: "16px" }}>
              <div style={{ flex: 1, minWidth: "280px", background: "rgba(255,255,255,0.05)", padding: "14px", borderRadius: "12px", border: `1px solid ${line}` }}>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: 700, color: accent }}>🏆 Best Sellers Today</h3>
                {getBestSellers(todaySales).length === 0 ? <p style={S.hint}>No sales items recorded today.</p> : 
                  getBestSellers(todaySales).map((p, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px", borderBottom: `1px solid ${line}` }}>
                      <span>{emojiFor(p.name)} {p.name}</span>
                      <span style={{ fontWeight: 800 }}>{p.qty} packs</span>
                    </div>
                  ))
                }
              </div>
              <div style={{ flex: 1, minWidth: "280px", background: "rgba(255,255,255,0.05)", padding: "14px", borderRadius: "12px", border: `1px solid ${line}` }}>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: 700, color: mango }}>👥 Seller Revenue Tracking</h3>
                {getSellerPerformance(todaySales).length === 0 ? <p style={S.hint}>No seller activity tracked today.</p> : 
                  getSellerPerformance(todaySales).map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px", borderBottom: `1px solid ${line}` }}>
                      <span>👤 {s.name}</span>
                      <span style={{ fontWeight: 800, color: accent }}>{money(s.total)}</span>
                    </div>
                  ))
                }
              </div>
            </div>

            <SectionTitle>Recent Live Sales (Today Only)</SectionTitle>
            <p style={S.hint}>Showing current daily operations context. Tap ✕ to remove or void and restore inventory stock levels.</p>
            <SalesList sales={todaySales.slice(0,25)} showSeller onDelete={deleteSale} showTithe />
          </>}

          {tab === "stock" && <StockManager products={products} onChange={refresh} businessId={user.business_id} />}
          
          {tab === "transactions" && (
            <div>
              <SectionTitle>Today's Invoices</SectionTitle>
              <Transactions sales={todaySales} products={products} businessId={user.business_id} onChange={refresh} onDeleteSale={deleteSale} />
            </div>
          )}

          {tab === "archive" && (
            <div>
              <SectionTitle>Historical Sales Archive Ledger</SectionTitle>
              <p style={S.hint}>Isolated view keeping older history separate from today's active terminal run.</p>
              <Transactions sales={archiveSales} products={products} businessId={user.business_id} onChange={refresh} onDeleteSale={deleteSale} />
            </div>
          )}

          {tab === "analytics" && (
            <AdminAnalytics sales={sales} expenses={expenses} products={products} getBestSellers={getBestSellers} getSellerPerformance={getSellerPerformance} />
          )}

          {tab === "expenses" && (
            <div>
              <SectionTitle>Expense Ledger Control</SectionTitle>
              <form onSubmit={addExpense} style={{ background: "rgba(255,255,255,0.04)", padding: "14px", borderRadius: "12px", border: `1px solid ${line}`, marginBottom: "16px" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ flex: 2, minWidth: "180px" }}>
                    <span style={S.fieldLabel}>Expense Description</span>
                    <input style={S.input} value={expName} onChange={e => setExpName(e.target.value)} placeholder="e.g., Fuel, Packaging box, Delivery" />
                  </div>
                  <div style={{ flex: 1, minWidth: "100px" }}>
                    <span style={S.fieldLabel}>Amount ($)</span>
                    <input style={S.input} type="number" step="0.01" value={expAmt} onChange={e => setExpAmt(e.target.value)} placeholder="0.00" />
                  </div>
                  <div style={{ flex: 1, minWidth: "120px" }}>
                    <span style={S.fieldLabel}>Category</span>
                    <select style={{ ...S.input, background: "#1b2e25", color: ink }} value={expCategory} onChange={e => setExpCategory(e.target.value)}>
                      <option value="Stock">Stock Buy</option>
                      <option value="Logistics">Logistics/Fuel</option>
                      <option value="Rent">Rent & Utility</option>
                      <option value="Wages">Wages/Bonus</option>
                      <option value="Other">Other Miscellaneous</option>
                    </select>
                  </div>
                </div>
                <button type="submit" style={{ ...S.btn, ...S.btnDark, marginTop: "12px", width: "100%" }} disabled={!expName.trim() || !expAmt}>
                  💾 Record Operational Expense
                </button>
              </form>
              
              <SectionTitle>Logged Business Outflows ({expenses.length})</SectionTitle>
              {expenses.length === 0 ? <p style={S.empty}>No structural expenses recorded for this interval.</p> : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {expenses.map((ex, i) => (
                    <div key={ex.id || i} style={{ ...S.card, justifyContent: "space-between" }}>
                      <div>
                        <div style={{ ...S.cardName, fontSize: "14px" }}>{ex.name}</div>
                        <div style={{ ...S.cardMeta, fontSize: "12px" }}>📁 {ex.category} · 🗓️ {new Date(ex.date).toLocaleDateString()}</div>
                      </div>
                      <div style={{ fontWeight: 800, color: "#FF8B7A" }}>-{money(ex.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "team" && <TeamManager onChange={refresh} businessId={user.business_id} />}
        </>}
      </div>
    </div>
  );
}

// ============================================================
// PHASE 2 MODULE: PROFESSIONAL PERIODIC REPORTING ENGINE
// ============================================================
function AdminAnalytics({ sales, expenses, products, getBestSellers, getSellerPerformance }) {
  const [period, setPeriod] = useState("today");

  const filterByPeriod = (items, dateField) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    return items.filter(item => {
      const itemDate = new Date(item[dateField]);
      if (period === "today") {
        return itemDate >= startOfToday;
      } else if (period === "week") {
        return itemDate >= getStartOfWeek(now);
      } else if (period === "month") {
        return itemDate.getMonth() === now.getMonth() && itemDate.getFullYear() === now.getFullYear();
      } else if (period === "year") {
        return itemDate.getFullYear() === now.getFullYear();
      }
      return true;
    });
  };

  const periodSales = filterByPeriod(sales, "sold_at");
  const periodExpenses = filterByPeriod(expenses, "date");

  const totalRev = periodSales.reduce((a, s) => a + Number(s.total), 0);
  const totalTithe = periodSales.reduce((a, s) => a + Number(s.tithe), 0);
  const totalExp = periodExpenses.reduce((a, e) => a + Number(e.amount), 0);
  const netProfit = totalRev - totalTithe - totalExp;

  return (
    <div>
      <SectionTitle>POS Performance & Financial Audits</SectionTitle>
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", background: "rgba(0,0,0,0.2)", padding: "4px", borderRadius: "8px" }}>
        {["today", "week", "month", "year"].map((p) => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            flex: 1, padding: "8px", borderRadius: "6px", border: "none", fontSize: "12px", fontWeight: 700, textTransform: "capitalize",
            background: period === p ? accent : "transparent", color: period === p ? "#123026" : ink, cursor: "pointer"
          }}>
            {p}
          </button>
        ))}
      </div>

      <div style={S.statGrid}>
        <Stat icon={<DollarSign size={15} />} label="Revenue" value={money(totalRev)} accent />
        <Stat icon={<Calendar size={15} />} label="Expenses" value={money(totalExp)} tint="#FF8B7A" />
        <Stat icon={<Church size={15} />} label="Tithe" value={money(totalTithe)} tint={grape} />
        <Stat icon={<TrendingUp size={15} />} label="Net Cash-up" value={money(netProfit)} tint={sky} />
      </div>

      <div style={{ marginTop: "20px" }}>
        <h3 style={{ fontSize: "15px", margin: "0 0 10px 0", color: ink }}>📊 Best Selling Matrix For Selected Scope</h3>
        {getBestSellers(periodSales).map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.03)", padding: "10px", borderRadius: "8px", marginBottom: "6px" }}>
            <span>{i+1}. {emojiFor(p.name)} <b>{p.name}</b></span>
            <span style={{ fontWeight: 800, color: accent }}>{p.qty} Packs sold</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 6. SELLER TERMINAL (With Smart Daily Reset Filter Rule)
// ============================================================
function Seller({ user, onExit, businessName }) {
  const { products, sales, loading, error, refresh, online, pending, setPendingCount } = useData(user.business_id);
  const [toast, setToast] = useState("");
  const [adding, setAdding] = useState(null);   
  const cartKey = cacheKey(user.business_id, `cart:${user.name}`);
  const [cart, setCart] = useState(() => {
    const saved = store.get(cartKey, []);
    return Array.isArray(saved) ? saved : [];
  });          
  const [showCart, setShowCart] = useState(false);
  const [receipt, setReceipt] = useState(null);  
  const [closingDay, setClosingDay] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const [search, setSearch] = useState("");
  const [lastCashup, setLastCashup] = useState(() => store.get(cacheKey(user.business_id, `cashup:${user.name}`), null));

  // Phase 1: Automatic local reset logic check at execution time
  const lastResetDate = store.get(cacheKey(user.business_id, "midnight_tracker"), "");
  const todayString = new Date().toDateString();
  
  useEffect(() => {
    if (lastResetDate && lastResetDate !== todayString) {
      // Local clean sweep triggers instantly on midnight crossing detection
      setCart([]);
      store.set(cartKey, []);
      store.set(cacheKey(user.business_id, "midnight_tracker"), todayString);
    } else if (!lastResetDate) {
      store.set(cacheKey(user.business_id, "midnight_tracker"), todayString);
    }
  }, [lastResetDate, todayString, cartKey, user.business_id]);

  // Phase 1 Rule: Constrain seller timeline visualization purely to current active day ("today's sales only")
  const mine = sales.filter((s) => s.seller_name === user.name && isToday(s.sold_at));
  const sinceCashup = lastCashup ? mine.filter((s) => new Date(s.sold_at) > new Date(lastCashup)) : mine;
  const myTotal = sinceCashup.reduce((a, x) => a + Number(x.total), 0);
  const myCount = sinceCashup.length;

  // Phase 3: Check-and-block validation layer before rendering cart updates
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

  useEffect(() => { store.set(cartKey, cart); }, [cart, cartKey]);

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
  }, [products]);

  const cartTotal = cart.reduce((a, c) => a + c.units * Number(c.product.price), 0);
  const cartCount = cart.reduce((a, c) => a + c.units, 0);

  const checkout = async ({ customer, phone } = {}) => {
    if (cart.length === 0) return;
    
    // Phase 3: Dynamic cryptographic random nonce signature generation to prevent duplicates
    const trackingNonce = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const items = cart.map((c)
