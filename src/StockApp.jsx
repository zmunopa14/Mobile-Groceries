import React, { useState, useEffect, useCallback, useRef } from "react";
import { jsPDF } from "jspdf";
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
      await sb.rpc("record_invoice", {
        p_items: sale.items, p_seller: sale.seller,
        p_customer: sale.customer || null, p_phone: sale.phone || null,
      });
      synced++;
    } catch {
      remaining.push(sale); // keep it to retry later
    }
  }
  setPending(biz, remaining);
  return synced;
}

const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
const money = (n) => "$" + Number(n || 0).toFixed(2);
// Unit price shown with full precision (trims trailing zeros): 0.475 -> $0.475
const priceFmt = (n) => {
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
export default function App() {
  const [user, setUser] = useState(null); // {id,name,role,business_id}
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
      const [p, s] = await Promise.all([
        sb.select("products", `${bizFilter}order=created_at.asc`),
        sb.select("sales", `${bizFilter}order=sold_at.desc&limit=5000`),
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
    const t = setInterval(refresh, 8000);
    const goOnline = () => { setOnline(true); refresh(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { clearInterval(t); window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, [refresh]);

  return { products, sales, loading, error, refresh, online, pending, setPendingCount };
}

// ============================================================
// 5. ADMIN
// ============================================================
function Admin({ user, onExit, businessName }) {
  const { products, sales, loading, error, refresh } = useData(user.business_id);
  const [tab, setTab] = useState("overview");
  const [cats, setCats] = useState([]);   // this business's category names

  const loadCats = useCallback(async () => {
    try {
      const rows = await sb.select("categories", `business_id=eq.${user.business_id}&order=name.asc`);
      setCats(rows.map((r) => r.name));
    } catch { setCats([]); }
  }, [user.business_id]);
  useEffect(() => { loadCats(); }, [loadCats]);

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

  return (
    <div style={S.shell}>
      <LightWatermark />
      <Header title={businessName} sub={`${user.name} · Admin`} onExit={onExit} onRefresh={refresh} />
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
      <Tabs tab={tab} setTab={setTab} items={[
        ["overview","Overview"],["stock","Stock"],["transactions","Sales"],["order","Order"],["customers","Customers"],["compare","Compare"],["cashups","Cash-ups"],["report","Tuesday report"],["team","Team"],
      ]} />
      <div style={S.body}>
        {loading ? <Loading /> : <>
          {tab === "overview" && <>
            <div style={S.statGrid}>
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
          {tab === "transactions" && <Transactions sales={sales} products={products} businessId={user.business_id} onChange={refresh} onDeleteSale={deleteSale} cats={cats} />}
          {tab === "order" && <OrderList products={products} sales={sales} businessName={businessName} />}
          {tab === "customers" && <Customers sales={sales} />}
          {tab === "compare" && <Compare sales={sales} />}
          {tab === "cashups" && <CashUps businessId={user.business_id} sales={sales} />}
          {tab === "report" && <Report sales={sales} products={products} low={[...out, ...low]} cats={cats} />}
          {tab === "team" && <TeamManager onChange={refresh} businessId={user.business_id} sales={sales} />}
        </>}
      </div>
    </div>
  );
}

// ============================================================
// 6. SELLER
// ============================================================
function Seller({ user, onExit, businessName }) {
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

  const checkout = async ({ customer, phone, discount = 0, finalTotal } = {}) => {
    if (cart.length === 0) return;
    const items = cart.map((c) => ({ product_id: c.product.id, qty: c.units }));
    const lines = cart.map((c) => ({
      name: c.product.name, units: c.units,
      price: Number(c.product.price), pack_size: c.product.pack_size || 1,
      total: c.units * Number(c.product.price),
    }));
    const baseReceipt = {
      when: new Date(), seller: user.name, business: businessName,
      customer: customer || "", phone: phone || "", lines,
      subtotal: cartTotal, discount: discount || 0,
      total: finalTotal != null ? finalTotal : cartTotal,
    };

    const saveOffline = () => {
      queueSale(user.business_id, { items, seller: user.name, customer, phone, when: new Date().toISOString() });
      if (setPendingCount) setPendingCount(getPending(user.business_id).length);
      setReceipt({ ...baseReceipt, no: "PENDING", offline: true });
      setCart([]); setShowCart(false);
      setToast("Saved offline — will sync when online");
      setTimeout(() => setToast(""), 2500);
    };

    if (!isOnline()) { saveOffline(); return; }

    try {
      const inv = await sb.rpc("record_invoice", {
        p_items: items, p_seller: user.name,
        p_customer: customer || null, p_phone: phone || null,
      });
      const invoiceNo = typeof inv === "string" ? inv : (inv && inv[0]) || "INV";
      setReceipt({ ...baseReceipt, no: invoiceNo });
      setCart([]); setShowCart(false);
      await refresh();
    } catch (e) {
      // Server unreachable mid-sale → fall back to offline queue instead of losing it
      saveOffline();
    }
  };

  const shown = filterProducts(products, search);

  return (
    <div style={S.shell}>
      <LightWatermark />
      <Header title={user.name} sub={`${businessName} · Seller`} onExit={onExit} onRefresh={refresh} />
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
          <div style={S.statGrid}>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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

  const discNum = parseFloat(discVal) || 0;
  const discount = discType === "pct" ? total * Math.min(discNum, 100) / 100
                 : discType === "flat" ? Math.min(discNum, total)
                 : 0;
  const finalTotal = Math.max(0, total - discount);

  const go = async () => {
    setBusy(true);
    await onCheckout({ customer: customer.trim(), phone: phone.trim(), discount, finalTotal });
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
  // Build a real PDF file (jsPDF) for this receipt
  const makePdfBlob = () => {
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
    const blob = makePdfBlob();
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

function localDateStr(d) {
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
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(product.qty));

  const start = () => { setVal(String(product.qty)); setEditing(true); };
  const commit = () => {
    setEditing(false);
    if (val !== "" && parseFloat(val) !== product.qty) onSet(val);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{ ...S.input, width: 70, textAlign: "center", padding: "8px 6px", fontWeight: 800 }}
      />
    );
  }
  return (
    <button onClick={start} title="Tap to set stock"
      style={{ minWidth: 62, padding: "8px 6px", borderRadius: 10, border: `1px solid ${line}`,
        background: "rgba(255,255,255,0.06)", color: ink, fontWeight: 800, fontSize: 16, cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span>{product.qty}</span>
      <span style={{ fontSize: 9, color: muted, fontWeight: 600 }}>tap to edit</span>
    </button>
  );
}

// Left slide-out menu for switching product categories + stock actions
function CategorySidebar({ open, onClose, current, onPick, counts, cats = [], onAdd, onBulk, onManageCats }) {
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
    try { await sb.del("categories", `business_id=eq.${businessId}&name=eq.${encodeURIComponent(c)}`); await onChange(); }
    catch (e) { alert(e.message); }
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

  const byCat = cat === "All" ? products : products.filter((p) => (p.category || "Uncategorised") === cat);
  const shown = filterProducts(byCat, search);
  const catCount = (c) => products.filter((p) => (p.category || "Uncategorised") === c).length;

  return (
    <>
      <CategorySidebar open={menuOpen} onClose={() => setMenuOpen(false)}
        current={cat} onPick={(c) => { setCat(c); setMenuOpen(false); }}
        counts={{ All: products.length, ...Object.fromEntries(CATS.map((c) => [c, catCount(c)])) }}
        cats={CATS}
        onAdd={() => { setMenuOpen(false); setOpen(true); }}
        onBulk={() => { setMenuOpen(false); setBulk(true); }}
        onManageCats={() => { setMenuOpen(false); setManageCats(true); }} />

      <button onClick={() => setMenuOpen(true)}
        style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 12, justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Menu size={18} /> {cat === "All" ? "All products" : cat}</span>
        <span style={{ color: muted, fontSize: 12 }}>menu ›</span>
      </button>

      {products.length > 0 && <SearchBar value={search} onChange={setSearch} />}
      {products.length === 0 && <p style={S.empty}>No products yet. Open the menu ≡ and tap “Add product”.</p>}
      {products.length > 0 && shown.length === 0 && <p style={S.empty}>{search ? `No products match “${search}”.` : `No products in ${cat} yet.`}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map((p) => {
          const ps = p.pack_size || 1;
          return (
            <div key={p.id} style={S.card}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{p.name} {p.qty <= 0 ? <span style={S.outTag}>out — restock</span> : p.qty <= p.low_at ? <span style={S.lowTag}>low</span> : null}</div>
                <div style={S.cardMeta}>{priceFmt(p.price)}/pack · {p.tithe_pct}% to God{ps > 1 ? ` · pack of ${ps}` : ""}{p.category ? <> · <span style={{ color: goldLt }}>{p.category}</span></> : ""}</div>
                <div style={{ ...S.cardMeta, color: p.qty <= 0 ? "#C0392B" : "#1F9D55", fontWeight: 600 }}>{p.qty <= 0 ? `${p.qty} packs — out of stock` : stockLabel(p)}</div>
              </div>
              <StockEditor product={p} onSet={(v) => setStock(p, v)} />
              <button style={S.editBtn} onClick={() => setEditing(p)}><Pencil size={15} /></button>
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
      {editing && <EditProductModal product={editing} cats={CATS} onClose={() => setEditing(null)} onSave={saveEdit} onDelete={async () => { await remove(editing.id); setEditing(null); }} />}
      {manageCats && <ManageCategories businessId={businessId} cats={CATS} onClose={() => setManageCats(false)} onChange={onCatsChange} />}
      {bulk && <BulkAddModal businessId={businessId} onClose={() => setBulk(false)} onDone={async () => { setBulk(false); await onChange(); }} />}
    </>
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
function EditProductModal({ product, cats = [], onClose, onSave, onDelete }) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [pct, setPct] = useState(String(product.tithe_pct));
  const [packSize, setPackSize] = useState(String(product.pack_size || 1));
  const [low, setLow] = useState(String(product.low_at));
  const [orderBox, setOrderBox] = useState(String(product.order_box || 1));
  const [category, setCategory] = useState(product.category || "Uncategorised");
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
      <p style={{ ...S.hint, marginBottom: 4 }}>To change quantity, tap the stock number on the list and type it.</p>
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 4 }} disabled={busy} onClick={save}>
        <Check size={18} /> {busy ? "Saving…" : "Save changes"}
      </button>
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

function Transactions({ sales, products, businessId, onChange, onDeleteSale, cats = [] }) {
  const [prodQ, setProdQ] = useState("");
  const [fromQ, setFromQ] = useState("");
  const [toQ, setToQ] = useState("");
  const [cat, setCat] = useState("All");
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

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
    </>
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
      {editing && <EditCashUpModal report={editing} onClose={() => setEditing(null)} onSave={saveEdit} onDelete={async () => { await remove(editing.id); setEditing(null); }} />}
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

// Procurement / reorder list — suggests quantities from last 7 days of sales
function OrderList({ products, sales, businessName }) {
  const [qtys, setQtys] = useState({});   // productId -> adjusted order qty
  const [copied, setCopied] = useState(false);

  // Sales in the last 7 days, per product name
  const weekAgo = Date.now() - 7 * 86400000;
  const soldLastWeek = {};
  sales.forEach((s) => {
    if (new Date(s.sold_at).getTime() >= weekAgo) {
      soldLastWeek[s.product_name] = (soldLastWeek[s.product_name] || 0) + Number(s.qty);
    }
  });

  // Items at or below their low level
  const items = products
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

  const orderQty = (it) => (qtys[it.p.id] !== undefined ? qtys[it.p.id] : it.propose);  // in BOXES
  const setQty = (id, v) => setQtys((prev) => ({ ...prev, [id]: Math.max(0, parseInt(v) || 0) }));

  const toOrder = items.filter((it) => orderQty(it) > 0);

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

  return (
    <>
      <SectionTitle>Order list (for Harare)</SectionTitle>
      <p style={S.hint}>Shows items at or below their low-stock level. Suggestions come from last 7 days of sales and are shown in BOXES (set each product’s box size in its edit screen). Adjust any number, then share.</p>

      {items.length === 0 && <p style={S.empty}>Nothing is low right now. 🎉</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it) => (
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
    </>
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

function Report({ sales, products, low, cats = [] }) {
  // Week runs Tuesday → Monday. Let the admin step back through weeks.
  const [weekOffset, setWeekOffset] = useState(0);   // 0 = current week
  const [cat, setCat] = useState("All");

  const catOf = {}, pctOf = {};
  (products || []).forEach((p) => { catOf[p.name] = p.category || "Uncategorised"; pctOf[p.name] = Number(p.tithe_pct) || 0; });
  // Live "to God" for a sale row, using the product's CURRENT percentage
  const titheOf = (s) => Number(s.total) * (pctOf[s.product_name] || 0) / 100;

  const now = new Date();
  const dow = now.getDay();
  const daysSinceTue = (dow - 2 + 7) % 7;
  const weekStart = new Date(now); weekStart.setHours(0,0,0,0);
  weekStart.setDate(now.getDate() - daysSinceTue - weekOffset * 7); // Tuesday
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); // Monday
  const startStr = localDateStr(weekStart), endStr = localDateStr(weekEnd);

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
  const weekTotalSales = weekRows.reduce((a, s) => a + Number(s.total), 0);
  const weekTotalTithe = weekRows.reduce((a, s) => a + titheOf(s), 0);

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
          <div style={{ ...S.cardMeta, color: "rgba(255,255,255,0.8)" }}>
            {weekStart.toLocaleDateString()} (Tue) → {weekEnd.toLocaleDateString()} (Mon)
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button style={{ ...S.btn, ...S.btnGhost, flex: 1 }} onClick={() => setWeekOffset(weekOffset + 1)}>‹ Previous</button>
        <button style={{ ...S.btn, ...S.btnGhost, flex: 1 }} disabled={weekOffset === 0} onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))}>Next ›</button>
      </div>
      <label style={{ ...S.fieldWrap, marginBottom: 12 }}>
        <span style={S.fieldLabel}>Company / category</span>
        <select style={S.input} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="All">All companies</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <div style={S.statGrid}>
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

// ============================================================
// 9. TEAM MANAGER (admin) — create salespeople with a PIN
// ============================================================
function TeamManager({ onChange, businessId, sales = [] }) {
  const [members, setMembers] = useState([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMembers(await sb.select("members", `business_id=eq.${businessId}&select=id,name,role,created_at&order=created_at.asc`)); } catch {}
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

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
function Header({ title, sub, onExit, onRefresh }) {
  return (
    <div style={S.header}>
      <div>
        <div style={S.headTitle}>{title}</div>
        <div style={S.headSub}>{sub}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {onRefresh && <button style={S.exitBtn} onClick={onRefresh}><RefreshCw size={15} /></button>}
        <button style={S.exitBtn} onClick={onExit}><LogOut size={16} /> Sign out</button>
      </div>
    </div>
  );
}
function Tabs({ tab, setTab, items }) {
  return (
    <div style={S.tabs}>
      {items.map(([k, label]) => (
        <button key={k} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }} onClick={() => setTab(k)}>{label}</button>
      ))}
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
function SectionTitle({ children }) { return <div style={S.sectionTitle}>{children}</div>; }
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
function Loading() { return <div style={{ textAlign: "center", padding: "40px 0" }}><div style={S.loadDot} /></div>; }
function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label style={S.fieldWrap}>
      <span style={S.fieldLabel}>{label}</span>
      <input style={S.input} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Modal({ children, onClose, title }) {
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

function MarketWatermark() {
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
  // Code-drawn animated scene: delivery van, seller handing a grocery bag,
  // customer handing money back. No external image needed.
  return (
    <div style={S.heroWrap}>
      <svg viewBox="0 0 360 200" style={{ width: "100%", display: "block" }} aria-hidden="true">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#11342a" />
            <stop offset="1" stopColor="#0c241d" />
          </linearGradient>
          <linearGradient id="van" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2bd07a" />
            <stop offset="1" stopColor="#1f9d55" />
          </linearGradient>
        </defs>

        {/* ground */}
        <rect x="0" y="0" width="360" height="200" fill="url(#sky)" />
        <line x1="0" y1="165" x2="360" y2="165" stroke="#1c4d3d" strokeWidth="2" />

        {/* sun/coin glow */}
        <circle cx="300" cy="45" r="26" fill="#F5C443" opacity="0.18" />
        <circle cx="300" cy="45" r="15" fill="#F5C443" opacity="0.30" />

        {/* delivery van */}
        <g>
          <rect x="18" y="92" width="78" height="46" rx="6" fill="url(#van)" />
          <rect x="96" y="104" width="34" height="34" rx="6" fill="url(#van)" />
          <rect x="100" y="108" width="22" height="16" rx="3" fill="#d8fbe6" opacity="0.85" />
          <text x="40" y="122" fontSize="13" fontWeight="800" fill="#0c241d" fontFamily="Inter, sans-serif">FRESH</text>
          <circle cx="44" cy="142" r="11" fill="#0c241d" stroke="#2bd07a" strokeWidth="3" />
          <circle cx="110" cy="142" r="11" fill="#0c241d" stroke="#2bd07a" strokeWidth="3" />
        </g>

        {/* seller */}
        <g>
          <circle cx="170" cy="96" r="9" fill="#F5C443" />
          <rect x="162" y="106" width="16" height="30" rx="7" fill="#2bd07a" />
          {/* seller arm holding the bag, gentle hand-off motion */}
          <g style={{ transformOrigin: "172px 116px", animation: "handoff 3.2s ease-in-out infinite" }}>
            <line x1="176" y1="114" x2="198" y2="120" stroke="#F5C443" strokeWidth="4" strokeLinecap="round" />
            {/* grocery bag */}
            <path d="M196 116 h16 l3 20 h-22 z" fill="#C98A3A" />
            <path d="M200 116 q4 -6 8 0" fill="none" stroke="#C98A3A" strokeWidth="2" />
            <circle cx="201" cy="126" r="2" fill="#2bd07a" />
            <circle cx="207" cy="124" r="2" fill="#E0457B" />
            <circle cx="211" cy="128" r="2" fill="#F5C443" />
          </g>
        </g>

        {/* customer */}
        <g>
          <circle cx="246" cy="98" r="9" fill="#F2C9A0" />
          <rect x="238" y="108" width="16" height="28" rx="7" fill="#2FA7D8" />
          {/* customer arm handing money */}
          <g style={{ transformOrigin: "242px 118px", animation: "handoff 3.2s ease-in-out infinite reverse" }}>
            <line x1="238" y1="116" x2="220" y2="122" stroke="#F2C9A0" strokeWidth="4" strokeLinecap="round" />
            <rect x="208" y="117" width="16" height="10" rx="2" fill="#7CC243" stroke="#0c241d" strokeWidth="1" />
            <text x="212" y="125" fontSize="7" fontWeight="800" fill="#0c241d" fontFamily="Inter, sans-serif">$</text>
          </g>
        </g>

        {/* floating exchange sparkle */}
        <g opacity="0.9">
          <circle cx="215" cy="100" r="2" fill="#F5C443" style={{ animation: "rise 2.6s ease-in-out infinite" }} />
        </g>
      </svg>
    </div>
  );
}

function HeroImage() {
  // Optional real photo / 3D render: drop hero.jpg into the project's public folder.
  // It renders here in a premium gold-edged frame with a soft glow.
  const [ok, setOk] = useState(true);
  if (!ok) return <DeliveryScene />;
  return (
    <div style={{ position: "relative", marginBottom: 16, borderRadius: 20, overflow: "hidden",
      border: "1px solid rgba(230,196,77,0.45)", boxShadow: "0 20px 50px rgba(0,0,0,0.55), 0 0 0 1px rgba(230,196,77,0.15)" }}>
      <img src="/hero.jpg" alt="" onError={() => setOk(false)}
        style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(7,22,15,0) 40%, rgba(7,22,15,0.55) 100%)" }} />
    </div>
  );
}
function SetupNotice() {
  return (
    <div style={S.shell}>
      <div style={S.loginCard}>
        <div style={S.logoMark}><Box size={26} strokeWidth={2.4} /></div>
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
const ink = "#EAF3EC", paper = "#0c241d", accent = "#2bd07a", line = "rgba(230,196,77,0.18)";
const lime = "#7CC243", mango = "#F5A623", berry = "#E0457B", sky = "#2FA7D8", grape = "#7C5CD6";
const gold = "#C9A227", goldLt = "#E6C44D", darkbg = "#0c241d", darkbg2 = "#11342a", darkcard = "rgba(255,255,255,0.05)";
const cardBg = "rgba(255,255,255,0.05)", muted = "rgba(234,243,236,0.55)";
const S = {
  shell: { maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: `radial-gradient(130% 70% at 50% -10%, ${darkbg2} 0%, ${darkbg} 55%, #07160f 100%)`, fontFamily: "'Inter', system-ui, sans-serif", color: ink, paddingBottom: 60, position: "relative" },
  loadDot: { width: 22, height: 22, borderRadius: "50%", border: `3px solid ${line}`, borderTopColor: accent, animation: "spin 0.8s linear infinite", margin: "0 auto" },

  loginCard: { padding: "30px 26px 40px", maxWidth: 390, margin: "0 auto", textAlign: "center", animation: "popIn 0.5s ease", background: "rgba(12,36,29,0.72)", backdropFilter: "blur(10px)", borderRadius: 26, border: "1px solid rgba(230,196,77,0.25)", boxShadow: "0 30px 70px rgba(0,0,0,0.5)" },
  loginDarkShell: { maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: `radial-gradient(130% 80% at 50% -10%, ${darkbg2} 0%, ${darkbg} 60%, #07160f 100%)`, fontFamily: "'Inter', system-ui, sans-serif", color: "#EAF3EC", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", position: "relative", overflow: "hidden" },
  heroWrap: { borderRadius: 18, overflow: "hidden", marginBottom: 16, border: "1px solid rgba(230,196,77,0.2)", boxShadow: "0 14px 34px rgba(0,0,0,0.4)" },
  watermark: { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.05, pointerEvents: "none", zIndex: 0 },
  watermarkLight: { position: "absolute", top: 60, left: 0, width: "100%", height: 520, opacity: 0.035, pointerEvents: "none", zIndex: 0 },
  logoMark: { width: 60, height: 60, borderRadius: 18, background: `linear-gradient(135deg,${goldLt},${gold})`, color: darkbg, display: "grid", placeItems: "center", margin: "0 auto 14px", boxShadow: "0 10px 30px rgba(201,162,39,0.4)", animation: "bob 3s ease-in-out infinite" },
  loginTitle: { fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 6px", background: `linear-gradient(135deg,${goldLt} 0%, #fff 45%, ${lime} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  loginSub: { fontSize: 14, color: "rgba(234,243,236,0.7)", margin: "0 0 22px", lineHeight: 1.5 },
  errTxt: { color: "#C0392B", fontSize: 13.5, marginTop: 12 },

  pinDot: { width: 14, height: 14, borderRadius: "50%", border: `2px solid rgba(230,196,77,0.5)`, background: "rgba(255,255,255,0.06)", transition: "all 0.2s ease" },
  pinDotFull: { background: goldLt, borderColor: goldLt, transform: "scale(1.2)" },
  keypad: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 6 },
  key: { padding: "16px 0", fontSize: 20, fontWeight: 700, background: cardBg, border: `1px solid ${line}`, borderRadius: 14, cursor: "pointer", color: ink, display: "grid", placeItems: "center" },
  keyDark: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(230,196,77,0.22)", color: "#EAF3EC", boxShadow: "none" },
  inputDark: { width: "100%", boxSizing: "border-box", padding: "13px 14px", border: "1px solid rgba(230,196,77,0.25)", borderRadius: 12, fontSize: 15, background: "rgba(255,255,255,0.07)", color: "#fff", outline: "none" },
  btnGold: { background: `linear-gradient(135deg,${goldLt},${gold})`, color: darkbg, boxShadow: "0 8px 22px rgba(201,162,39,0.4)", fontWeight: 800 },

  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 20px 14px", position: "relative", zIndex: 1 },
  headTitle: { fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", background: `linear-gradient(120deg,${accent} 0%, ${lime} 60%, ${gold} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  headSub: { fontSize: 12, color: muted, textTransform: "uppercase", letterSpacing: "0.06em" },
  exitBtn: { display: "flex", alignItems: "center", gap: 6, background: cardBg, border: `1px solid ${line}`, padding: "7px 12px", borderRadius: 10, fontSize: 13, color: ink, cursor: "pointer" },

  alert: { display: "flex", alignItems: "center", gap: 8, margin: "0 20px 8px", padding: "11px 14px", background: "#FFF1DA", color: "#B26A00", borderRadius: 12, fontSize: 13, animation: "popIn 0.3s ease" },

  tabs: { display: "flex", gap: 4, padding: "6px 16px 0", overflowX: "auto", position: "relative", zIndex: 1 },
  tab: { padding: "9px 14px", border: "none", background: "transparent", fontSize: 13.5, fontWeight: 600, color: muted, cursor: "pointer", borderRadius: 10, whiteSpace: "nowrap" },
  tabActive: { background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", boxShadow: "0 4px 12px rgba(31,157,85,0.3)" },

  body: { padding: "16px 20px 0", position: "relative", zIndex: 1 },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 },
  stat: { background: cardBg, border: `1px solid ${line}`, borderRadius: 16, padding: "14px 15px", animation: "rise 0.4s ease both" },
  statAccent: { background: `linear-gradient(135deg,${accent} 0%, ${lime} 100%)`, border: "none", boxShadow: "0 12px 26px rgba(31,157,85,0.34)", position: "relative", overflow: "hidden", borderTop: `3px solid ${goldLt}` },
  statIcon: { width: 32, height: 32, borderRadius: 10, background: "rgba(43,208,122,0.15)", color: accent, display: "grid", placeItems: "center", marginBottom: 9 },
  statLabel: { fontSize: 11.5, color: muted, marginBottom: 3 },
  statValue: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" },

  sectionTitle: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: muted, margin: "22px 0 10px" },
  hint: { fontSize: 13, color: muted, margin: "-4px 0 12px", lineHeight: 1.5 },
  empty: { fontSize: 13.5, color: muted, textAlign: "center", padding: "20px 0" },

  card: { display: "flex", alignItems: "center", gap: 12, background: cardBg, border: `1px solid ${line}`, borderRadius: 16, padding: "13px 15px", borderTop: `2px solid rgba(230,196,77,0.35)` },
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

  btn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", padding: "14px 16px", borderRadius: 14, fontSize: 14.5, fontWeight: 800, cursor: "pointer" },
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
};

if (typeof document !== "undefined" && !document.getElementById("sf-spin")) {
  const st = document.createElement("style");
  st.id = "sf-spin";
  st.textContent = `
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes pop{0%{transform:scale(0.97);opacity:0.6}100%{transform:scale(1);opacity:1}}
    @keyframes rise{0%{transform:translateY(14px);opacity:0}100%{transform:translateY(0);opacity:1}}
    @keyframes popIn{0%{transform:scale(0.9);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes slideIn{0%{transform:translateX(-100%)}100%{transform:translateX(0)}}
    @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    button{transition:transform 0.08s ease, filter 0.12s ease}
    button:active{transform:scale(0.95)}
    button:hover{filter:brightness(1.05)}
  `;
  document.head.appendChild(st);
}
