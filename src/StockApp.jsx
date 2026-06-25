import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, TrendingUp, Users, AlertTriangle, Plus, Minus, LogOut,
  Church, Wallet, FileText, ChevronRight, Box, X, Check, Delete, RefreshCw, Search, Pencil, ShoppingCart, Send
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
  if (!q) return products;
  return products.filter((p) => p.name.toLowerCase().includes(q));
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
    <div style={{ ...S.shell, overflow: "hidden" }}>
      <MarketWatermark />
      <div style={{ ...S.loginCard, position: "relative", zIndex: 1 }}>
        <HeroImage />
        <div style={S.logoMark}><Box size={26} strokeWidth={2.4} /></div>
        <h1 style={S.loginTitle}>Pamusika</h1>
        <p style={S.loginSub}>Enter your name and PIN to sign in.</p>

        <Field label="Name" value={name} onChange={setName} placeholder="e.g. Mum" />
        <div style={S.fieldWrap}>
          <span style={S.fieldLabel}>PIN</span>
          <PinDots value={pin} />
        </div>
        <Keypad value={pin} onChange={setPin} />

        {err && <p style={S.errTxt}>{err}</p>}
        <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 10 }}
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

function Keypad({ value, onChange }) {
  const press = (k) => {
    if (k === "del") onChange(value.slice(0, -1));
    else if (value.length < 4) onChange(value + k);
  };
  return (
    <div style={S.keypad}>
      {["1","2","3","4","5","6","7","8","9","","0","del"].map((k, i) =>
        k === "" ? <div key={i} /> :
        <button key={i} style={S.key} onClick={() => press(k)}>
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
        sb.select("sales", `${bizFilter}order=sold_at.desc&limit=200`),
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

  const totalSales = sales.reduce((a, x) => a + Number(x.total), 0);
  const totalTithe = sales.reduce((a, x) => a + Number(x.tithe), 0);
  const cash = totalSales - totalTithe;
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
        ["overview","Overview"],["stock","Stock"],["transactions","Invoices"],["customers","Customers"],["cashups","Cash-ups"],["report","Tuesday report"],["team","Team"],
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
            <SectionTitle>Recent sales</SectionTitle>
            <p style={S.hint}>Tap the ✕ to remove a sale — its stock is returned automatically.</p>
            <SalesList sales={sales.slice(0,20)} showSeller onDelete={deleteSale} showTithe />
          </>}
          {tab === "stock" && <StockManager products={products} onChange={refresh} businessId={user.business_id} />}
          {tab === "transactions" && <Transactions sales={sales} products={products} businessId={user.business_id} onChange={refresh} onDeleteSale={deleteSale} />}
          {tab === "customers" && <Customers sales={sales} />}
          {tab === "cashups" && <CashUps businessId={user.business_id} />}
          {tab === "report" && <Report sales={sales} totalSales={totalSales} totalTithe={totalTithe} cash={cash} low={[...out, ...low]} />}
          {tab === "team" && <TeamManager onChange={refresh} businessId={user.business_id} />}
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
  const [cart, setCart] = useState([]);          // [{product, units}]
  const [showCart, setShowCart] = useState(false);
  const [receipt, setReceipt] = useState(null);  // completed invoice for sharing
  const [closingDay, setClosingDay] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const [search, setSearch] = useState("");
  const mine = sales.filter((s) => s.seller_name === user.name);
  const myTotal = mine.reduce((a, x) => a + Number(x.total), 0);

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

  const cartTotal = cart.reduce((a, c) => a + c.units * Number(c.product.price), 0);
  const cartCount = cart.reduce((a, c) => a + c.units, 0);

  const checkout = async ({ customer, phone } = {}) => {
    if (cart.length === 0) return;
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
            <Stat icon={<TrendingUp size={16} />} label="My sales total" value={money(myTotal)} accent />
            <button onClick={() => setShowTx(true)}
              style={{ ...S.stat, textAlign: "left", cursor: "pointer", border: `1px solid ${line}`, position: "relative" }}>
              <div style={S.statIcon}><FileText size={16} /></div>
              <div style={S.statLabel}>My transactions</div>
              <div style={S.statValue}>{mine.length}</div>
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
          <SellerInvoices sales={mine} businessName={businessName} sellerName={user.name}
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
          onSubmitted={() => { setClosingDay(false); setToast("Day report sent to admin"); setTimeout(() => setToast(""), 2200); }} />
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
  const go = async () => { setBusy(true); await onCheckout({ customer: customer.trim(), phone: phone.trim() }); setBusy(false); };

  const recNum = parseFloat(received);
  const hasReceived = received !== "" && !isNaN(recNum);
  const change = hasReceived ? recNum - total : 0;
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
        <span>Total</span>
        <span>{money(total)}</span>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <label style={S.fieldWrap}>
            <span style={S.fieldLabel}>Customer name</span>
            <input style={S.input} value={customer} placeholder="e.g. Mai Moyo"
              onChange={(e) => { setCustomer(e.target.value); setShowSug(true); }}
              onFocus={() => setShowSug(true)} />
          </label>
          {showSug && suggestions.length > 0 && (
            <div style={S.sugBox}>
              {suggestions.map((c) => (
                <button key={c.name} style={S.sugItem} onClick={() => pick(c)}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.phone && <span style={{ color: "#8A8475", fontSize: 12 }}>{c.phone}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="Phone" value={phone} onChange={setPhone} type="tel" placeholder="077…" />
      </div>
      <Field label="Amount received from customer ($)" value={received} onChange={setReceived} type="number" placeholder="0.00" />
      {hasReceived && (
        <div style={{ ...S.cartTotalRow, background: shortfall ? "#FFE2E2" : "#EAF7EE", color: shortfall ? "#C0392B" : accent }}>
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
    // Open the phone's default SMS app, addressed to the customer, with the receipt prefilled
    const body = encodeURIComponent(text);
    window.location.href = `sms:${cleanPhone}?body=${body}`;
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `Receipt ${receipt.no}`, text });
      else { await navigator.clipboard.writeText(text); alert("Receipt copied — you can paste it into WhatsApp or SMS."); }
    } catch {}
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
            <span style={{ flex: 1 }}>{l.name} <span style={{ color: "#8A8475" }}>×{l.units}</span></span>
            <span style={{ fontWeight: 700 }}>{money(l.total)}</span>
          </div>
        ))}
        <div style={S.receiptDivider} />
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
      <button style={{ ...S.btn, ...(cleanPhone ? S.btnGhost : S.btnDark), width: "100%", marginTop: 8 }} onClick={share}>
        <Send size={17} /> Share receipt another way
      </button>
      <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginTop: 8 }} onClick={onClose}>Done</button>
    </Modal>
  );
}

function receiptText(r) {
  const lines = r.lines.map((l) => `${l.name} x${l.units}  ${money(l.total)}`).join("\n");
  const cust = r.customer ? `\nCustomer: ${r.customer}${r.phone ? ` (${r.phone})` : ""}` : "";
  return `${r.business}\nReceipt ${r.no}\n${r.when.toLocaleString()}${cust}\n\n${lines}\n\nTOTAL: ${money(r.total)}\nServed by ${r.seller}\nThank you!`;
}

// Seller's own invoices — tappable, opens the receipt to review
function SellerInvoices({ sales, businessName, sellerName, products, businessId, online }) {
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

  // Synced invoices (from server/cache)
  let invoices = groupByInvoice(sales);

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
        <Search size={16} style={{ color: "#8A8475", flexShrink: 0 }} />
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

  const dayInvoices = groupByInvoice(sales.filter((s) => localDateStr(new Date(s.sold_at)) === day));
  const salesTotal = dayInvoices.reduce((a, inv) => a + inv.total, 0);
  const cashNum = parseFloat(cash);
  const hasCash = cash !== "" && !isNaN(cashNum);
  const diff = hasCash ? cashNum - salesTotal : 0;

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
      <div style={S.cartTotalRow}>
        <span>Sales total ({dayInvoices.length} sale{dayInvoices.length === 1 ? "" : "s"})</span>
        <span>{money(salesTotal)}</span>
      </div>

      <Field label="Actual cash in hand ($)" value={cash} onChange={setCash} type="number" placeholder="0.00" />
      {hasCash && (
        <div style={{ ...S.cartTotalRow, background: diff === 0 ? "#EAF7EE" : Math.abs(diff) < 0.005 ? "#EAF7EE" : "#FFF1DA", color: diff < -0.005 ? "#C0392B" : accent }}>
          <span>{diff < -0.005 ? "Short by" : diff > 0.005 ? "Over by" : "Matches exactly"}</span>
          <span>{diff === 0 ? "✓" : money(Math.abs(diff))}</span>
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
    </Modal>
  );
}

function localDateStr(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// ============================================================
// 7. STOCK MANAGER (admin)
// ============================================================
function StockManager({ products, onChange, businessId }) {
  const [open, setOpen] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [editing, setEditing] = useState(null); // product being edited
  const [search, setSearch] = useState("");
  const [f, setF] = useState({ name: "", price: "", pct: "", packs: "", units: "", pack_size: "1", low: "5" });
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);

  const otherBusiness = businessId === 1 ? 2 : 1;

  const add = async () => {
    if (!f.name.trim() || f.price === "") return;
    setBusy(true);
    try {
      await sb.insert("products", {
        name: f.name.trim(), price: parseFloat(f.price) || 0,
        tithe_pct: parseFloat(f.pct) || 0, qty: parseFloat(f.packs) || 0,
        pack_size: parseInt(f.pack_size) || 1, low_at: parseInt(f.low) || 5, business_id: businessId,
      });
      setF({ name: "", price: "", pct: "", packs: "", units: "", pack_size: "1", low: "5" });
      setOpen(false); await onChange();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const copyToOther = async () => {
    if (products.length === 0) return;
    if (!window.confirm(`Copy all ${products.length} products to Business ${otherBusiness}? This copies names, prices, percentages and pack sizes — NOT stock quantities (they start at 0). Existing products there are not removed.`)) return;
    setCopying(true);
    try {
      const rows = products.map((p) => ({
        name: p.name, price: p.price, tithe_pct: p.tithe_pct,
        qty: 0, pack_size: p.pack_size || 1, low_at: p.low_at,
        business_id: otherBusiness,
      }));
      await sb.insert("products", rows);
      alert(`Copied ${rows.length} products to Business ${otherBusiness}. Sign in there to set their stock.`);
    } catch (e) { alert(e.message); }
    setCopying(false);
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
  const remove = async (id) => {
    await sb.del("products", `id=eq.${id}`);
    await onChange();
  };

  const shown = filterProducts(products, search);

  return (
    <>
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginBottom: 10 }} onClick={() => setOpen(true)}>
        <Plus size={18} /> Add new product
      </button>
      <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 10 }} onClick={() => setBulk(true)}>
        <FileText size={17} /> Bulk add from a list
      </button>
      {products.length > 0 && (
        <button style={{ ...S.btn, ...S.btnGhost, width: "100%", marginBottom: 14 }} disabled={copying} onClick={copyToOther}>
          {copying ? "Copying…" : `Copy these products to Business ${otherBusiness}`}
        </button>
      )}
      {products.length > 0 && <SearchBar value={search} onChange={setSearch} />}
      {products.length === 0 && <p style={S.empty}>No products yet. Add your first item above.</p>}
      {products.length > 0 && shown.length === 0 && <p style={S.empty}>No products match “{search}”.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map((p) => {
          const ps = p.pack_size || 1;
          return (
            <div key={p.id} style={S.card}>
              <div style={{ flex: 1 }}>
                <div style={S.cardName}>{p.name} {p.qty <= 0 ? <span style={S.outTag}>out — restock</span> : p.qty <= p.low_at ? <span style={S.lowTag}>low</span> : null}</div>
                <div style={S.cardMeta}>{priceFmt(p.price)}/pack · {p.tithe_pct}% to God{ps > 1 ? ` · pack of ${ps}` : ""}</div>
                <div style={{ ...S.cardMeta, color: p.qty <= 0 ? "#C0392B" : "#1F9D55", fontWeight: 600 }}>{p.qty <= 0 ? `${p.qty} packs — out of stock` : stockLabel(p)}</div>
              </div>
              <div style={S.qtyCtrl}>
                <button style={S.qtyBtn} onClick={() => restock(p, -1)}><Minus size={14} /></button>
                <span style={S.qtyNum}>{p.qty}</span>
                <button style={S.qtyBtn} onClick={() => restock(p, 1)}><Plus size={14} /></button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button style={S.editBtn} onClick={() => setEditing(p)}><Pencil size={15} /></button>
                <button style={S.delBtn} onClick={() => remove(p.id)}><X size={16} /></button>
              </div>
            </div>
          );
        })}
      </div>
      {open && (
        <Modal onClose={() => setOpen(false)} title="New product">
          <Field label="Product name" value={f.name} onChange={(v)=>setF({...f,name:v})} placeholder="e.g. Maputi snack" />
          <Field label="Selling price per pack ($)" value={f.price} onChange={(v)=>setF({...f,price:v})} type="number" placeholder="9.50" />
          <Field label="Items in a pack (label only, e.g. 20)" value={f.pack_size} onChange={(v)=>setF({...f,pack_size:v})} type="number" placeholder="20" />
          <Field label="Percentage to God (%)" value={f.pct} onChange={(v)=>setF({...f,pct:v})} type="number" placeholder="10" />
          <Field label="Opening stock (packs)" value={f.packs} onChange={(v)=>setF({...f,packs:v})} type="number" placeholder="0" />
          <Field label="Warn me when packs drop to" value={f.low} onChange={(v)=>setF({...f,low:v})} type="number" placeholder="5" />
          <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 8 }} disabled={busy} onClick={add}>
            <Check size={18} /> {busy ? "Saving…" : "Save product"}
          </button>
        </Modal>
      )}
      {editing && <EditProductModal product={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
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
function EditProductModal({ product, onClose, onSave }) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [pct, setPct] = useState(String(product.tithe_pct));
  const [packSize, setPackSize] = useState(String(product.pack_size || 1));
  const [low, setLow] = useState(String(product.low_at));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await onSave(product.id, {
      name: name.trim(),
      price: parseFloat(price) || 0,
      tithe_pct: parseFloat(pct) || 0,
      pack_size: parseInt(packSize) || 1,
      low_at: parseInt(low) || 5,
    });
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Edit product">
      <Field label="Product name" value={name} onChange={setName} />
      <Field label="Selling price per pack ($)" value={price} onChange={setPrice} type="number" />
      <Field label="Percentage to God (%)" value={pct} onChange={setPct} type="number" />
      <Field label="Items in a pack (label only)" value={packSize} onChange={setPackSize} type="number" />
      <Field label="Warn me when units drop to" value={low} onChange={setLow} type="number" />
      <p style={{ ...S.hint, marginBottom: 4 }}>To change quantity, use the + / − buttons on the stock list.</p>
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 4 }} disabled={busy} onClick={save}>
        <Check size={18} /> {busy ? "Saving…" : "Save changes"}
      </button>
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

function Transactions({ sales, products, businessId, onChange, onDeleteSale }) {
  const [nameQ, setNameQ] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [fromQ, setFromQ] = useState("");
  const [toQ, setToQ] = useState("");
  const [editing, setEditing] = useState(null);

  const inRange = (when) => {
    const d = localDateStr(new Date(when));
    if (fromQ && d < fromQ) return false;
    if (toQ && d > toQ) return false;
    return true;
  };

  // Product summary: total units + total $ for the product search, over the date range
  let prodSummary = null;
  if (prodQ.trim()) {
    const q = prodQ.trim().toLowerCase();
    const matched = sales.filter((s) => (s.product_name || "").toLowerCase().includes(q) && inRange(s.sold_at));
    const units = matched.reduce((a, s) => a + Number(s.qty), 0);
    const total = matched.reduce((a, s) => a + Number(s.total), 0);
    prodSummary = { units, total, count: matched.length };
  }

  let invoices = groupByInvoice(sales);
  if (nameQ.trim()) {
    const q = nameQ.trim().toLowerCase();
    invoices = invoices.filter((inv) => (inv.customer || "").toLowerCase().includes(q));
  }
  if (prodQ.trim()) {
    const q = prodQ.trim().toLowerCase();
    invoices = invoices.filter((inv) => inv.lines.some((l) => (l.product_name || "").toLowerCase().includes(q)));
  }
  invoices = invoices.filter((inv) => inRange(inv.when));

  return (
    <>
      <SectionTitle>Find an invoice</SectionTitle>
      <div style={S.searchWrap}>
        <Search size={16} style={{ color: "#8A8475", flexShrink: 0 }} />
        <input style={S.searchInput} value={nameQ} placeholder="Search customer name…" onChange={(e) => setNameQ(e.target.value)} />
        {nameQ && <button style={S.searchClear} onClick={() => setNameQ("")}><X size={15} /></button>}
      </div>
      <div style={S.searchWrap}>
        <Search size={16} style={{ color: "#8A8475", flexShrink: 0 }} />
        <input style={S.searchInput} value={prodQ} placeholder="Search product (e.g. Cascade)…" onChange={(e) => setProdQ(e.target.value)} />
        {prodQ && <button style={S.searchClear} onClick={() => setProdQ("")}><X size={15} /></button>}
      </div>
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
          <div key={inv.key} style={S.card}>
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
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {inv.invoice_no
                ? <button style={S.editBtn} onClick={() => setEditing(inv)}><Pencil size={15} /></button>
                : null}
              <button style={S.delBtn} onClick={() => onDeleteSale(inv.lines[0])}><X size={16} /></button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditInvoiceModal invoice={editing} products={products}
          onClose={() => setEditing(null)} onChange={onChange} />
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
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
function CashUps({ businessId }) {
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
    if (!window.confirm("Delete this cash-up report? This cannot be undone.")) return;
    await sb.del("day_reports", `id=eq.${id}`);
    await load();
  };
  const saveEdit = async (id, fields) => {
    await sb.patch("day_reports", `id=eq.${id}`, fields);
    setEditing(null);
    await load();
  };

  if (loading) return <Loading />;

  return (
    <>
      <SectionTitle>Day-end cash-ups</SectionTitle>
      {reports.length === 0 && <p style={S.empty}>No cash-ups submitted yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {reports.map((r) => {
          const diff = Number(r.cash_in_hand) - Number(r.sales_total);
          const short = diff < -0.005, over = diff > 0.005;
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
                <button style={S.delBtn} onClick={() => remove(r.id)}><X size={16} /></button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...S.miniStat }}><div style={S.miniLabel}>Sales</div><div style={S.miniVal}>{money(r.sales_total)}</div></div>
                <div style={{ ...S.miniStat }}><div style={S.miniLabel}>Cash</div><div style={S.miniVal}>{money(r.cash_in_hand)}</div></div>
                <div style={{ ...S.miniStat, background: short ? "#FFE2E2" : over ? "#FFF1DA" : "#EAF7EE" }}>
                  <div style={S.miniLabel}>{short ? "Short" : over ? "Over" : "Match"}</div>
                  <div style={{ ...S.miniVal, color: short ? "#C0392B" : accent }}>{diff === 0 ? "✓" : money(Math.abs(diff))}</div>
                </div>
              </div>
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
      {editing && <EditCashUpModal report={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
    </>
  );
}

// Admin edits a cash-up's figures
function EditCashUpModal({ report, onClose, onSave }) {
  const [sales, setSales] = useState(String(report.sales_total));
  const [cash, setCash] = useState(String(report.cash_in_hand));
  const [note, setNote] = useState(report.note || "");
  const [busy, setBusy] = useState(false);

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
    </Modal>
  );
}

// Admin customer list, built from sales history — for building a WhatsApp group etc.
function Customers({ sales }) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState("");

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
          <div key={c.name} style={S.card}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{c.name}</div>
              <div style={S.cardMeta}>
                {c.phone || "no number"} · {c.count} purchase{c.count === 1 ? "" : "s"} · {money(c.total)}
              </div>
            </div>
            {c.phone && (
              <button style={{ ...S.btn, ...S.btnGhost, padding: "8px 12px" }} onClick={() => copy(c.phone, c.name)}>
                {copied === c.name ? "✓" : "Copy"}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Report({ sales, totalSales, totalTithe, cash, low }) {
  const byProduct = {};
  sales.forEach((s) => {
    const k = s.product_name;
    byProduct[k] = byProduct[k] || { qty: 0, total: 0, tithe: 0 };
    byProduct[k].qty += s.qty;
    byProduct[k].total += Number(s.total);
    byProduct[k].tithe += Number(s.tithe);
  });
  return (
    <>
      <div style={S.reportHead}>
        <FileText size={18} />
        <div>
          <div style={{ ...S.cardName, color: "#fff" }}>Weekly report</div>
          <div style={{ ...S.cardMeta, color: "rgba(255,255,255,0.7)" }}>Generated {new Date().toLocaleDateString()}</div>
        </div>
      </div>
      <div style={S.statGrid}>
        <Stat icon={<TrendingUp size={16} />} label="Total sales" value={money(totalSales)} accent delay={0} />
        <Stat icon={<Wallet size={16} />} label="Cash in hand" value={money(cash)} tint={mango} delay={0.05} />
        <Stat icon={<Church size={16} />} label="Owed to God" value={money(totalTithe)} tint={grape} delay={0.1} />
        <Stat icon={<Package size={16} />} label="Units sold" value={Object.values(byProduct).reduce((a,p)=>a+p.qty,0)} tint={sky} delay={0.15} />
      </div>
      <SectionTitle>By product</SectionTitle>
      {Object.keys(byProduct).length === 0 && <p style={S.empty}>No sales recorded yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(byProduct).map(([name, d]) => (
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
            <div key={p.id} style={{ ...S.card, borderColor: "#E8B4A0" }}>
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
function TeamManager({ onChange, businessId }) {
  const [members, setMembers] = useState([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMembers(await sb.select("members", `business_id=eq.${businessId}&select=id,name,role&order=created_at.asc`)); } catch {}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {members.map((m) => (
          <div key={m.id} style={S.card}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{m.name}</div>
              <div style={S.cardMeta}>{m.role}</div>
            </div>
            {m.role !== "admin" && <button style={S.delBtn} onClick={() => remove(m.id)}><X size={16} /></button>}
          </div>
        ))}
      </div>
    </>
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
      <Search size={16} style={{ color: "#8A8475", flexShrink: 0 }} />
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
function MarketWatermark() {
  // Subtle code-drawn grocery scene, sits faintly behind the login
  return (
    <svg viewBox="0 0 400 300" style={S.watermark} aria-hidden="true">
      <g fill="none" stroke={accent} strokeWidth="2" opacity="0.5">
        <circle cx="70" cy="90" r="26" />
        <circle cx="120" cy="80" r="20" />
        <path d="M40 130 h80 l-10 50 h-60 z" />
        <rect x="250" y="70" width="90" height="60" rx="8" />
        <path d="M250 95 h90 M280 70 v60 M310 70 v60" />
        <path d="M60 230 q40 -30 80 0 q40 30 80 0" />
        <circle cx="300" cy="210" r="18" />
        <path d="M300 192 q6 -10 14 -6" />
      </g>
    </svg>
  );
}
function HeroImage() {
  // If you add an image named hero.jpg to the project's public folder,
  // it shows here. Until then, nothing renders (no broken image).
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img src="/hero.jpg" alt="" onError={() => setOk(false)}
      style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 18, marginBottom: 18, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }} />
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
const ink = "#152019", paper = "#F3EFE6", accent = "#1F9D55", line = "#E2DCCD";
const lime = "#7CC243", mango = "#F5A623", berry = "#E0457B", sky = "#2FA7D8", grape = "#7C5CD6";
const S = {
  shell: { maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(180deg,#F6FBF2 0%,#F3EFE6 55%,#FBF4EA 100%)", fontFamily: "'Inter', system-ui, sans-serif", color: ink, paddingBottom: 60, position: "relative" },
  loadDot: { width: 22, height: 22, borderRadius: "50%", border: `3px solid ${line}`, borderTopColor: accent, animation: "spin 0.8s linear infinite", margin: "0 auto" },

  loginCard: { padding: "48px 28px", maxWidth: 380, margin: "0 auto", textAlign: "center", animation: "popIn 0.5s ease" },
  watermark: { position: "absolute", top: 80, left: "50%", transform: "translateX(-50%)", width: 460, maxWidth: "120%", opacity: 0.06, pointerEvents: "none", zIndex: 0 },
  logoMark: { width: 64, height: 64, borderRadius: 20, background: `linear-gradient(135deg,${lime},${accent})`, color: "#fff", display: "grid", placeItems: "center", margin: "0 auto 18px", boxShadow: "0 10px 30px rgba(31,157,85,0.35)", animation: "bob 3s ease-in-out infinite" },
  loginTitle: { fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 6px", background: `linear-gradient(135deg,${accent},${lime})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  loginSub: { fontSize: 14, color: "#6B6B5E", margin: "0 0 28px", lineHeight: 1.5 },
  errTxt: { color: "#C0392B", fontSize: 13.5, marginTop: 12 },

  pinDot: { width: 14, height: 14, borderRadius: "50%", border: `2px solid ${line}`, background: "#fff", transition: "all 0.2s ease" },
  pinDotFull: { background: accent, borderColor: accent, transform: "scale(1.2)" },
  keypad: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 6 },
  key: { padding: "16px 0", fontSize: 20, fontWeight: 700, background: "#fff", border: `1px solid ${line}`, borderRadius: 14, cursor: "pointer", color: ink, display: "grid", placeItems: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.04)" },

  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 20px 14px" },
  headTitle: { fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", background: `linear-gradient(135deg,${accent},${lime})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  headSub: { fontSize: 12, color: "#8A8475", textTransform: "uppercase", letterSpacing: "0.06em" },
  exitBtn: { display: "flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${line}`, padding: "7px 12px", borderRadius: 10, fontSize: 13, color: ink, cursor: "pointer" },

  alert: { display: "flex", alignItems: "center", gap: 8, margin: "0 20px 8px", padding: "11px 14px", background: "#FFF1DA", color: "#B26A00", borderRadius: 12, fontSize: 13, animation: "popIn 0.3s ease" },

  tabs: { display: "flex", gap: 4, padding: "6px 16px 0", overflowX: "auto" },
  tab: { padding: "9px 14px", border: "none", background: "transparent", fontSize: 13.5, fontWeight: 600, color: "#8A8475", cursor: "pointer", borderRadius: 10, whiteSpace: "nowrap" },
  tabActive: { background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", boxShadow: "0 4px 12px rgba(31,157,85,0.3)" },

  body: { padding: "16px 20px 0" },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 },
  stat: { background: "#fff", border: `1px solid ${line}`, borderRadius: 16, padding: "14px 15px", animation: "rise 0.4s ease both", boxShadow: "0 4px 14px rgba(0,0,0,0.04)" },
  statAccent: { background: `linear-gradient(135deg,${accent},${lime})`, border: "none", boxShadow: "0 8px 22px rgba(31,157,85,0.32)" },
  statIcon: { width: 32, height: 32, borderRadius: 10, background: "#EAF7EE", color: accent, display: "grid", placeItems: "center", marginBottom: 9 },
  statLabel: { fontSize: 11.5, color: "#8A8475", marginBottom: 3 },
  statValue: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" },

  sectionTitle: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8A8475", margin: "22px 0 10px" },
  hint: { fontSize: 13, color: "#8A8475", margin: "-4px 0 12px", lineHeight: 1.5 },
  empty: { fontSize: 13.5, color: "#9A9384", textAlign: "center", padding: "20px 0" },

  card: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1px solid ${line}`, borderRadius: 16, padding: "13px 15px", boxShadow: "0 3px 10px rgba(0,0,0,0.04)" },
  cardName: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" },
  cardMeta: { fontSize: 12.5, color: "#8A8475", marginTop: 2 },
  lowTag: { fontSize: 10, background: "#FFE2E2", color: "#C0392B", padding: "2px 7px", borderRadius: 20, fontWeight: 700, marginLeft: 6, verticalAlign: "middle" },
  outTag: { fontSize: 10, background: "#C0392B", color: "#fff", padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginLeft: 6, verticalAlign: "middle" },
  invTag: { fontSize: 10, background: "#EAF7EE", color: accent, padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginLeft: 6, verticalAlign: "middle", fontFamily: "monospace" },
  sugBox: { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: `1px solid ${line}`, borderRadius: 10, boxShadow: "0 8px 20px rgba(0,0,0,0.12)", zIndex: 30, overflow: "hidden", marginTop: 2 },
  sugItem: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "10px 13px", border: "none", borderBottom: `1px solid ${line}`, background: "#fff", cursor: "pointer", textAlign: "left" },
  miniStat: { flex: 1, background: "#F6FBF2", borderRadius: 10, padding: "8px 10px", textAlign: "center" },
  miniLabel: { fontSize: 10.5, color: "#8A8475", textTransform: "uppercase", letterSpacing: "0.04em" },
  miniVal: { fontSize: 15, fontWeight: 800, marginTop: 2 },

  qtyCtrl: { display: "flex", alignItems: "center", gap: 8 },
  qtyCol: { display: "flex", flexDirection: "column", gap: 6 },
  qtyTiny: { minWidth: 30, textAlign: "center", fontSize: 11, color: "#8A8475", fontWeight: 600 },
  qtyBtn: { width: 30, height: 30, borderRadius: 9, border: `1px solid ${line}`, background: "#F6FBF2", display: "grid", placeItems: "center", cursor: "pointer", color: accent },
  qtyNum: { minWidth: 28, textAlign: "center", fontWeight: 800, fontSize: 16 },
  delBtn: { background: "transparent", border: "none", color: "#C0392B", cursor: "pointer", padding: 4, display: "grid", placeItems: "center" },
  editBtn: { background: "transparent", border: "none", color: accent, cursor: "pointer", padding: 4, display: "grid", placeItems: "center" },

  sellBtn: { background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", border: "none", padding: "10px 18px", borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 12px rgba(31,157,85,0.3)" },
  sellBtnOff: { background: "#D9D3C4", color: "#fff", cursor: "not-allowed", boxShadow: "none" },

  saleRow: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: `1px solid ${line}`, borderRadius: 13 },
  saleName: { fontSize: 14, fontWeight: 700 },
  saleQty: { color: "#8A8475", fontWeight: 500 },
  titheTag: { fontSize: 11.5, color: accent, fontWeight: 600, marginTop: 1 },

  reportHead: { display: "flex", alignItems: "center", gap: 12, background: `linear-gradient(135deg,${grape},${berry})`, color: "#fff", padding: "16px 18px", borderRadius: 16, marginBottom: 14, boxShadow: "0 8px 22px rgba(124,92,214,0.3)" },

  btn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", padding: "14px 16px", borderRadius: 14, fontSize: 14.5, fontWeight: 800, cursor: "pointer" },
  btnDark: { background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", boxShadow: "0 6px 16px rgba(31,157,85,0.3)" },
  btnGhost: { background: "#fff", color: ink, border: `1px solid ${line}` },
  btnWarn: { background: `linear-gradient(135deg,${mango},#E8820C)`, color: "#fff", boxShadow: "0 6px 16px rgba(245,166,35,0.35)" },

  fieldWrap: { display: "block", marginBottom: 12, textAlign: "left" },
  fieldLabel: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#6B6B5E", marginBottom: 6 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 10, border: `1px solid ${line}`, fontSize: 15, background: "#fff", color: ink, outline: "none" },

  overlay: { position: "fixed", inset: 0, background: "rgba(31,36,33,0.45)", display: "grid", placeItems: "end center", zIndex: 50 },
  modal: { background: paper, width: "100%", maxWidth: 520, borderRadius: "20px 20px 0 0", padding: "20px 20px 30px", maxHeight: "88vh", overflowY: "auto" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { fontSize: 19, fontWeight: 800 },

  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: ink, color: "#fff", padding: "11px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 60 },

  searchWrap: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${line}`, borderRadius: 11, padding: "9px 13px", marginBottom: 12 },
  searchInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14.5, color: ink },
  searchClear: { background: "transparent", border: "none", color: "#8A8475", cursor: "pointer", padding: 0, display: "grid", placeItems: "center" },
  sellSummary: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#EFE9DC", borderRadius: 10, padding: "11px 14px", fontSize: 14.5, marginTop: 4 },

  cardPop: { animation: "pop 0.25s ease", transition: "transform 0.12s ease, box-shadow 0.12s ease" },
  cardInCart: { borderColor: accent, boxShadow: "0 0 0 1px #3A7D5C inset" },
  cartBadge: { fontSize: 10, background: accent, color: "#fff", padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginLeft: 8, verticalAlign: "middle" },
  cartFab: { position: "fixed", bottom: 22, left: 0, right: 0, marginLeft: "auto", marginRight: "auto", width: "fit-content", display: "flex", alignItems: "center", gap: 4, background: `linear-gradient(135deg,${accent},${lime})`, color: "#fff", border: "none", padding: "14px 24px", borderRadius: 30, fontSize: 15, cursor: "pointer", boxShadow: "0 10px 28px rgba(31,157,85,0.45)", zIndex: 55, animation: "popIn 0.3s ease" },
  cartFabCount: { background: "#fff", color: accent, borderRadius: "50%", minWidth: 22, height: 22, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800, marginLeft: 4 },
  cartLine: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${line}`, borderRadius: 11, padding: "10px 13px" },
  cartTotalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 18, fontWeight: 800, padding: "12px 14px", background: "#EFE9DC", borderRadius: 11 },
  receipt: { background: "#fff", border: `1px solid ${line}`, borderRadius: 14, padding: "18px 16px" },
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
    @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    button{transition:transform 0.08s ease, filter 0.12s ease}
    button:active{transform:scale(0.95)}
    button:hover{filter:brightness(1.05)}
  `;
  document.head.appendChild(st);
}
