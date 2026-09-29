// Kasa Cepte — uygulama
import { createStore, isConfigured } from "./store.js";

const $ = s => document.querySelector(s);
const TL = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tl = n => TL.format(n || 0) + " ₺";
const AYLAR = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const GUNLER = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
const pad2 = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
const parseIso = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => isoOf(new Date());
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch {} };
const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? "" : pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
const dayTotal = d => (d?.adisyonlar || []).reduce((s, a) => s + (Number(a.toplam) || 0), 0);

/* ---------- state ---------- */
let store = null, user = null, unsub = [];
let days = {}, loaded = false, oran = 40, expenses = {}, savings = {}, savLoaded = false;
let curDay = today(), curMonth = today().slice(0, 7), tab = "gun";
let entry = "", note = "", editId = null, delArm = false, delTimer;

/* ---------- toast ---------- */
let tt;
function toast(msg, err) { const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2400); }

/* ---------- screens ---------- */
function showApp(on) {
  $("#s-auth").hidden = on;
  $("#brand").hidden = !on; $("#bnav").hidden = !on;
  if (on) showTab(tab); else ["gun", "ay", "harc", "bir", "ayar"].forEach(t => $("#s-" + t).hidden = true);
}
function showTab(t) {
  tab = t;
  document.querySelectorAll(".bnav button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  ["gun", "ay", "harc", "bir", "ayar"].forEach(x => $("#s-" + x).hidden = x !== t);
  render();
}
document.querySelectorAll(".bnav button").forEach(b => b.onclick = () => { buzz(); showTab(b.dataset.tab); });

/* ---------- auth ---------- */
let mode = "in"; // in | up | reset
const AUTH_ERR = {
  "auth/invalid-email": "E-posta adresi geçersiz.",
  "auth/missing-password": "Şifrenizi yazın.",
  "auth/invalid-credential": "E-posta veya şifre yanlış.",
  "auth/wrong-password": "E-posta veya şifre yanlış.",
  "auth/user-not-found": "Bu e-postayla kayıtlı hesap yok.",
  "auth/email-already-in-use": "Bu e-postayla zaten bir hesap var. Giriş yapmayı deneyin.",
  "auth/weak-password": "Şifre en az 6 karakter olmalı.",
  "auth/too-many-requests": "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.",
  "auth/network-request-failed": "İnternet bağlantısı yok. Bağlantınızı kontrol edin.",
};
function setMode(m) {
  mode = m;
  $("#aErr").textContent = ""; $("#aErr").className = "ferr";
  $("#authTitle").textContent = m === "up" ? "Yeni hesap oluştur" : m === "reset" ? "Şifre sıfırlama" : "Giriş yap";
  $("#aBtn").textContent = m === "up" ? "Hesap oluştur" : m === "reset" ? "Sıfırlama bağlantısı gönder" : "Giriş yap";
  $("#passWrap").hidden = m === "reset";
  $("#aPass").autocomplete = m === "up" ? "new-password" : "current-password";
  $("#aSwitch").textContent = m === "in" ? "Yeni hesap oluştur" : "Girişe dön";
  $("#aForgot").hidden = m !== "in";
}
$("#aSwitch").onclick = () => setMode(mode === "in" ? "up" : "in");
$("#aForgot").onclick = () => setMode("reset");
$("#authForm").onsubmit = async e => {
  e.preventDefault();
  const email = $("#aEmail").value.trim(), pass = $("#aPass").value, err = $("#aErr");
  err.className = "ferr"; err.textContent = "";
  if (!store) { err.textContent = "Uygulama henüz hazır değil."; return; }
  if (!email) { err.textContent = "E-posta adresinizi yazın."; return; }
  if (mode !== "reset" && pass.length < 6) { err.textContent = "Şifre en az 6 karakter olmalı."; return; }
  const btn = $("#aBtn"); btn.disabled = true;
  try {
    if (mode === "in") await store.signIn(email, pass);
    else if (mode === "up") await store.signUp(email, pass);
    else { await store.reset(email); err.className = "fok"; err.textContent = "Şifre sıfırlama bağlantısı " + email + " adresine gönderildi. Gelen kutunuzu (ve spam klasörünü) kontrol edin."; }
  } catch (x) {
    const code = String(x?.code || "");
    err.textContent = AUTH_ERR[code]
      || (/api-key|app-not-authorized|unauthorized-domain|operation-not-allowed/.test(code)
          ? "Uygulama Firebase'e bağlanamadı (" + code + "). Bu mesajı Claude'a gönderin."
          : "İşlem yapılamadı (" + (code || "bilinmeyen hata") + "). Tekrar deneyin.");
  } finally { btn.disabled = false; }
};
$("#logoutBtn").onclick = async () => { buzz(); await store.signOut(); };

async function boot() {
  if (!window.KASA_FAKE && !isConfigured()) { $("#cfgWarn").hidden = false; $("#aBtn").disabled = true; showApp(false); return; }
  try { store = await createStore(); }
  catch { $("#aErr").textContent = "Uygulama yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin."; showApp(false); return; }
  store.onAuth(u => {
    unsub.forEach(f => f()); unsub = [];
    user = u; days = {}; expenses = {}; savings = {}; savLoaded = false; earnedPrev = null; hedef = 0; loaded = false; oran = 40; resetEntry(); xReset(); bReset();
    if (!u) { setMode("in"); showApp(false); return; }
    $("#accEmail").textContent = u.email || "";
    showApp(true);
    unsub.push(store.subscribeDays((d, pending) => {
      days = d; loaded = true; $("#sync").classList.toggle("off", !!pending);
      $("#sync").title = pending ? "Eşitleniyor (internet gelince kaydedilecek)" : "Eşitlendi";
      $("#dbWarn").hidden = true; render();
    }, () => { const w = $("#dbWarn"); w.textContent = "Kayıtlar yüklenemedi. Uygulamayı kapatıp açın."; w.hidden = false; loaded = true; render(); }));
    unsub.push(store.subscribeExpenses(e => { expenses = e; render(); }));
    unsub.push(store.subscribeSavings(v => { savings = v; savLoaded = true; render(); }));
    unsub.push(store.subscribeSettings(s => { const o = Number(s.oran); if (o > 0 && o < 100 && o !== oran) oran = o; const h = Number(s.hedef); hedef = h > 0 ? h : 0; render(); }));
  });
}

/* ---------- saving ---------- */
function saveDay(iso, list) {
  if (list.length) days = { ...days, [iso]: { tarih: iso, adisyonlar: list } };
  else { const c = { ...days }; delete c[iso]; days = c; }
  render();
  // Çevrimdışıyken Firestore yazmayı sıraya alır; sonuç beklenmeden ekran güncellenir.
  store.saveDay(iso, list).catch(e => toast(e?.code === "permission-denied" ? "Kaydetme izni yok. Çıkış yapıp tekrar girin." : "Kaydedilemedi. Tekrar deneyin.", true));
}

/* ---------- day navigation ---------- */
function setDay(iso) { curDay = iso; resetEntry(); render(); }
$("#prevDay").onclick = () => { buzz(); const d = parseIso(curDay); d.setDate(d.getDate() - 1); setDay(isoOf(d)); };
$("#nextDay").onclick = () => { buzz(); const d = parseIso(curDay); d.setDate(d.getDate() + 1); setDay(isoOf(d)); };
$("#dayPick").onchange = e => { if (e.target.value && e.target.value <= today()) setDay(e.target.value); };
$("#toToday").onclick = () => setDay(today());

/* ---------- keypad ---------- */
function press(k) {
  if (k === "back") entry = entry.slice(0, -1);
  else if (k === ",") { if (!entry.includes(",")) entry = (entry || "0") + ","; }
  else {
    const [i, f] = entry.split(",");
    if (f !== undefined && f.length >= 2) return;
    if (f === undefined && (i || "").replace(/^0+/, "").length >= 7) return;
    entry = entry === "0" ? k : entry + k;
  }
  buzz(); renderEntry();
}
$("#pad").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) press(b.dataset.k); });
document.addEventListener("keydown", e => {
  if ($("#s-gun").hidden || e.target.tagName === "INPUT") return;
  if (/^[0-9]$/.test(e.key)) press(e.key);
  else if (e.key === "," || e.key === ".") press(",");
  else if (e.key === "Backspace") press("back");
  else if (e.key === "Enter") { e.preventDefault(); $("#goBtn").click(); }
  else if (e.key === "Escape") resetEntry();
});
const entryVal = () => parseFloat((entry || "0").replace(",", ".")) || 0;
function fmtEntry() {
  if (!entry) return "0";
  const [i, f] = entry.split(",");
  const iv = Number(i || "0").toLocaleString("tr-TR");
  return f !== undefined ? iv + "," + f : iv;
}

/* ---------- note ---------- */
$("#noteBtn").onclick = () => { $("#noteRow").hidden = false; $("#noteIn").value = note; $("#noteIn").focus(); };
function closeNote() { note = $("#noteIn").value.trim(); $("#noteRow").hidden = true; renderEntry(); }
$("#noteOk").onclick = closeNote;
$("#noteIn").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); closeNote(); } };

/* ---------- add / edit / delete ---------- */
function resetEntry() { entry = ""; note = ""; editId = null; $("#noteRow").hidden = true; delArm = false; renderEntry(); renderTapeSel(); }
$("#cancelBtn").onclick = () => { buzz(); resetEntry(); };
$("#delBtn").onclick = () => {
  buzz();
  if (!delArm) { delArm = true; $("#delBtn").textContent = "Emin misin?"; clearTimeout(delTimer); delTimer = setTimeout(() => { delArm = false; renderEntry(); }, 3000); return; }
  const list = days[curDay]?.adisyonlar || []; const a = list.find(x => x.id === editId);
  resetEntry();
  saveDay(curDay, list.filter(x => x.id !== a?.id)); toast(tl(a?.toplam) + " silindi");
};
$("#goBtn").onclick = () => {
  const v = round2(entryVal()); if (v <= 0) return;
  buzz();
  const list = (days[curDay]?.adisyonlar || []).slice();
  if (editId) {
    const nl = list.map(x => x.id === editId ? { ...x, toplam: v, not: note } : x);
    resetEntry(); saveDay(curDay, nl); toast("Düzeltildi: " + tl(v));
  } else {
    list.push({ id: newId(), toplam: v, not: note, eklenme: new Date().toISOString() });
    resetEntry(); saveDay(curDay, list); toast(tl(v) + " eklendi");
    const tp = $("#tape"); tp.scrollTop = tp.scrollHeight;
  }
};
function startEdit(a) {
  buzz(); editId = a.id; note = a.not || "";
  entry = String(a.toplam).replace(".", ","); if (/,\d$/.test(entry)) entry += "0";
  renderEntry(); renderTapeSel();
}

/* ---------- render: day ---------- */
function renderEntry() {
  const n = $("#num"); n.textContent = fmtEntry(); n.classList.toggle("ph", !entry);
  const ed = !!editId;
  $("#disp").classList.toggle("editing", ed);
  $("#mode").textContent = ed ? "Düzenleniyor" : "Yeni adisyon";
  $("#noteBtn").textContent = note ? note : "+ Not"; $("#noteBtn").classList.toggle("has", !!note);
  $("#actions").classList.toggle("editing", ed);
  $("#cancelBtn").hidden = !ed; $("#delBtn").hidden = !ed;
  if (!delArm) $("#delBtn").textContent = "Sil";
  const g = $("#goBtn"); g.disabled = entryVal() <= 0;
  g.textContent = ed ? "Kaydet" : (entryVal() > 0 ? "Ekle  +" + tl(entryVal()) : "Ekle");
  g.classList.toggle("save", ed);
}
function renderTapeSel() { document.querySelectorAll(".row").forEach(r => r.classList.toggle("sel", r.dataset.id === editId)); }
function renderDay() {
  const iso = curDay, d = parseIso(iso), isToday = iso === today();
  const y = new Date(); y.setDate(y.getDate() - 1);
  $("#dayTitle").textContent = isToday ? "Bugün" : iso === isoOf(y) ? "Dün" : GUNLER[d.getDay()];
  $("#dayDate").textContent = d.getDate() + " " + AYLAR[d.getMonth()] + " " + d.getFullYear() + (isToday || iso === isoOf(y) ? ", " + GUNLER[d.getDay()] : "");
  $("#dayPick").value = iso; $("#dayPick").max = today();
  $("#todayWrap").hidden = isToday; $("#nextDay").disabled = iso >= today();
  const list = days[iso]?.adisyonlar || [], tot = dayTotal(days[iso]);
  $("#dayTot").textContent = tl(tot);
  const sub = $("#sumSub"); sub.textContent = "";
  if (list.length) { sub.append(list.length + " adisyon", document.createElement("br"), "%" + oran + " pay: " + tl(tot * oran / 100)); }
  else sub.textContent = "Henüz adisyon yok";
  const tape = $("#tape");
  if (!list.length) {
    tape.innerHTML = loaded ? `<div class="empty"><b>Bu güne adisyon girilmedi</b>Aşağıdaki tuşlarla tutarı yazıp Ekle'ye basın.</div>` : `<div class="empty">Yükleniyor…</div>`;
  } else {
    tape.innerHTML = "";
    list.forEach((a, i) => {
      const r = document.createElement("button"); r.className = "row"; r.dataset.id = a.id; r.type = "button";
      r.setAttribute("aria-label", (i + 1) + ". adisyon, " + tl(a.toplam) + ", düzenlemek için dokunun");
      r.innerHTML = `<span class="i">${i + 1}</span><span class="t">${a.not ? `<em>${esc(a.not)}</em> · ` : ""}${hhmm(a.eklenme)}</span><span class="a">${TL.format(a.toplam)}</span>`;
      r.onclick = () => editId === a.id ? resetEntry() : startEdit(a);
      tape.append(r);
    });
    renderTapeSel();
  }
  renderEntry();
}

/* ---------- render: month ---------- */
$("#prevMonth").onclick = () => { buzz(); const [y, m] = curMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); curMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1); render(); };
$("#nextMonth").onclick = () => { buzz(); const [y, m] = curMonth.split("-").map(Number); const d = new Date(y, m, 1); curMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1); render(); };

function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function kfmt(v) { return v >= 1000 ? (v / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + "b" : Math.round(v).toLocaleString("tr-TR"); }
function barChart(el, labels, values, { highlight = -1, labelEvery = 1, onClick, avg } = {}) {
  const W = Math.max(280, Math.round(el.clientWidth || 440)), H = Math.round(Math.min(220, Math.max(170, W * 0.5)));
  const L = 36, R = 6, T = 14, B = 22, n = values.length, ph = H - T - B;
  const max = niceMax(Math.max(...values, 0)), cw = (W - L - R) / n, bw = Math.max(3, Math.min(34, cw * 0.7));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Çubuk grafik">`;
  for (let i = 0; i <= 4; i++) { const v = max * i / 4, y = T + ph * (1 - i / 4);
    s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${L - 5}" y="${y + 4}" text-anchor="end">${kfmt(v)}</text>`; }
  values.forEach((v, i) => {
    const h = ph * (v / max), x = L + cw * i + (cw - bw) / 2, y = H - B - h;
    s += `<rect x="${x.toFixed(1)}" y="${(v > 0 ? y : H - B - 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${(v > 0 ? h : 2).toFixed(1)}" rx="2" fill="${v > 0 ? 'var(--bar)' : 'var(--bar-dim)'}" opacity="${highlight >= 0 && i !== highlight ? 0.45 : 1}"><title>${esc(labels[i])}: ${tl(v)}</title></rect>`;
    if (onClick) s += `<rect data-i="${i}" x="${(L + cw * i).toFixed(1)}" y="${T}" width="${cw.toFixed(1)}" height="${ph + B}" fill="transparent" style="cursor:pointer"/>`;
    if (i % labelEvery === 0 || i === n - 1) s += `<text x="${(L + cw * i + cw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  if (avg > 0) { const y = T + ph * (1 - avg / max); s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--ink)" stroke-dasharray="4 4" opacity=".5"/><text x="${W - R}" y="${y - 5}" text-anchor="end">ort. ${kfmt(avg)}</text>`; }
  el.innerHTML = s + `</svg>`;
  if (onClick) el.querySelectorAll("rect[data-i]").forEach(r => r.onclick = () => onClick(+r.dataset.i));
}
function statNet(k, n, s) { return `<div class="stat"><div class="k2">${k}</div><div class="v${n < 0 ? " neg" : ""}">${tl(n)}</div><div class="s">${s}</div></div>`; }
const monthExp = ym => (expenses[ym] || []).reduce((s, x) => s + (Number(x.tutar) || 0), 0);
const monthCiro = ym => Object.entries(days).filter(([k]) => k.startsWith(ym)).reduce((s, [, v]) => s + dayTotal(v), 0);
function stat(k, v, s = "", cls = "") { return `<div class="stat ${cls}"><div class="k2">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`; }

function renderAy() {
  const [y, m] = curMonth.split("-").map(Number), nd = new Date(y, m, 0).getDate();
  $("#ayTitle").textContent = AYLAR[m - 1] + " " + y;
  $("#nextMonth").disabled = curMonth >= today().slice(0, 7);
  const vals = [], cnt = [];
  for (let d = 1; d <= nd; d++) { const x = days[curMonth + "-" + pad2(d)]; vals.push(dayTotal(x)); cnt.push((x?.adisyonlar || []).length); }
  const tot = vals.reduce((a, b) => a + b, 0), act = vals.filter(v => v > 0).length, adc = cnt.reduce((a, b) => a + b, 0), bi = vals.indexOf(Math.max(...vals)), avg = act ? tot / act : 0;
  $("#ayBanner").hidden = !loaded || tot > 0;
  const pm = new Date(y, m - 2, 1), pk = pm.getFullYear() + "-" + pad2(pm.getMonth() + 1);
  const prevTot = Object.entries(days).filter(([k]) => k.startsWith(pk)).reduce((s, [, v]) => s + dayTotal(v), 0);
  const cmp = prevTot && tot ? ((tot >= prevTot ? "+" : "") + Math.round((tot - prevTot) / prevTot * 100) + "% " + AYLAR[pm.getMonth()] + " ayına göre") : act + " gün kayıtlı";
  $("#ayStats").innerHTML = stat("Aylık ciro", tl(tot), cmp, "big") + stat("Günlük ortalama", tl(avg), act + " gün") + stat("En iyi gün", tot ? tl(vals[bi]) : "—", tot ? (bi + 1) + " " + AYLAR[m - 1] + ", " + GUNLER[new Date(y, m - 1, bi + 1).getDay()] : "") + stat("Adisyon sayısı", adc) + stat("Ort. adisyon", adc ? tl(tot / adc) : "—")
    + stat("Harcamalar", tl(monthExp(curMonth)), (expenses[curMonth] || []).length + " kalem")
    + statNet("Net kalan", tot - monthExp(curMonth), "Ciro − harcama");
  const pay = round2(tot * oran / 100), kalan = round2(tot - pay);
  $("#splitCard").innerHTML = `<div class="hd"><h3>Aylık bölüşüm</h3>
      <div class="step"><button type="button" id="oranDown" aria-label="Oranı azalt">−</button><b>%${oran}</b><button type="button" id="oranUp" aria-label="Oranı artır">+</button></div></div>
    <div class="bar" aria-hidden="true"><i style="width:${oran}%"></i></div>
    <div class="parts">
      <div class="part a"><div class="k2">%${oran} pay</div><div class="v">${tl(pay)}</div></div>
      <div class="part b"><div class="k2">Kalan %${100 - oran}</div><div class="v">${tl(kalan)}</div></div>
    </div>
    <div class="s muted" style="font-size:12px">${AYLAR[m - 1]} toplamı ${tl(tot)} üzerinden. Her adisyon eklendiğinde kendiliğinden güncellenir.</div>`;
  $("#oranDown").onclick = () => setOran(oran - 5);
  $("#oranUp").onclick = () => setOran(oran + 5);
  const goDay = i => { curDay = curMonth + "-" + pad2(i + 1); resetEntry(); showTab("gun"); };
  barChart($("#ayChart"), vals.map((_, i) => String(i + 1)), vals, { labelEvery: 5, onClick: goDay, avg });
  const rows = vals.map((v, i) => ({ i, v, c: cnt[i] })).filter(r => r.v > 0).reverse();
  $("#ayList").innerHTML = rows.length ? rows.map(r => { const dt = new Date(y, m - 1, r.i + 1); return `<button class="drow" data-i="${r.i}" type="button"><span class="d"><b>${r.i + 1} ${AYLAR[m - 1]}</b> <span>${GUNLER[dt.getDay()]}</span></span><span class="c">${r.c} ad.</span><span class="a">${tl(r.v)}</span></button>`; }).join("") : `<p class="muted" style="margin:6px 0">Bu ay kayıt yok.</p>`;
  $("#ayList").querySelectorAll(".drow").forEach(b => b.onclick = () => goDay(+b.dataset.i));
  $("#yilTitle").textContent = y + ", aylara göre";
  const mv = AYLAR.map((_, i) => Object.entries(days).filter(([k]) => k.startsWith(y + "-" + pad2(i + 1))).reduce((s, [, v]) => s + dayTotal(v), 0));
  barChart($("#yilChart"), AYLAR.map(a => a.slice(0, 1)), mv, { highlight: m - 1, onClick: i => { curMonth = y + "-" + pad2(i + 1); render(); $("#s-ay .scroll").scrollTop = 0; } });
}

/* ---------- harcamalar ---------- */
const KATEGORILER = ["Malzeme", "Kira", "Fatura", "Personel", "Diğer"];
const KAT_RENK = { Malzeme: "#F08C1E", Kira: "#7A5AF8", Fatura: "#2E90FA", Personel: "#12B76A", "Diğer": "#E0457B" };
const EXTRA_RENK = ["#0BA5B5", "#B54708", "#667085"];
const katRenk = (k, i) => KAT_RENK[k] || EXTRA_RENK[i % EXTRA_RENK.length];
function donut(el, parts, centerTop, centerSub) {
  const tot = parts.reduce((s, p) => s + p.v, 0);
  const R = 70, W = 22, C = 2 * Math.PI * R; let off = 0;
  let svg = `<svg viewBox="0 0 180 180" role="img" aria-label="Gider dağılımı pastası"><circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="${W}"/>`;
  if (tot > 0) parts.forEach(p => {
    const len = p.v / tot * C, gap = parts.length > 1 ? Math.min(2, len / 3) : 0;
    svg += `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${p.c}" stroke-width="${W}" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 90 90)"><title>${esc(p.k)}: ${tl(p.v)}</title></circle>`;
    off += len;
  });
  svg += `<text x="90" y="86" text-anchor="middle" class="dc1">${centerTop}</text><text x="90" y="106" text-anchor="middle" class="dc2">${centerSub}</text></svg>`;
  el.innerHTML = svg;
}
let xMonth = today().slice(0, 7), xEditId = null, xCat = "Malzeme", xDelArm = false, xDelTimer;
$("#xCats").innerHTML = KATEGORILER.map(k => `<button type="button" class="chip" data-cat="${k}" aria-pressed="false">${k}</button>`).join("");
$("#xCats").onclick = e => { const b = e.target.closest("[data-cat]"); if (!b) return; buzz(); xCat = b.dataset.cat; paintCats(); };
function paintCats() { document.querySelectorAll("#xCats .chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.cat === xCat)); }
const xVal = () => { const v = parseFloat(String($("#xAmt").value).replace(/\s/g, "").replace(/\./g, "").replace(",", ".")); return isFinite(v) && v > 0 ? round2(v) : 0; };
$("#xAmt").oninput = () => paintXForm();
$("#xAmt").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#xSave").click(); } };
function xDefaultDate() { return xMonth === today().slice(0, 7) ? today() : xMonth + "-01"; }
function xReset() {
  xEditId = null; xDelArm = false; $("#xAmt").value = ""; $("#xNote").value = ""; xCat = "Malzeme";
  $("#xDate").value = xDefaultDate(); paintCats(); paintXForm();
}
function paintXForm() {
  const ed = !!xEditId, v = xVal();
  $("#xFormTitle").textContent = ed ? "Harcamayı düzenle" : "Harcama ekle";
  $("#xAct").classList.toggle("editing", ed);
  $("#xCancel").hidden = !ed; $("#xDel").hidden = !ed;
  if (!xDelArm) $("#xDel").textContent = "Sil";
  const s = $("#xSave"); s.disabled = v <= 0;
  s.textContent = ed ? "Kaydet" : (v > 0 ? "Harcama ekle  −" + tl(v) : "Harcama ekle");
  document.querySelectorAll(".xitem").forEach(r => r.classList.toggle("sel", r.dataset.id === xEditId));
}
function saveExp(ym, list) {
  expenses = { ...expenses }; if (list.length) expenses[ym] = list; else delete expenses[ym];
  render();
  store.saveExpenses(ym, list).catch(() => toast("Harcama kaydedilemedi. Tekrar deneyin.", true));
}
function findExp(id) { for (const ym of Object.keys(expenses)) { const x = expenses[ym].find(e => e.id === id); if (x) return [ym, x]; } return [null, null]; }
$("#xSave").onclick = () => {
  const v = xVal(); if (v <= 0) return;
  const tarih = $("#xDate").value || xDefaultDate(), ym = tarih.slice(0, 7), not = $("#xNote").value.trim();
  buzz();
  if (xEditId) {
    const [oldYm, old] = findExp(xEditId);
    const upd = { ...old, tutar: v, kategori: xCat, tarih, not };
    if (oldYm && oldYm !== ym) saveExp(oldYm, expenses[oldYm].filter(e => e.id !== xEditId));
    saveExp(ym, (expenses[ym] || []).filter(e => e.id !== xEditId).concat(upd));
    toast("Harcama düzeltildi: " + tl(v));
  } else {
    saveExp(ym, (expenses[ym] || []).concat({ id: newId(), tutar: v, kategori: xCat, tarih, not, eklenme: new Date().toISOString() }));
    toast(xCat + " harcaması eklendi: " + tl(v));
  }
  xMonth = ym; xReset(); render();
};
$("#xCancel").onclick = () => { buzz(); xReset(); };
$("#xDel").onclick = () => {
  buzz();
  if (!xDelArm) { xDelArm = true; $("#xDel").textContent = "Emin misin?"; clearTimeout(xDelTimer); xDelTimer = setTimeout(() => { xDelArm = false; paintXForm(); }, 3000); return; }
  const [ym, x] = findExp(xEditId); xReset();
  if (ym) { saveExp(ym, expenses[ym].filter(e => e.id !== x.id)); toast(tl(x.tutar) + " harcama silindi"); }
};
function xEdit(x) {
  buzz(); xEditId = x.id; xDelArm = false; xCat = x.kategori;
  $("#xAmt").value = TL.format(x.tutar).replace(/\./g, ""); $("#xDate").value = x.tarih; $("#xNote").value = x.not || "";
  paintCats(); paintXForm(); $("#s-harc .scroll").scrollTo({ top: 0, behavior: "smooth" });
}
function xShift(delta) { const [y, m] = xMonth.split("-").map(Number); const d = new Date(y, m - 1 + delta, 1); xMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1); xReset(); render(); }
$("#xPrev").onclick = () => { buzz(); xShift(-1); };
$("#xNext").onclick = () => { buzz(); xShift(1); };
function renderHarc() {
  const [y, m] = xMonth.split("-").map(Number);
  $("#xTitle").textContent = AYLAR[m - 1] + " " + y;
  $("#xNext").disabled = xMonth >= today().slice(0, 7);
  $("#xDate").max = today();
  if (!xEditId && !$("#xDate").value) $("#xDate").value = xDefaultDate();
  const list = (expenses[xMonth] || []).slice().sort((a, b) => b.tarih.localeCompare(a.tarih) || String(b.eklenme).localeCompare(String(a.eklenme)));
  const top = list.reduce((s, x) => s + x.tutar, 0), ciro = monthCiro(xMonth);
  $("#xStats").innerHTML = `<div class="stat big" style="background:var(--bad);border-color:var(--bad);color:#fff"><div class="k2">Aylık harcama</div><div class="v">${tl(top)}</div><div class="s">${list.length} kalem</div></div>`
    + stat("Ciro", tl(ciro)) + statNet("Net kalan", ciro - top, "Ciro − harcama");
  const cats = [...new Set(KATEGORILER.concat(list.map(x => x.kategori)))];
  const byCat = cats.map(k => [k, list.filter(x => x.kategori === k).reduce((s, x) => s + x.tutar, 0)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const parts = byCat.map(([k, v], i) => ({ k, v, c: katRenk(k, i) }));
  if (parts.length) {
    donut($("#xPie"), parts, esc(kfmt(top)) + " ₺", "toplam gider");
    $("#xLegend").innerHTML = parts.map(p => `<div class="lg"><i style="background:${p.c}"></i><span>${esc(p.k)}</span><em>%${Math.round(p.v / top * 100)}</em><b>${tl(p.v)}</b></div>`).join("");
  } else {
    donut($("#xPie"), [], "0 ₺", "gider yok");
    $("#xLegend").innerHTML = `<p class="muted" style="margin:4px 0">Bu ay harcama girilmedi. Harcama ekledikçe pasta renklenir.</p>`;
  }
  const box = $("#xList"); box.innerHTML = "";
  if (!list.length) box.innerHTML = `<p class="muted" style="margin:6px 0">Harcama eklediğinizde burada tarih sırasıyla listelenir. Düzeltmek için dokunun.</p>`;
  let lastDay = "";
  list.forEach(x => {
    if (x.tarih !== lastDay) { lastDay = x.tarih; const d = parseIso(x.tarih); const h = document.createElement("div"); h.className = "xday"; h.textContent = d.getDate() + " " + AYLAR[d.getMonth()] + " · " + GUNLER[d.getDay()]; box.append(h); }
    const b = document.createElement("button"); b.type = "button"; b.className = "xitem"; b.dataset.id = x.id;
    b.innerHTML = `<span><span class="xk">${esc(x.kategori)}</span>${x.not ? `<br><span class="xn">${esc(x.not)}</span>` : ""}</span><span class="a">−${tl(x.tutar)}</span>`;
    b.onclick = () => xEditId === x.id ? xReset() : xEdit(x);
    box.append(b);
  });
  paintXForm();
}
paintCats();

/* ---------- birikim + rozetler ---------- */
let bMonth = today().slice(0, 7), bEditId = null, bTur = "ekle", bDelArm = false, bDelTimer;
let earnedPrev = null; // rozet kutlaması için: ilk yüklemedeki rozetler
const signed = x => (x.tur === "cek" ? -1 : 1) * (Number(x.tutar) || 0);
const monthSave = ym => (savings[ym] || []).reduce((s, x) => s + signed(x), 0);
const allSave = () => Object.values(savings).flat().reduce((s, x) => s + signed(x), 0);
const pct = r => "%" + Math.round(r * 100).toLocaleString("tr-TR");

const ROZETLER = [
  { id: "ilk",   ad: "İlk Adım",          sart: "İlk birikimini ekle",                       renk: "#12B76A", ikon: "M12 20v-7m0 0c0-4 3-6 7-6 0 4-3 6-7 6Zm0 0C12 9 9 7 5 7c0 4 3 6 7 6" },
  { id: "r25",   ad: "Kumbara",           sart: "Bir ayda giderin %25'i kadar biriktir",     renk: "#2E90FA", esik: 0.25, ikon: "M5 17h14M6 13h12M7 9h10M9 5h6" },
  { id: "r50",   ad: "Yarı Yolda",        sart: "Bir ayda giderin %50'si kadar biriktir",    renk: "#7A5AF8", esik: 0.5,  ikon: "M12 4a8 8 0 1 0 0 16V4Z" },
  { id: "r100",  ad: "Başa Baş",          sart: "Bir ayda gider kadar biriktir",             renk: "#F08C1E", esik: 1,    ikon: "M6 9h12M6 15h12" },
  { id: "r150",  ad: "Tasarruf Ustası",   sart: "Bir ayda giderin 1,5 katını biriktir",      renk: "#E0457B", esik: 1.5,  ikon: "m12 4 2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6 9.6 9Z" },
  { id: "r200",  ad: "Birikim Şampiyonu", sart: "Bir ayda giderin 2 katını biriktir",        renk: "#D4A20B", esik: 2,    ikon: "M8 4h8v5a4 4 0 0 1-8 0V4Zm4 9v4m-4 3h8M8 6H5a3 3 0 0 0 3 3m8-3h3a3 3 0 0 1-3 3" },
  { id: "seri3", ad: "Üç Ay Seri",        sart: "3 ay üst üste gider kadar biriktir",        renk: "#0BA5B5", ikon: "M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 3 3 3s1-3 0-7Z" },
];
function ratioOf(ym) { const g = monthExp(ym); return g > 0 ? monthSave(ym) / g : null; }
function evalBadges() {
  const months = [...new Set(Object.keys(savings).concat(Object.keys(expenses)))].sort();
  const got = {};
  const firstDep = Object.keys(savings).sort().find(ym => savings[ym].some(x => x.tur !== "cek"));
  if (firstDep) got.ilk = firstDep;
  for (const b of ROZETLER.filter(b => b.esik)) {
    const ym = months.find(m => { const r = ratioOf(m); return r !== null && r >= b.esik; });
    if (ym) got[b.id] = ym;
  }
  let run = 0, prev = null;
  for (const ym of months) {
    const r = ratioOf(ym);
    const [y, m] = ym.split("-").map(Number), pv = prev && prev.split("-").map(Number);
    const consecutive = pv && (y * 12 + m) - (pv[0] * 12 + pv[1]) === 1;
    run = r !== null && r >= 1 ? (consecutive ? run + 1 : 1) : 0;
    prev = ym;
    if (run >= 3 && !got.seri3) got.seri3 = ym;
  }
  return got;
}
function medal(b, on) {
  return `<svg viewBox="0 0 64 64" class="medal${on ? "" : " off"}" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill="${b.renk}"/><circle cx="32" cy="32" r="23" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2"/>
    <g transform="translate(14 14) scale(1.5)" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${b.ikon}"/></g></svg>`;
}
function celebrate(b) {
  const o = $("#badgePop");
  o.innerHTML = `${medal(b, true)}<div><small>Yeni rozet kazandınız</small><b>${esc(b.ad)}</b><span>${esc(b.sart)}</span></div>`;
  o.hidden = false; o.classList.remove("pop"); void o.offsetWidth; o.classList.add("pop");
  try { navigator.vibrate && navigator.vibrate([30, 60, 30]); } catch {}
  clearTimeout(o._t); o._t = setTimeout(() => o.hidden = true, 3800);
}
function checkNewBadges() {
  const got = evalBadges();
  if (earnedPrev === null) { if (savLoaded && loaded) earnedPrev = new Set(Object.keys(got)); return got; }
  const fresh = ROZETLER.filter(b => got[b.id] && !earnedPrev.has(b.id));
  fresh.forEach(b => earnedPrev.add(b.id));
  if (fresh.length) celebrate(fresh[fresh.length - 1]);
  return got;
}

/* form */
const bVal = () => { const v = parseFloat(String($("#bAmt").value).replace(/\s/g, "").replace(/\./g, "").replace(",", ".")); return isFinite(v) && v > 0 ? round2(v) : 0; };
$("#bAmt").oninput = () => paintBForm();
$("#bAmt").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#bSave").click(); } };
$("#bTur").onclick = e => { const t = e.target.closest("[data-tur]"); if (!t) return; buzz(); bTur = t.dataset.tur; paintBForm(); };
function bDefaultDate() { return bMonth === today().slice(0, 7) ? today() : bMonth + "-01"; }
function bReset() { bEditId = null; bDelArm = false; bTur = "ekle"; $("#bAmt").value = ""; $("#bNote").value = ""; $("#bDate").value = bDefaultDate(); paintBForm(); }
function paintBForm() {
  const ed = !!bEditId, v = bVal();
  document.querySelectorAll("#bTur .chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.tur === bTur));
  $("#bFormTitle").textContent = ed ? "Kaydı düzenle" : "Birikim hareketi";
  $("#bAct").classList.toggle("editing", ed);
  $("#bCancel").hidden = !ed; $("#bDel").hidden = !ed;
  if (!bDelArm) $("#bDel").textContent = "Sil";
  const s = $("#bSave"); s.disabled = v <= 0; s.classList.toggle("wd", bTur === "cek");
  s.textContent = ed ? "Kaydet" : bTur === "cek" ? (v > 0 ? "Birikimden çek  −" + tl(v) : "Birikimden çek") : (v > 0 ? "Birikime ekle  +" + tl(v) : "Birikime ekle");
  document.querySelectorAll(".bitem").forEach(r => r.classList.toggle("sel", r.dataset.id === bEditId));
}
function saveSav(ym, list) {
  savings = { ...savings }; if (list.length) savings[ym] = list; else delete savings[ym];
  render();
  store.saveSavings(ym, list).catch(() => toast("Birikim kaydedilemedi. Tekrar deneyin.", true));
}
function findSav(id) { for (const ym of Object.keys(savings)) { const x = savings[ym].find(e => e.id === id); if (x) return [ym, x]; } return [null, null]; }
$("#bSave").onclick = () => {
  const v = bVal(); if (v <= 0) return;
  const tarih = $("#bDate").value || bDefaultDate(), ym = tarih.slice(0, 7), not = $("#bNote").value.trim();
  buzz();
  if (bEditId) {
    const [oldYm, old] = findSav(bEditId);
    const upd = { ...old, tutar: v, tur: bTur, tarih, not };
    if (oldYm && oldYm !== ym) saveSav(oldYm, savings[oldYm].filter(e => e.id !== bEditId));
    saveSav(ym, (savings[ym] || []).filter(e => e.id !== bEditId).concat(upd));
    toast("Kayıt düzeltildi");
  } else {
    saveSav(ym, (savings[ym] || []).concat({ id: newId(), tutar: v, tur: bTur, tarih, not, eklenme: new Date().toISOString() }));
    toast(bTur === "cek" ? tl(v) + " birikimden çekildi" : tl(v) + " birikime eklendi");
  }
  bMonth = ym; bReset(); render();
};
$("#bCancel").onclick = () => { buzz(); bReset(); };
$("#bDel").onclick = () => {
  buzz();
  if (!bDelArm) { bDelArm = true; $("#bDel").textContent = "Emin misin?"; clearTimeout(bDelTimer); bDelTimer = setTimeout(() => { bDelArm = false; paintBForm(); }, 3000); return; }
  const [ym, x] = findSav(bEditId); bReset();
  if (ym) { saveSav(ym, savings[ym].filter(e => e.id !== x.id)); toast("Kayıt silindi"); }
};
function bEdit(x) {
  buzz(); bEditId = x.id; bDelArm = false; bTur = x.tur === "cek" ? "cek" : "ekle";
  $("#bAmt").value = TL.format(x.tutar).replace(/\./g, ""); $("#bDate").value = x.tarih; $("#bNote").value = x.not || "";
  paintBForm(); $("#bForm").scrollIntoView({ behavior: "smooth", block: "center" });
}
function bShift(d) { const [y, m] = bMonth.split("-").map(Number); const t = new Date(y, m - 1 + d, 1); bMonth = t.getFullYear() + "-" + pad2(t.getMonth() + 1); bReset(); render(); }
$("#bPrev").onclick = () => { buzz(); bShift(-1); };
$("#bNext").onclick = () => { buzz(); bShift(1); };

/* hedef */
let hedef = 0;
$("#hedefBtn").onclick = () => { $("#hedefRow").hidden = false; $("#hedefIn").value = hedef ? TL.format(hedef).replace(/\./g, "").replace(/,00$/, "") : ""; $("#hedefIn").focus(); };
$("#hedefOk").onclick = () => {
  const v = parseFloat(String($("#hedefIn").value).replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  hedef = isFinite(v) && v > 0 ? round2(v) : 0; $("#hedefRow").hidden = true; render();
  store.setHedef(hedef).catch(() => toast("Hedef kaydedilemedi.", true));
  toast(hedef ? "Hedef: " + tl(hedef) : "Hedef kaldırıldı");
};

function renderBirikim() {
  const [y, m] = bMonth.split("-").map(Number);
  $("#bTitle").textContent = AYLAR[m - 1] + " " + y;
  $("#bNext").disabled = bMonth >= today().slice(0, 7);
  $("#bDate").max = today();
  if (!bEditId && !$("#bDate").value) $("#bDate").value = bDefaultDate();
  const total = allSave(), ms = monthSave(bMonth), mg = monthExp(bMonth);
  $("#bStats").innerHTML = `<div class="stat big" style="background:var(--good);border-color:var(--good);color:#fff"><div class="k2">Toplam birikim</div><div class="v">${tl(total)}</div><div class="s">${AYLAR[m - 1]}: ${ms >= 0 ? "+" : "−"}${tl(Math.abs(ms))}</div></div>`
    + stat("Bu ay birikim", tl(ms)) + stat("Bu ay gider", tl(mg));
  // oran
  const r = mg > 0 ? ms / mg : null;
  const steps = ROZETLER.filter(b => b.esik);
  const next = r === null ? null : steps.find(b => r < b.esik);
  const fill = r === null ? 0 : Math.max(0, Math.min(1, r / 2));
  $("#bRatio").innerHTML = `<div class="rhd"><h3>Birikim / gider</h3><b class="rv">${r === null ? "—" : pct(r)}</b></div>
    <div class="rtrack"><i style="width:${(fill * 100).toFixed(1)}%"></i>${steps.map(b => `<span class="tick${r !== null && r >= b.esik ? " hit" : ""}" style="left:${b.esik / 2 * 100}%" title="${esc(b.ad)}"></span>`).join("")}</div>
    <div class="rlab">${steps.map(b => `<span style="left:${b.esik / 2 * 100}%">${pct(b.esik)}</span>`).join("")}</div>
    <p class="rtx">${r === null ? "Oranı görmek için bu aya harcama girin. Birikiminiz giderlerinize göre ne kadar yüksekse o kadar çok rozet kazanırsınız."
      : next ? `Bu ay birikim/gider oranınız <b>${pct(r)}</b>. <b>${esc(next.ad)}</b> rozeti için <b>${tl(next.esik * mg - ms)}</b> daha biriktirin.`
      : `Bu ay birikim/gider oranınız <b>${pct(r)}</b>. Bütün oran rozetlerini kazandınız!`}</p>`;
  // hedef
  const hp = hedef > 0 ? Math.max(0, Math.min(1, total / hedef)) : 0;
  $("#hedefBody").innerHTML = hedef > 0
    ? `<div class="rhd"><span class="muted">${tl(total)} / ${tl(hedef)}</span><b class="rv">%${Math.round(hp * 100)}</b></div><div class="htrack"><i style="width:${(hp * 100).toFixed(1)}%"></i></div>
       <p class="rtx">${total >= hedef ? "Hedefinize ulaştınız, tebrikler!" : "Hedefe " + tl(hedef - total) + " kaldı."}</p>`
    : `<p class="rtx">Bir birikim hedefi koyun (örneğin yeni bir fırın ya da kira depozitosu), ilerlemenizi burada görün.</p>`;
  $("#hedefBtn").textContent = hedef > 0 ? "Değiştir" : "Hedef koy";
  // rozetler
  const got = checkNewBadges();
  const n = Object.keys(got).length;
  $("#badgeCount").textContent = n + " / " + ROZETLER.length;
  $("#badges").innerHTML = ROZETLER.map(b => {
    const on = !!got[b.id], when = on ? AYLAR[+got[b.id].slice(5) - 1] + " " + got[b.id].slice(0, 4) : "";
    return `<div class="badge${on ? " on" : ""}">${medal(b, on)}<b>${esc(b.ad)}</b><span>${on ? when : esc(b.sart)}</span></div>`;
  }).join("");
  // liste
  const list = (savings[bMonth] || []).slice().sort((a, b) => b.tarih.localeCompare(a.tarih) || String(b.eklenme).localeCompare(String(a.eklenme)));
  const box = $("#bList"); box.innerHTML = list.length ? "" : `<p class="muted" style="margin:6px 0">Bu ay birikim hareketi yok.</p>`;
  list.forEach(x => {
    const d = parseIso(x.tarih), b = document.createElement("button");
    b.type = "button"; b.className = "xitem bitem"; b.dataset.id = x.id;
    b.innerHTML = `<span><span class="xk">${x.tur === "cek" ? "Birikimden çekildi" : "Birikime eklendi"}</span><br><span class="xn">${d.getDate()} ${AYLAR[d.getMonth()]}${x.not ? " · " + esc(x.not) : ""}</span></span><span class="a ${x.tur === "cek" ? "neg" : "pos"}">${x.tur === "cek" ? "−" : "+"}${tl(x.tutar)}</span>`;
    b.onclick = () => bEditId === x.id ? bReset() : bEdit(x);
    box.append(b);
  });
  paintBForm();
}

/* ---------- settings ---------- */
let oranTimer;
function setOran(v) {
  v = Math.max(5, Math.min(95, Math.round(v))); if (v === oran) return;
  buzz(); oran = v; render();
  clearTimeout(oranTimer);
  oranTimer = setTimeout(() => store.setOran(v).catch(() => toast("Oran kaydedilemedi.", true)), 600);
}
$("#oranDown2").onclick = () => setOran(oran - 5);
$("#oranUp2").onclick = () => setOran(oran + 5);
function renderAyar() { $("#oranVal2").textContent = "%" + oran; }

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$("#backupBtn").onclick = () => {
  const data = { uygulama: "Kasa Cepte", surum: 3, tarih: new Date().toISOString(), oran, hedef, gunler: days, harcamalar: expenses, birikim: savings };
  download("kasacepte-yedek-" + today() + ".json", JSON.stringify(data, null, 1), "application/json");
  toast("Yedek indirildi");
};
$("#csvBtn").onclick = () => {
  const rows = [["Tarih", "Gün", "Sıra", "Saat", "Tutar", "Not"]];
  Object.keys(days).sort().forEach(iso => {
    const d = parseIso(iso);
    days[iso].adisyonlar.forEach((a, i) => rows.push([d.toLocaleDateString("tr-TR"), GUNLER[d.getDay()], i + 1, hhmm(a.eklenme), TL.format(a.toplam), a.not || ""]));
  });
  rows.push([], ["HARCAMALAR"], ["Tarih", "Gün", "Kategori", "", "Tutar", "Not"]);
  Object.keys(expenses).sort().forEach(ym => expenses[ym].slice().sort((a, b) => a.tarih.localeCompare(b.tarih)).forEach(x => {
    const d = parseIso(x.tarih); rows.push([d.toLocaleDateString("tr-TR"), GUNLER[d.getDay()], x.kategori, "", TL.format(x.tutar), x.not || ""]);
  }));
  rows.push([], ["BİRİKİM"], ["Tarih", "Gün", "Hareket", "", "Tutar", "Not"]);
  Object.keys(savings).sort().forEach(ym => savings[ym].slice().sort((a, b) => a.tarih.localeCompare(b.tarih)).forEach(x => {
    const d = parseIso(x.tarih); rows.push([d.toLocaleDateString("tr-TR"), GUNLER[d.getDay()], x.tur === "cek" ? "Çekildi" : "Eklendi", "", (x.tur === "cek" ? "-" : "") + TL.format(x.tutar), x.not || ""]);
  }));
  const csv = "﻿" + rows.map(r => r.map(c => { const s = String(c); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";")).join("\r\n");
  download("kasacepte-" + today() + ".csv", csv, "text/csv;charset=utf-8");
  toast("Excel dosyası indirildi");
};
$("#importIn").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const src = data.gunler || {};
    const merged = {}; let added = 0;
    for (const iso of Object.keys(src)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      const incoming = (src[iso].adisyonlar || []).filter(a => Number(a.toplam) > 0).map(a => ({ id: String(a.id || newId()), toplam: round2(a.toplam), not: String(a.not || ""), eklenme: String(a.eklenme || iso + "T12:00:00.000Z") }));
      const cur = days[iso]?.adisyonlar || [];
      const have = new Set(cur.map(a => a.id));
      const fresh = incoming.filter(a => !have.has(a.id));
      if (fresh.length) { merged[iso] = { adisyonlar: cur.concat(fresh) }; added += fresh.length; }
    }
    let xAdded = 0;
    for (const ym of Object.keys(data.harcamalar || {})) {
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      const cur = expenses[ym] || [], have = new Set(cur.map(x => x.id));
      const fresh = (data.harcamalar[ym] || []).filter(x => Number(x.tutar) > 0 && !have.has(String(x.id)))
        .map(x => ({ id: String(x.id || newId()), tutar: round2(x.tutar), kategori: String(x.kategori || "Diğer"), tarih: String(x.tarih || ym + "-01"), not: String(x.not || ""), eklenme: String(x.eklenme || "") }));
      if (fresh.length) { await store.saveExpenses(ym, cur.concat(fresh)); xAdded += fresh.length; }
    }
    for (const ym of Object.keys(data.birikim || {})) {
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      const cur = savings[ym] || [], have = new Set(cur.map(x => x.id));
      const fresh = (data.birikim[ym] || []).filter(x => Number(x.tutar) > 0 && !have.has(String(x.id)))
        .map(x => ({ id: String(x.id || newId()), tutar: round2(x.tutar), tur: x.tur === "cek" ? "cek" : "ekle", tarih: String(x.tarih || ym + "-01"), not: String(x.not || ""), eklenme: String(x.eklenme || "") }));
      if (fresh.length) { await store.saveSavings(ym, cur.concat(fresh)); xAdded += fresh.length; }
    }
    if (Number(data.hedef) > 0 && !hedef) await store.setHedef(Number(data.hedef));
    if (!added && !xAdded) { toast("Yedekteki kayıtların hepsi zaten bu hesapta var."); return; }
    if (added) await store.importDays(merged);
    const o = Number(data.oran); if (o > 0 && o < 100 && o !== oran) setOran(o);
    toast(added + " adisyon" + (xAdded ? ", " + xAdded + " harcama/birikim kaydı" : "") + " yüklendi");
  } catch { toast("Bu dosya okunamadı. Kasa Cepte yedek dosyası seçin.", true); }
};

/* ---------- install (PWA) ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; $("#installRow").hidden = false; });
$("#installBtn").onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $("#installRow").hidden = true; };
window.addEventListener("appinstalled", () => { $("#installRow").hidden = true; toast("Kasa Cepte telefona yüklendi"); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

/* ---------- render ---------- */
function render() {
  if (!user) return;
  if (tab === "gun") renderDay(); else if (tab === "ay") renderAy(); else if (tab === "harc") renderHarc(); else if (tab === "bir") renderBirikim(); else renderAyar();
}
window.addEventListener("resize", () => { clearTimeout(window.__rt); window.__rt = setTimeout(render, 150); });
// gün değişince (gece yarısını geçen açık uygulama) "Bugün" güncellensin
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

setMode("in");
boot();
