// Kasa Cepte — veri katmanı (Firebase Authentication + Cloud Firestore)
// Her kullanıcının verisi: kullanicilar/{uid}  (ayarlar)  ve  kullanicilar/{uid}/gunler/{YYYY-AA-GG}
import { firebaseConfig } from "./config.js";

const V = "10.12.2";
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

export function isConfigured() {
  return !!firebaseConfig.apiKey && !/BURAYA|PROJE-ADI/.test(firebaseConfig.apiKey + firebaseConfig.projectId);
}

export async function createStore() {
  if (window.KASA_FAKE) return window.KASA_FAKE; // test için
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  auth.languageCode = "tr";
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch {
    db = F.getFirestore(app);
  }
  let uid = null;
  const userDoc = () => F.doc(db, "kullanicilar", uid);
  const dayDoc = iso => F.doc(db, "kullanicilar", uid, "gunler", iso);

  return {
    onAuth(cb) { return A.onAuthStateChanged(auth, u => { uid = u ? u.uid : null; cb(u ? { uid: u.uid, email: u.email } : null); }); },
    signIn: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
    signUp: (e, p) => A.createUserWithEmailAndPassword(auth, e, p),
    reset: e => A.sendPasswordResetEmail(auth, e),
    signOut: () => A.signOut(auth),
    subscribeDays(cb, err) {
      return F.onSnapshot(F.collection(db, "kullanicilar", uid, "gunler"), snap => {
        const out = {};
        snap.forEach(d => { const v = d.data(); if (v && (v.adisyonlar || []).length) out[d.id] = v; });
        cb(out, snap.metadata.hasPendingWrites || snap.metadata.fromCache);
      }, err);
    },
    subscribeSettings(cb) {
      return F.onSnapshot(userDoc(), s => cb(s.exists() ? s.data() : {}), () => {});
    },
    saveDay(iso, list) {
      if (!list.length) return F.deleteDoc(dayDoc(iso));
      const toplam = Math.round(list.reduce((s, a) => s + (Number(a.toplam) || 0), 0) * 100) / 100;
      return F.setDoc(dayDoc(iso), { tarih: iso, adisyonlar: list, toplam, guncelleme: new Date().toISOString() });
    },
    setOran: oran => F.setDoc(userDoc(), { oran }, { merge: true }),
    async importDays(daysObj) {
      const ids = Object.keys(daysObj);
      for (let i = 0; i < ids.length; i += 400) {
        const b = F.writeBatch(db);
        ids.slice(i, i + 400).forEach(iso => {
          const list = daysObj[iso].adisyonlar;
          const toplam = Math.round(list.reduce((s, a) => s + (Number(a.toplam) || 0), 0) * 100) / 100;
          b.set(dayDoc(iso), { tarih: iso, adisyonlar: list, toplam, guncelleme: new Date().toISOString() });
        });
        await b.commit();
      }
    },
  };
}
