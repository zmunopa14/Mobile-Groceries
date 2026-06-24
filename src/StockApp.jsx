import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, TrendingUp, Users, AlertTriangle, Plus, Minus, LogOut,
  Church, Wallet, FileText, ChevronRight, Box, X, Check, Delete, RefreshCw
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
    if (!r.ok) throw new Error((await r.json()).message || "Request failed");
    return r.json();
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

const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
const money = (n) => "$" + Number(n || 0).toFixed(2);

// ============================================================
// 2. ROOT
// ============================================================
export default function App() {
  const [user, setUser] = useState(null); // {id,name,role}
  if (!configured) return <SetupNotice />;
  if (!user) return <Login onLogin={setUser} />;
  return user.role === "admin"
    ? <Admin user={user} onExit={() => setUser(null)} />
    : <Seller user={user} onExit={() => setUser(null)} />;
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
    <div style={S.shell}>
      <div style={S.loginCard}>
        <div style={S.logoMark}><Box size={26} strokeWidth={2.4} /></div>
        <h1 style={S.loginTitle}>Stockflow</h1>
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
function useData() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [p, s] = await Promise.all([
        sb.select("products", "order=created_at.asc"),
        sb.select("sales", "order=sold_at.desc&limit=200"),
      ]);
      setProducts(p); setSales(s);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000); // light polling keeps phones in sync
    return () => clearInterval(t);
  }, [refresh]);

  return { products, sales, loading, error, refresh };
}

// ============================================================
// 5. ADMIN
// ============================================================
function Admin({ user, onExit }) {
  const { products, sales, loading, error, refresh } = useData();
  const [tab, setTab] = useState("overview");

  const totalSales = sales.reduce((a, x) => a + Number(x.total), 0);
  const totalTithe = sales.reduce((a, x) => a + Number(x.tithe), 0);
  const cash = totalSales - totalTithe;
  const low = products.filter((p) => p.qty <= p.low_at);

  return (
    <div style={S.shell}>
      <Header title={user.name} sub="Admin" onExit={onExit} onRefresh={refresh} />
      {error && <div style={S.alert}><AlertTriangle size={16} /> {error}</div>}
      {low.length > 0 && (
        <div style={S.alert}>
          <AlertTriangle size={16} />
          <span><b>{low.length}</b> item{low.length > 1 ? "s" : ""} running low — time to reorder.</span>
        </div>
      )}
      <Tabs tab={tab} setTab={setTab} items={[
        ["overview","Overview"],["stock","Stock"],["report","Tuesday report"],["team","Team"],
      ]} />
      <div style={S.body}>
        {loading ? <Loading /> : <>
          {tab === "overview" && <>
            <div style={S.statGrid}>
              <Stat icon={<TrendingUp size={16} />} label="Total sales" value={money(totalSales)} accent />
              <Stat icon={<Wallet size={16} />} label="Cash in hand" value={money(cash)} />
              <Stat icon={<Church size={16} />} label="Church (tithe)" value={money(totalTithe)} />
              <Stat icon={<Package size={16} />} label="Items in stock" value={products.reduce((a,p)=>a+p.qty,0)} />
            </div>
            <SectionTitle>Recent sales</SectionTitle>
            <SalesList sales={sales.slice(0,12)} showSeller />
          </>}
          {tab === "stock" && <StockManager products={products} onChange={refresh} />}
          {tab === "report" && <Report sales={sales} totalSales={totalSales} totalTithe={totalTithe} cash={cash} low={low} />}
          {tab === "team" && <TeamManager onChange={refresh} />}
        </>}
      </div>
    </div>
  );
}

// ============================================================
// 6. SELLER
// ============================================================
function Seller({ user, onExit }) {
  const { products, sales, loading, error, refresh } = useData();
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState("");
  const mine = sales.filter((s) => s.seller_name === user.name);
  const myTotal = mine.reduce((a, x) => a + Number(x.total), 0);

  const sell = async (productId) => {
    setBusyId(productId);
    try {
      await sb.rpc("record_sale", { p_product_id: productId, p_qty: 1, p_seller: user.name });
      setToast("Sale recorded");
      await refresh();
    } catch (e) { setToast(e.message); }
    setBusyId(null);
    setTimeout(() => setToast(""), 1800);
  };

  return (
    <div style={S.shell}>
      <Header title={user.name} sub="Salesperson" onExit={onExit} onRefresh={refresh} />
      {error && <div style={S.alert}><AlertTriangle size={16} /> {error}</div>}
      <div style={S.body}>
        {loading ? <Loading /> : <>
          <div style={S.statGrid}>
            <Stat icon={<TrendingUp size={16} />} label="My sales total" value={money(myTotal)} accent />
            <Stat icon={<FileText size={16} />} label="My transactions" value={mine.length} />
          </div>
          <SectionTitle>Record a sale</SectionTitle>
          <p style={S.hint}>Tap an item each time you sell it. Stock updates for everyone.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {products.length === 0 && <p style={S.empty}>No products yet. Ask the admin to add stock.</p>}
            {products.map((p) => {
              const out = p.qty <= 0;
              return (
                <div key={p.id} style={{ ...S.card, opacity: out ? 0.5 : 1 }}>
                  <div style={{ flex: 1 }}>
                    <div style={S.cardName}>{p.name}</div>
                    <div style={S.cardMeta}>{money(p.price)} · {p.qty} left</div>
                  </div>
                  <button style={{ ...S.sellBtn, ...(out ? S.sellBtnOff : {}) }}
                    disabled={out || busyId === p.id} onClick={() => sell(p.id)}>
                    {out ? "Sold out" : busyId === p.id ? "…" : "Sell 1"}
                  </button>
                </div>
              );
            })}
          </div>
          <SectionTitle>My sales</SectionTitle>
          <SalesList sales={mine.slice(0, 15)} />
        </>}
      </div>
      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

// ============================================================
// 7. STOCK MANAGER (admin)
// ============================================================
function StockManager({ products, onChange }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", price: "", pct: "", qty: "", low: "5" });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!f.name.trim() || f.price === "") return;
    setBusy(true);
    try {
      await sb.insert("products", {
        name: f.name.trim(), price: parseFloat(f.price) || 0,
        tithe_pct: parseFloat(f.pct) || 0, qty: parseInt(f.qty) || 0,
        low_at: parseInt(f.low) || 5,
      });
      setF({ name: "", price: "", pct: "", qty: "", low: "5" });
      setOpen(false); await onChange();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  const restock = async (p, n) => {
    await sb.patch("products", `id=eq.${p.id}`, { qty: Math.max(0, p.qty + n) });
    await onChange();
  };
  const remove = async (id) => {
    await sb.del("products", `id=eq.${id}`);
    await onChange();
  };

  return (
    <>
      <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginBottom: 14 }} onClick={() => setOpen(true)}>
        <Plus size={18} /> Add new product
      </button>
      {products.length === 0 && <p style={S.empty}>No products yet. Add your first item above.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {products.map((p) => (
          <div key={p.id} style={S.card}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{p.name} {p.qty <= p.low_at && <span style={S.lowTag}>low</span>}</div>
              <div style={S.cardMeta}>{money(p.price)} · {p.tithe_pct}% to church</div>
            </div>
            <div style={S.qtyCtrl}>
              <button style={S.qtyBtn} onClick={() => restock(p, -1)}><Minus size={14} /></button>
              <span style={S.qtyNum}>{p.qty}</span>
              <button style={S.qtyBtn} onClick={() => restock(p, 1)}><Plus size={14} /></button>
            </div>
            <button style={S.delBtn} onClick={() => remove(p.id)}><X size={16} /></button>
          </div>
        ))}
      </div>
      {open && (
        <Modal onClose={() => setOpen(false)} title="New product">
          <Field label="Product name" value={f.name} onChange={(v)=>setF({...f,name:v})} placeholder="e.g. Maputi snack" />
          <Field label="Selling price ($)" value={f.price} onChange={(v)=>setF({...f,price:v})} type="number" placeholder="1.50" />
          <Field label="Church percentage (%)" value={f.pct} onChange={(v)=>setF({...f,pct:v})} type="number" placeholder="10" />
          <Field label="Opening stock quantity" value={f.qty} onChange={(v)=>setF({...f,qty:v})} type="number" placeholder="100" />
          <Field label="Warn me when stock drops to" value={f.low} onChange={(v)=>setF({...f,low:v})} type="number" placeholder="5" />
          <button style={{ ...S.btn, ...S.btnDark, width: "100%", marginTop: 8 }} disabled={busy} onClick={add}>
            <Check size={18} /> {busy ? "Saving…" : "Save product"}
          </button>
        </Modal>
      )}
    </>
  );
}

// ============================================================
// 8. REPORT (admin)
// ============================================================
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
        <Stat icon={<TrendingUp size={16} />} label="Total sales" value={money(totalSales)} accent />
        <Stat icon={<Wallet size={16} />} label="Cash in hand" value={money(cash)} />
        <Stat icon={<Church size={16} />} label="Owed to church" value={money(totalTithe)} />
        <Stat icon={<Package size={16} />} label="Units sold" value={Object.values(byProduct).reduce((a,p)=>a+p.qty,0)} />
      </div>
      <SectionTitle>By product</SectionTitle>
      {Object.keys(byProduct).length === 0 && <p style={S.empty}>No sales recorded yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(byProduct).map(([name, d]) => (
          <div key={name} style={S.card}>
            <div style={{ flex: 1 }}>
              <div style={S.cardName}>{name}</div>
              <div style={S.cardMeta}>{d.qty} sold · {money(d.total)} · {money(d.tithe)} tithe</div>
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
function TeamManager({ onChange }) {
  const [members, setMembers] = useState([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMembers(await sb.select("members", "select=id,name,role&order=created_at.asc")); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name.trim() || pin.length < 4) return;
    setBusy(true);
    try {
      await sb.rpc("upsert_member", { p_name: name.trim(), p_pin: pin, p_role: "seller" });
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
function Stat({ icon, label, value, accent }) {
  return (
    <div style={{ ...S.stat, ...(accent ? S.statAccent : {}) }}>
      <div style={{ ...S.statIcon, ...(accent ? { color: "#fff", background: "rgba(255,255,255,0.18)" } : {}) }}>{icon}</div>
      <div style={{ ...S.statLabel, ...(accent ? { color: "rgba(255,255,255,0.8)" } : {}) }}>{label}</div>
      <div style={{ ...S.statValue, ...(accent ? { color: "#fff" } : {}) }}>{value}</div>
    </div>
  );
}
function SalesList({ sales, showSeller }) {
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
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={S.saleName}>{money(s.total)}</div>
            <div style={S.titheTag}>{money(s.tithe)} tithe</div>
          </div>
        </div>
      ))}
    </div>
  );
}
function SectionTitle({ children }) { return <div style={S.sectionTitle}>{children}</div>; }
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
const ink = "#1F2421", paper = "#F3EFE6", accent = "#3A7D5C", line = "#E2DCCD";
const S = {
  shell: { maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: paper, fontFamily: "'Inter', system-ui, sans-serif", color: ink, paddingBottom: 40, position: "relative" },
  loadDot: { width: 22, height: 22, borderRadius: "50%", border: `3px solid ${line}`, borderTopColor: accent, animation: "spin 0.8s linear infinite", margin: "0 auto" },

  loginCard: { padding: "48px 28px", maxWidth: 380, margin: "0 auto", textAlign: "center" },
  logoMark: { width: 56, height: 56, borderRadius: 16, background: accent, color: "#fff", display: "grid", placeItems: "center", margin: "0 auto 18px" },
  loginTitle: { fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 6px" },
  loginSub: { fontSize: 14, color: "#6B6B5E", margin: "0 0 28px", lineHeight: 1.5 },
  errTxt: { color: "#C0392B", fontSize: 13.5, marginTop: 12 },

  pinDot: { width: 14, height: 14, borderRadius: "50%", border: `2px solid ${line}`, background: "#fff" },
  pinDotFull: { background: accent, borderColor: accent },
  keypad: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 6 },
  key: { padding: "16px 0", fontSize: 20, fontWeight: 700, background: "#fff", border: `1px solid ${line}`, borderRadius: 12, cursor: "pointer", color: ink, display: "grid", placeItems: "center" },

  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 20px 14px" },
  headTitle: { fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" },
  headSub: { fontSize: 12, color: "#8A8475", textTransform: "uppercase", letterSpacing: "0.06em" },
  exitBtn: { display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${line}`, padding: "7px 12px", borderRadius: 10, fontSize: 13, color: ink, cursor: "pointer" },

  alert: { display: "flex", alignItems: "center", gap: 8, margin: "0 20px 8px", padding: "11px 14px", background: "#FBEAE2", color: "#9C4A2A", borderRadius: 12, fontSize: 13 },

  tabs: { display: "flex", gap: 4, padding: "6px 16px 0", overflowX: "auto" },
  tab: { padding: "9px 14px", border: "none", background: "transparent", fontSize: 13.5, fontWeight: 600, color: "#8A8475", cursor: "pointer", borderRadius: 9, whiteSpace: "nowrap" },
  tabActive: { background: ink, color: "#fff" },

  body: { padding: "16px 20px 0" },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 },
  stat: { background: "#fff", border: `1px solid ${line}`, borderRadius: 14, padding: "14px 15px" },
  statAccent: { background: accent, border: `1px solid ${accent}` },
  statIcon: { width: 30, height: 30, borderRadius: 9, background: "#EFE9DC", color: accent, display: "grid", placeItems: "center", marginBottom: 9 },
  statLabel: { fontSize: 11.5, color: "#8A8475", marginBottom: 3 },
  statValue: { fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em" },

  sectionTitle: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8A8475", margin: "22px 0 10px" },
  hint: { fontSize: 13, color: "#8A8475", margin: "-4px 0 12px", lineHeight: 1.5 },
  empty: { fontSize: 13.5, color: "#9A9384", textAlign: "center", padding: "20px 0" },

  card: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1px solid ${line}`, borderRadius: 13, padding: "13px 15px" },
  cardName: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" },
  cardMeta: { fontSize: 12.5, color: "#8A8475", marginTop: 2 },
  lowTag: { fontSize: 10, background: "#FBEAE2", color: "#9C4A2A", padding: "2px 7px", borderRadius: 20, fontWeight: 700, marginLeft: 6, verticalAlign: "middle" },

  qtyCtrl: { display: "flex", alignItems: "center", gap: 8 },
  qtyBtn: { width: 30, height: 30, borderRadius: 8, border: `1px solid ${line}`, background: paper, display: "grid", placeItems: "center", cursor: "pointer", color: ink },
  qtyNum: { minWidth: 28, textAlign: "center", fontWeight: 800, fontSize: 16 },
  delBtn: { background: "transparent", border: "none", color: "#C0392B", cursor: "pointer", padding: 4, display: "grid", placeItems: "center" },

  sellBtn: { background: accent, color: "#fff", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" },
  sellBtnOff: { background: "#D9D3C4", color: "#fff", cursor: "not-allowed" },

  saleRow: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: `1px solid ${line}`, borderRadius: 11 },
  saleName: { fontSize: 14, fontWeight: 700 },
  saleQty: { color: "#8A8475", fontWeight: 500 },
  titheTag: { fontSize: 11.5, color: accent, fontWeight: 600, marginTop: 1 },

  reportHead: { display: "flex", alignItems: "center", gap: 12, background: ink, color: "#fff", padding: "16px 18px", borderRadius: 14, marginBottom: 14 },

  btn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", padding: "13px 16px", borderRadius: 12, fontSize: 14.5, fontWeight: 700, cursor: "pointer" },
  btnDark: { background: ink, color: "#fff" },

  fieldWrap: { display: "block", marginBottom: 12, textAlign: "left" },
  fieldLabel: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#6B6B5E", marginBottom: 6 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 10, border: `1px solid ${line}`, fontSize: 15, background: "#fff", color: ink, outline: "none" },

  overlay: { position: "fixed", inset: 0, background: "rgba(31,36,33,0.45)", display: "grid", placeItems: "end center", zIndex: 50 },
  modal: { background: paper, width: "100%", maxWidth: 520, borderRadius: "20px 20px 0 0", padding: "20px 20px 30px", maxHeight: "88vh", overflowY: "auto" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { fontSize: 19, fontWeight: 800 },

  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: ink, color: "#fff", padding: "11px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 60 },
};

if (typeof document !== "undefined" && !document.getElementById("sf-spin")) {
  const st = document.createElement("style");
  st.id = "sf-spin";
  st.textContent = "@keyframes spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(st);
}
