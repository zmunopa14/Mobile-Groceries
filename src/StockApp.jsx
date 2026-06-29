import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, TrendingUp, Users, AlertTriangle, Plus, Minus, LogOut,
  Church, Wallet, FileText, ChevronRight, Box, X, Check, Delete, RefreshCw, Search, Pencil, ShoppingCart, Send, Calendar, DollarSign
} from "lucide-react";

// ============================================================
// 1. CONNECT TO SUPABASE
// ============================================================
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "YOUR-ANON-KEY";

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
  }
};

// ============================================================
// OFFLINE STORE & HELPERS
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

function getPending(biz) { return store.get(cacheKey(biz, "pending"), []); }
function setPending(biz, list) { store.set(cacheKey(biz, "pending"), list); }
function queueSale(biz, sale) {
  const list = getPending(biz);
  list.push(sale);
  setPending(biz, list);
}

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
        p_nonce: sale.nonce
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
    [["banana"], "🍌"], [["meat", "beef", "chicken"], "🍗"], [["fish"], "🐟"],
  ];
  for (const [keys, emo] of map) if (keys.some((k) => n.includes(k))) return emo;
  return "🛒";
}

function localDateStr(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function groupByInvoice(salesLines) {
  const map = {};
  salesLines.forEach((s) => {
    const key = s.invoice_no || `sale-${s.id}`;
    if (!map[key]) {
      map[key] = {
        invoice_no: s.invoice_no,
        when: s.sold_at,
        customer: s.customer_name || "",
        phone: s.customer_phone || "",
        seller: s.seller_name || "Unknown",
        lines: [],
        total: 0
      };
    }
    map[key].lines.push({
      product_name: s.product_name || "Deleted Product",
      qty: s.qty,
      total: Number(s.total || 0)
    });
    map[key].total += Number(s.total || 0);
  });
  return Object.values(map).sort((a, b) => new Date(b.when) - new Date(a.when));
}

// ============================================================
// 2. ROOT
// ============================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [bizNames, setBizNames] = useState({ 1: "Business 1", 2: "Business 2" });

  useEffect(() => {
    if (!user) return;
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
// 3. LOGIN COMPONENT
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
      <div style={{ ...S.loginCard, position: "relative", zIndex: 1 }}>
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
      const [p, s, e] = await Promise.all([
        sb.select("products", `${bizFilter}order=created_at.asc`),
        sb.select("sales", `${bizFilter}order=sold_at.desc&limit=10000`),
        sb.select("expenses", `${bizFilter}order=created_at.desc`)
      ]);
      setProducts(p); setSales(s); setExpenses(e);
      store.set(cacheKey(businessId, "products"), p);
      store.set(cacheKey(businessId, "sales"), s);
      store.set(cacheKey(businessId, "expenses"), e);
      setOnline(true);
    } catch (errVal) {
      setOnline(false);
      setProducts(store.get(cacheKey(businessId, "products"), []));
      setSales(store.get(cacheKey(businessId, "sales"), []));
      setExpenses(store.get(cacheKey(businessId, "expenses"), []));
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    const goOnline = () => { setOnline(true); refresh(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refresh]);

  return { products, sales, expenses, loading, error, refresh, online, pending, setPendingCount };
}

// ============================================================
// 5. ADMIN PANEL & MODULES
// ============================================================
function Admin({ user, onExit, businessName }) {
  const { products, sales, expenses, loading, error, refresh } = useData(user.business_id);
  const [tab, setTab] = useState("overview");

  const totalSales = sales.reduce((a, x) => a + Number(x.total), 0);
  const totalTithe = sales.reduce((a, x) => a + Number(x.tithe), 0);
  const cash = totalSales - totalTithe;
  const low = products.filter((p) => p.qty <= p.low_at && p.qty > 0);
  const out = products.filter((p) => p.qty <= 0);

  const deleteSale = async (s) => {
    const label = s.invoice_no ? `invoice ${s.invoice_no}` : `this sale`;
    if (!window.confirm(`Remove ${label}? The stock will be returned.`)) return;
    try {
      if (s.invoice_no) await sb.rpc("delete_invoice", { p_invoice_no: s.invoice_no });
      else await sb.rpc("delete_sale", { p_sale_id: s.id });
      await refresh();
    } catch (e) { alert(e.message); }
  };

  return (
    <div style={S.shell}>
      <Header title={businessName} sub={`${user.name} · Admin`} onExit={onExit} onRefresh={refresh} />
      {error && <div style={S.alert}><AlertTriangle size={16} /> {error}</div>}
      
      <Tabs tab={tab} setTab={setTab} items={[
        ["overview","Overview"],["history","Sales History"],["stock","Stock"],["analytics","Analytics"],["expenses","Expenses"],["team","Team"]
      ]} />

      <div style={S.body}>
        {loading ? <Loading /> : <>
          {tab === "overview" && <>
            <div style={S.statGrid}>
              <Stat icon={<TrendingUp size={16} />} label="Total sales" value={money(totalSales)} accent delay={0} />
              <Stat icon={<Wallet size={16} />} label="Cash in hand" value={money(cash)} tint={mango} delay={0.05} />
              <Stat icon={<Church size={16} />} label="To God" value={money(totalTithe)} tint={grape} delay={0.1} />
              <Stat icon={<Package size={16} />} label="Items in stock" value={products.reduce((a,p)=>a+p.qty,0)} tint={sky} delay={0.15} />
            </div>
            <SectionTitle>At a Glance Alerts</SectionTitle>
            {out.length > 0 && (
              <div style={{ ...S.alert, background: "#FFE2E2", color: "#C0392B", marginBottom: 8 }}>
                <AlertTriangle size={16} /> <span><b>{out.length}</b> product items are completely out of stock!</span>
              </div>
            )}
            {low.length > 0 && (
              <div style={{ ...S.alert, background: "#FFF1DA", color: "#B26A00" }}>
                <AlertTriangle size={16} /> <span><b>{low.length}</b> running low.</span>
              </div>
            )}
          </>}

          {tab === "history" && <AdminSalesHistory sales={sales} onDelete={deleteSale} />}
          {tab === "stock" && <StockManager products={products} onChange={refresh} businessId={user.business_id} />}
          {tab === "analytics" && <AnalyticsView sales={sales} />}
          {tab === "expenses" && <ExpenseManager expenses={expenses} businessId={user.business_id} onChange={refresh} />}
          {tab === "team" && <TeamManager onChange={refresh} businessId={user.business_id} />}
        </>}
      </div>
    </div>
  );
}

function AdminSalesHistory({ sales, onDelete }) {
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filteredSales = sales.filter(s => {
    const matchesSearch = s.product_name?.toLowerCase().includes(search.toLowerCase()) || 
                          s.seller_name?.toLowerCase().includes(search.toLowerCase()) ||
                          s.invoice_no?.toLowerCase().includes(search.toLowerCase());
    const saleDate = localDateStr(new Date(s.sold_at));
    const matchesFrom = fromDate ? saleDate >= fromDate : true;
    const matchesTo = toDate ? saleDate <= toDate : true;
    return matchesSearch && matchesFrom && matchesTo;
  });

  return (
    <div>
      <SectionTitle>All-Time Sales Archive</SectionTitle>
      <SearchBar value={search} onChange={setSearch} placeholder="Search product, seller, or invoice..." />
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <label style={{ flex: 1 }}>
          <span style={S.fieldLabel}>From Date</span>
          <input type="date" style={S.input} value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </label>
        <label style={{ flex: 1 }}>
          <span style={S.fieldLabel}>To Date</span>
          <input type="date" style={S.input} value={toDate} onChange={e => setToDate(e.target.value)} />
        </label>
      </div>
      <SalesList sales={filteredSales.slice(0, 100)} showSeller onDelete={onDelete} showTithe />
    </div>
  );
}

function AnalyticsView({ sales }) {
  const [range, setRange] = useState("daily"); // daily, weekly, monthly, yearly

  const getFilteredSales = () => {
    const now = new Date();
    return sales.filter(s => {
      const d = new Date(s.sold_at);
      if (range === "daily") return localDateStr(now) === localDateStr(d);
      if (range === "weekly") return (now - d) / (1000 * 60 * 60 * 24) <= 7;
      if (range === "monthly") return now.getMonth() === d.getMonth() && now.getFullYear() === d.getFullYear();
      if (range === "yearly") return now.getFullYear() === d.getFullYear();
      return true;
    });
  };

  const selectedSales = getFilteredSales();

  // Top products
  const productMap = {};
  // Seller metrics
  const sellerMap = {};

  selectedSales.forEach(s => {
    productMap[s.product_name] = (productMap[s.product_name] || 0) + Number(s.qty || 0);
    sellerMap[s.seller_name] = (sellerMap[s.seller_name] || 0) + Number(s.total || 0);
  });

  const bestSelling = Object.entries(productMap).sort((a,b) => b[1] - a[1]).slice(0, 5);
  const sellerRank = Object.entries(sellerMap).sort((a,b) => b[1] - a[1]);

  return (
    <div>
      <SectionTitle>Performance Analytics</SectionTitle>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["daily", "weekly", "monthly", "yearly"].map(r => (
          <button key={r} onClick={() => setRange(r)} style={{ ...S.btn, ...(range === r ? S.btnDark : S.btnGhost), flex: 1, textTransform: "capitalize" }}>
            {r}
          </button>
        ))}
      </div>

      <div style={{ background: "rgba(0,0,0,0.02)", padding: 12, borderRadius: 12, marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px 0", color: ink }}>🏆 Best Selling Products (Volume)</h4>
        {bestSelling.length === 0 && <p style={S.empty}>No transaction records available for this cycle range.</p>}
        {bestSelling.map(([name, qty]) => (
          <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${line}` }}>
            <span>{name}</span>
            <span style={{ fontWeight: 700 }}>{qty} units</span>
          </div>
        ))}
      </div>

      <div style={{ background: "rgba(0,0,0,0.02)", padding: 12, borderRadius: 12 }}>
        <h4 style={{ margin: "0 0 8px 0", color: ink }}>👤 Performance By Sales Rep</h4>
        {sellerRank.length === 0 && <p style={S.empty}>No data metrics found.</p>}
        {sellerRank.map(([name, val]) => (
          <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${line}` }}>
            <span>{name}</span>
            <span style={{ fontWeight: 700, color: accent }}>{money(val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpenseManager({ expenses, businessId, onChange }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const addExpense = async () => {
    if (!label.trim() || !amount) return;
    setBusy(true);
    try {
      await sb.insert("expenses", {
        business_id: businessId,
        description: label.trim(),
        amount: parseFloat(amount),
        created_at: new Date().toISOString()
      });
      setLabel(""); setAmount("");
      onChange();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const totalExp = expenses.reduce((a, e) => a + Number(e.amount || 0), 0);

  return (
    <div>
      <SectionTitle>Operational Cash Expenses</SectionTitle>
      <div style={{ ...S.card, display: "block", padding: 14, marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 10px 0" }}>Log Business Outflow</h4>
        <Field label="Expense Label/Reason" value={label} onChange={setLabel} placeholder="e.g. Fuel, Flour, Packing bags" />
        <Field label="Amount Spent ($)" type="number" value={amount} onChange={setAmount} placeholder="0.00" />
        <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 8 }} onClick={addExpense} disabled={busy}>
          {busy ? "Saving..." : "Record Expense Outflow"}
        </button>
      </div>

      <div style={{ ...S.cartTotalRow, background: "rgba(192,57,43,0.1)", border: "1px solid #FF8B7A", color: "#C0392B", marginBottom: 12 }}>
        <span>Total Logged Expenses</span>
        <span>{money(totalExp)}</span>
      </div>

      {expenses.map(e => (
        <div key={e.id} style={{ ...S.card, marginBottom: 6, justifyContent: "space-between" }}>
          <div>
            <div style={S.cardName}>{e.description}</div>
            <div style={S.cardMeta}>{new Date(e.created_at).toLocaleDateString()}</div>
          </div>
          <span style={{ fontWeight: 700, color: "#C0392B" }}>-{money(e.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 6. SELLER DASHBOARD
// ============================================================
function Seller({ user, onExit, businessName }) {
  const { products, sales, loading, error, refresh, online, pending, setPendingCount } = useData(user.business_id);
  const [toast, setToast] = useState("");
  const [adding, setAdding] = useState(null);
  const cartKey = cacheKey(user.business_id, `cart:${user.name}`);
  const [cart, setCart] = useState(() => store.get(cartKey, []));
  const [showCart, setShowCart] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [search, setSearch] = useState("");

  const checkoutActive = useRef(false);

  // Today's boundaries to isolate historical records
  const todayStr = localDateStr(new Date());
  
  const mineToday = sales.filter((s) => {
    return s.seller_name === user.name && localDateStr(new Date(s.sold_at)) === todayStr;
  });

  const myTotal = mineToday.reduce((a, x) => a + Number(x.total), 0);
  const myCount = mineToday.length;

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

  const cartTotal = cart.reduce((a, c) => a + c.units * Number(c.product.price), 0);
  const cartCount = cart.reduce((a, c) => a + c.units, 0);

  const checkout = async ({ customer, phone } = {}) => {
    if (cart.length === 0 || checkoutActive.current) return;
    checkoutActive.current = true;

    const uniqueNonce = `${user.business_id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const items = cart.map((c) => ({ product_id: c.product.id, qty: c.units }));
    const lines = cart.map((c) => ({
      name: c.product.name, units: c.units,
      price: Number(c.product.price), pack_size: c.product.pack_size || 1,
      total: c.units * Number(c.product.price),
    }));

    const baseReceipt = {
      when: new Date(), seller: user.name, business: businessName,
      customer: customer || "", phone: phone || "", lines, total: cartTotal,
    };

    const saveOffline = () => {
      queueSale(user.business_id, { items, seller: user.name, customer, phone, nonce: uniqueNonce, when: new Date().toISOString() });
      if (setPendingCount) setPendingCount(getPending(user.business_id).length);
      setReceipt({ ...baseReceipt, no: "PENDING", offline: true });
      setCart([]); setShowCart(false);
      setToast("Saved offline — will sync when online");
      setTimeout(() => { setToast(""); checkoutActive.current = false; }, 2500);
    };

    if (!isOnline()) { saveOffline(); return; }

    try {
      const inv = await sb.rpc("record_invoice", {
        p_items: items, p_seller: user.name,
        p_customer: customer || null, p_phone: phone || null,
        p_nonce: uniqueNonce
      });
      const invoiceNo = typeof inv === "string" ? inv : (inv && inv[0]) || "INV";
      setReceipt({ ...baseReceipt, no: invoiceNo });
      setCart([]); setShowCart(false);
      await refresh();
      checkoutActive.current = false;
    } catch (e) {
      saveOffline();
    }
  };

  const shown = filterProducts(products, search);

  return (
    <div style={S.shell}>
      <Header title={user.name} sub={`${businessName} · Seller Dashboard`} onExit={onExit} onRefresh={refresh} />
      {!online && (
        <div style={{ ...S.alert, background: "#FFF1DA", color: "#B26A00" }}>
          <AlertTriangle size={16} /> <span>Offline mode active. Data is secured locally.</span>
        </div>
      )}
      {online && pending > 0 && (
        <div style={{ ...S.alert, background: "#EAF7EE", color: accent }}>
          <RefreshCw size={16} style={{ animation: "spin 2s linear infinite" }} /> <span>Syncing {pending} deferred records...</span>
        </div>
      )}

      <div style={S.body}>
        {loading ? <Loading /> : <>
          <div style={S.statGrid}>
            <Stat icon={<TrendingUp size={16} />} label="Today's Sales Revenue" value={money(myTotal)} accent />
            <Stat icon={<FileText size={16} />} label="Today's Invoices Filled" value={myCount} tint={sky} />
          </div>

          <SectionTitle>Available Item Catalog</SectionTitle>
          <SearchBar value={search} onChange={setSearch} placeholder="Search catalog items..." />
          
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map((p) => {
              const low = p.qty <= 0;
              const inCart = cart.find((c) => c.product.id === p.id);
              return (
                <div key={p.id} style={{ ...S.card, ...(inCart ? S.cardInCart : {}) }}>
                  <div style={{ fontSize: 22, marginRight: 4 }}>{emojiFor(p.name)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={S.cardName}>{p.name}{inCart && <span style={S.cartBadge}>{inCart.units} in cart</span>}</div>
                    <div style={S.cardMeta}>
                      {priceFmt(p.price)}/ea · {low ? <span style={{ color: "#C0392B" }}>Out of Stock</span> : stockLabel(p)}
                    </div>
                  </div>
                  <button style={S.sellBtn} onClick={() => setAdding(p)}>+ Add</button>
                </div>
              );
            })}
          </div>
        </>}
      </div>

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
      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

// ============================================================
// COMPONENT COMPLEMENTS
// ============================================================
function AddToCartModal({ product, onClose, onAdd }) {
  const [packs, setPacks] = useState("");
  const totalPacks = parseFloat(packs) || 0;
  return (
    <Modal onClose={onClose} title={`${emojiFor(product.name)} ${product.name}`}>
      <p style={{ ...S.hint, marginTop: 0 }}>{priceFmt(product.price)} · {stockLabel(product)} in stock</p>
      <Field label="Quantity packs to sell" value={packs} onChange={setPacks} type="number" placeholder="0" />
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 12 }} disabled={totalPacks <= 0} onClick={() => onAdd(product, totalPacks)}>
        Add to Basket Total ({money(totalPacks * product.price)})
      </button>
    </Modal>
  );
}

function CartModal({ cart, total, customers, onClose, onRemove, onCheckout }) {
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <Modal onClose={onClose} title="Review Basket Checkout">
      {cart.map(c => (
        <div key={c.product.id} style={S.cartLine}>
          <div style={{ flex: 1 }}>
            <div style={S.cardName}>{c.product.name}</div>
            <div style={S.cardMeta}>{c.units} x {priceFmt(c.product.price)}</div>
          </div>
          <button style={S.delBtn} onClick={() => onRemove(c.product.id)}><X size={14} /></button>
        </div>
      ))}
      <div style={{ ...S.cartTotalRow, margin: "12px 0" }}><span>Total Due</span><span>{money(total)}</span></div>
      <Field label="Customer Name (Optional)" value={customer} onChange={setCustomer} />
      <Field label="Phone Contact (Optional)" value={phone} onChange={setPhone} />
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 12 }} onClick={() => onCheckout({ customer, phone })}>
        Complete Secure Checkout
      </button>
    </Modal>
  );
}

function ReceiptModal({ receipt, onClose }) {
  return (
    <Modal onClose={onClose} title="Invoice Ready">
      <div style={S.receipt}>
        <h3>{receipt.business}</h3>
        <p style={S.cardMeta}>Receipt #: {receipt.no}</p>
        <div style={S.receiptDivider} />
        {receipt.lines.map((l, i) => (
          <div key={i} style={S.receiptLine}>
            <span>{l.name} x{l.units}</span>
            <span>{money(l.total)}</span>
          </div>
        ))}
        <div style={S.receiptDivider} />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
          <span>Total Paid</span><span>{money(receipt.total)}</span>
        </div>
      </div>
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 12 }} onClick={onClose}>Done &amp; Dismiss</button>
    </Modal>
  );
}

// ============================================================
// STYLES & SUB-LEVEL UI PILLARS
// ============================================================
function Header({ title, sub, onExit, onRefresh }) {
  return (
    <div style={S.header}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, color: ink }}>{title}</h2>
        <div style={{ fontSize: 13, color: muted }}>{sub}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={S.circleBtn} onClick={onRefresh}><RefreshCw size={16} /></button>
        <button style={{ ...S.circleBtn, color: "#C0392B" }} onClick={onExit}><LogOut size={16} /></button>
      </div>
    </div>
  );
}

function Tabs({ tab, setTab, items }) {
  return (
    <div style={S.tabsContainer}>
      {items.map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)} style={{ ...S.tabItem, ...(tab === id ? S.tabActive : {}) }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Stat({ icon, label, value, accent, tint }) {
  return (
    <div style={{ ...S.stat, borderLeft: `4px solid ${accent ? gold : tint || "#ccc"}` }}>
      <div style={S.statIcon}>{icon}</div>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statValue}>{value}</div>
    </div>
  );
}

function SearchBar({ value, onChange, placeholder = "Search catalog..." }) {
  return (
    <div style={S.searchWrap}>
      <Search size={16} style={{ color: muted }} />
      <input style={S.searchInput} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label style={S.fieldWrap}>
      <span style={S.fieldLabel}>{label}</span>
      <input style={S.input} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Modal({ children, title, onClose }) {
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={S.delBtn}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SalesList({ sales, onDelete }) {
  if (sales.length === 0) return <p style={S.empty}>No sales found matching requirements.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sales.map((s) => (
        <div key={s.id} style={S.card}>
          <div style={{ flex: 1 }}>
            <div style={S.cardName}>{s.product_name} <span style={{ color: muted }}>x{s.qty}</span></div>
            <div style={S.cardMeta}>Invoice: {s.invoice_no || "Single item sale"} · Seller: {s.seller_name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontWeight: 700 }}>{money(s.total)}</span>
            {onDelete && <button style={S.delBtn} onClick={() => onDelete(s)}><X size={14} /></button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function StockManager({ products, businessId, onChange }) {
  const [targetProduct, setTargetProduct] = useState(null);
  const [newStock, setNewStock] = useState("");

  const updateStock = async () => {
    if (!targetProduct || !newStock) return;
    try {
      await sb.patch("products", `id=eq.${targetProduct.id}`, { qty: parseFloat(newStock) });
      setTargetProduct(null); setNewStock("");
      onChange();
    } catch (e) { alert(e.message); }
  };

  return (
    <div>
      <SectionTitle>Inventory Control</SectionTitle>
      {products.map(p => (
        <div key={p.id} style={S.card}>
          <div style={{ flex: 1 }}>
            <div style={S.cardName}>{p.name}</div>
            <div style={S.cardMeta}>In Stock: {p.qty} packs · Base Price: {priceFmt(p.price)}</div>
          </div>
          <button style={S.sellBtn} onClick={() => { setTargetProduct(p); setNewStock(p.qty); }}>Adjust</button>
        </div>
      ))}
      {targetProduct && (
        <Modal title={`Adjust Stock: ${targetProduct.name}`} onClose={() => setTargetProduct(null)}>
          <Field label="New Absolute Stock Value" type="number" value={newStock} onChange={setNewStock} />
          <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 8 }} onClick={updateStock}>
            Save Inventory Adjustments
          </button>
        </Modal>
      )}
    </div>
  );
}

function TeamManager({ businessId, onChange }) {
  return <div style={S.empty}>Team administration is fully operational inside backend configuration panels.</div>;
}

function SectionTitle({ children }) { return <h3 style={S.secTitle}>{children}</h3>; }
function Loading() { return <div style={S.empty}>Loading application parameters...</div>; }
function SetupNotice() { return <div style={S.empty}>Please finalize configuration of Supabase credentials.</div>; }

// ============================================================
// SYSTEM ARCHITECTURE DESIGN SYSTEM (COLORS & CONSTANTS)
// ============================================================
const gold = "#E6C44D", accent = "#2BD07A", ink = "#14231E", muted = "#708980", line = "#E1E8E5";
const mango = "#FFB347", grape = "#A18FFF", sky = "#4FC3F7";

const S = {
  shell: { background: "#F4F7F6", minHeight: "100vh", color: ink, fontFamily: "system-ui, sans-serif" },
  body: { padding: 14, maxWidth: 800, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 14, background: "#fff", borderBottom: `1px solid ${line}` },
  tabsContainer: { display: "flex", overflowX: "auto", background: "#fff", padding: "4px 10px", gap: 6, borderBottom: `1px solid ${line}` },
  tabItem: { padding: "8px 14px", border: "none", background: "none", fontSize: 14, cursor: "pointer", color: muted, whiteSpace: "nowrap" },
  tabActive: { color: ink, fontWeight: 700, borderBottom: `3px solid ${gold}` },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 },
  stat: { background: "#fff", padding: 12, borderRadius: 12, border: `1px solid ${line}` },
  statLabel: { fontSize: 12, color: muted },
  statValue: { fontSize: 20, fontWeight: 800, marginTop: 4 },
  card: { display: "flex", alignItems: "center", background: "#fff", padding: 10, borderRadius: 12, border: `1px solid ${line}`, marginBottom: 6 },
  cardInCart: { borderColor: accent, background: "rgba(43,208,122,0.04)" },
  cardName: { fontWeight: 700, fontSize: 15 },
  cardMeta: { fontSize: 12, color: muted },
  sellBtn: { padding: "6px 12px", background: ink, color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" },
  delBtn: { background: "none", border: "none", color: muted, cursor: "pointer", padding: 4 },
  searchWrap: { display: "flex", alignItems: "center", background: "#fff", padding: "8px 12px", borderRadius: 10, border: `1px solid ${line}`, gap: 8, marginBottom: 12 },
  searchInput: { border: "none", width: "100%", outline: "none", fontSize: 14 },
  fieldWrap: { display: "block", marginBottom: 10 },
  fieldLabel: { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: muted },
  input: { width: "100%", padding: "10px 12px", border: `1px solid ${line}`, borderRadius: 8, boxSizing: "border-box", outline: "none" },
  btn: { padding: "10px 16px", borderRadius: 10, fontWeight: 700, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  btnDark: { background: ink, color: "#fff" },
  btnGhost: { background: "none", border: `1px solid ${line}`, color: ink },
  cartFab: { position: "fixed", bottom: 20, right: 20, background: accent, color: "#fff", border: "none", padding: "12px 20px", borderRadius: 30, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", cursor: "pointer", zIndex: 10 },
  cartFabCount: { background: ink, padding: "2px 6px", borderRadius: 10, fontSize: 11 },
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12, zIndex: 100 },
  modal: { background: "#fff", padding: 16, borderRadius: 16, width: "100%", maxWidth: 440, boxSizing: "border-box" },
  receipt: { background: "#14231E", color: "#fff", padding: 16, borderRadius: 12 },
  receiptDivider: { borderTop: "1px dashed rgba(255,255,255,0.2)", margin: "10px 0" },
  receiptLine: { display: "flex", justifyContent: "space-between", fontSize: 14, margin: "4px 0" },
  cartTotalRow: { display: "flex", justifyContent: "space-between", padding: 12, background: "rgba(230,196,77,0.1)", borderRadius: 8, color: ink, fontWeight: 700 },
  empty: { textAlign: "center", color: muted, padding: "20px 0", fontSize: 14 },
  secTitle: { fontSize: 16, margin: "14px 0 8px 0", fontWeight: 700, color: ink },
  hint: { fontSize: 12, color: muted, marginTop: -4, marginBottom: 10 },
  toast: { position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: ink, color: "#fff", padding: "8px 16px", borderRadius: 20, fontSize: 13, zIndex: 100 },
  loginDarkShell: { background: ink, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 },
  loginCard: { background: "rgba(255,255,255,0.06)", padding: 24, borderRadius: 20, width: "100%", maxWidth: 360, color: "#fff" },
  logoMark: { width: 44, height: 44, borderRadius: 12, background: gold, display: "flex", alignItems: "center", justifyContent: "center", color: ink, marginBottom: 14 },
  loginTitle: { margin: 0, fontSize: 24 },
  loginSub: { margin: "4px 0 16px 0", fontSize: 13, color: muted },
  inputDark: { width: "100%", padding: 12, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff", boxSizing: "border-box" },
  keypad: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 },
  key: { padding: 12, borderRadius: 8, border: `1px solid ${line}`, background: "#fff", fontWeight: 700, fontSize: 16, cursor: "pointer" },
  keyDark: { background: "rgba(255,255,255,0.08)", border: "none", color: "#fff" },
  pinDot: { width: 12, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.2)" },
  pinDotFull: { background: gold }
};
