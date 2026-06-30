// ─── FIREBASE CONFIG ───
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc, updateDoc, collection, query, where,
         getDocs, onSnapshot, serverTimestamp, runTransaction, arrayUnion, arrayRemove,
         increment, limit as fbLimit, orderBy }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDJw5bEHtfNQr3Wzuotyhp2XS9wVQsJ0nw",
  authDomain: "desafiohv-73554.firebaseapp.com",
  projectId: "desafiohv-73554",
  storageBucket: "desafiohv-73554.firebasestorage.app",
  messagingSenderId: "155643760451",
  appId: "1:155643760451:web:02c404b853b4ce64e169f6",
  measurementId: "G-59H6ECJPTR"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ─── AUTH ───
export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logout() {
  await signOut(auth);
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

// ─── FIRESTORE: keys que sincronizamos ───
const SYNC_KEYS = [
  'dhv_activities','dhv_history','dhv_total_stars','dhv_spent_stars',
  'dhv_inventory','dhv_purchase_hist','dhv_claimed_ach','dhv_mode',
  'dhv_rest_day','dhv_tutorial_seen'
];

export async function pushToCloud(uid) {
  const data = {};
  SYNC_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) data[k] = v;
  });
  data._updatedAt = serverTimestamp();
  data._version = 2;
  await setDoc(doc(db, 'users', uid), data, { merge: true });
}

export async function pullFromCloud(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return false;
  const data = snap.data();
  let restored = 0;
  SYNC_KEYS.forEach(k => {
    if (data[k] !== undefined) {
      localStorage.setItem(k, data[k]);
      restored++;
    }
  });
  return restored > 0;
}

// ─── MERGE INTELIGENTE: prevalece quien tiene más progreso ───
export async function mergeWithCloud(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) {
    // Primera vez: subir local
    await pushToCloud(uid);
    return 'pushed';
  }
  const cloud = snap.data();
  const localStars  = parseInt(localStorage.getItem('dhv_total_stars') || '0');
  const cloudStars  = parseInt(cloud.dhv_total_stars || '0');
  const localHist   = JSON.parse(localStorage.getItem('dhv_history') || '[]');
  const cloudHist   = JSON.parse(cloud.dhv_history || '[]');

  if (cloudStars > localStars || cloudHist.length > localHist.length) {
    // Cloud tiene más progreso → pull
    SYNC_KEYS.forEach(k => { if (cloud[k] !== undefined) localStorage.setItem(k, cloud[k]); });
    return 'pulled';
  } else {
    // Local tiene más → push
    await pushToCloud(uid);
    return 'pushed';
  }
}

// ══════════════════════════════════════════════════════════
// USERNAMES ÚNICOS
// Colección "usernames" : { [username_lowercase]: { uid, displayName } }
// Garantiza unicidad vía transacción atómica
// ══════════════════════════════════════════════════════════
function normalizeUsername(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function validateUsername(name) {
  const norm = normalizeUsername(name);
  if (norm.length < 3) return 'Mínimo 3 caracteres';
  if (norm.length > 20) return 'Máximo 20 caracteres';
  if (norm !== name.trim().toLowerCase()) return 'Solo letras, números y guión bajo';
  return null;
}

export async function isUsernameAvailable(name) {
  const norm = normalizeUsername(name);
  const snap = await getDoc(doc(db, 'usernames', norm));
  return !snap.exists();
}

function genFriendCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
  let code = '';
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code.slice(0,3) + '-' + code.slice(3);
}

// Crea el username + friendCode de forma atómica. Lanza error si ya existe.
export async function claimUsername(uid, rawName) {
  const err = validateUsername(rawName);
  if (err) throw new Error(err);
  const norm = normalizeUsername(rawName);
  const displayUsername = rawName.trim();
  const friendCode = genFriendCode();

  await runTransaction(db, async (tx) => {
    const unameRef = doc(db, 'usernames', norm);
    const unameSnap = await tx.get(unameRef);
    if (unameSnap.exists()) throw new Error('Ese nombre de usuario ya está en uso');

    const userRef = doc(db, 'users', uid);
    tx.set(unameRef, { uid, username: displayUsername });
    tx.set(userRef, {
      username: displayUsername,
      username_lower: norm,
      friendCode,
      friends: [],
      createdAt: serverTimestamp()
    }, { merge: true });
  });

  return { username: displayUsername, friendCode };
}

export async function getMyProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    username: d.username || null,
    friendCode: d.friendCode || null,
    friends: d.friends || [],
    totalStars: parseInt(d.dhv_total_stars || '0'),
  };
}

// ══════════════════════════════════════════════════════════
// BÚSQUEDA Y AMISTADES
// ══════════════════════════════════════════════════════════
export async function searchUserByUsername(name) {
  const norm = normalizeUsername(name);
  if (!norm) return null;
  const snap = await getDoc(doc(db, 'usernames', norm));
  if (!snap.exists()) return null;
  const { uid } = snap.data();
  const profile = await getMyProfile(uid);
  return profile ? { uid, ...profile } : null;
}

export async function findUserByFriendCode(code) {
  const cleaned = code.trim().toUpperCase();
  const q = query(collection(db, 'users'), where('friendCode', '==', cleaned), fbLimit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  const d = docSnap.data();
  return { uid: docSnap.id, username: d.username, friendCode: d.friendCode, totalStars: parseInt(d.dhv_total_stars||'0') };
}

// Solicitudes de amistad: subcolección users/{uid}/friendRequests/{fromUid}
export async function sendFriendRequest(myUid, myUsername, targetUid) {
  if (myUid === targetUid) throw new Error('No podés agregarte a vos mismo');
  const reqRef = doc(db, 'users', targetUid, 'friendRequests', myUid);
  await setDoc(reqRef, { fromUid: myUid, fromUsername: myUsername, sentAt: serverTimestamp() });
}

export async function listFriendRequests(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'friendRequests'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function listenFriendRequests(uid, cb) {
  return onSnapshot(collection(db, 'users', uid, 'friendRequests'), (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function acceptFriendRequest(myUid, fromUid, fromUsername, myUsername) {
  // Cada usuario solo puede escribir su propio doc (reglas de seguridad).
  // 1) Yo agrego al otro a MI lista de amigos.
  await updateDoc(doc(db, 'users', myUid), { friends: arrayUnion(fromUid) });
  // 2) Borro la solicitud de mi bandeja.
  await deleteDoc(doc(db, 'users', myUid, 'friendRequests', fromUid));
  // 3) Le aviso al otro usuario (vía una solicitud "aceptada" en su propia bandeja)
  //    para que ÉL agregue mi uid a SU lista de amigos la próxima vez que la procese.
  await setDoc(doc(db, 'users', fromUid, 'friendRequests', myUid), {
    fromUid: myUid, fromUsername: myUsername, sentAt: serverTimestamp(), autoAccept: true
  });
}

export async function addFriendToMyList(myUid, friendUid) {
  await updateDoc(doc(db, 'users', myUid), { friends: arrayUnion(friendUid) });
}

export async function rejectFriendRequest(myUid, fromUid) {
  await deleteDoc(doc(db, 'users', myUid, 'friendRequests', fromUid));
}

export async function removeFriend(myUid, friendUid) {
  // Solo puedo modificar mi propio documento. Quito al amigo de mi lista.
  await updateDoc(doc(db, 'users', myUid), { friends: arrayRemove(friendUid) });
}

export async function getFriendsList(uid) {
  const profile = await getMyProfile(uid);
  if (!profile || !profile.friends.length) return [];
  const friends = await Promise.all(profile.friends.map(async fid => {
    const p = await getMyProfile(fid);
    return p ? { uid: fid, ...p } : null;
  }));
  return friends.filter(Boolean);
}

// ══════════════════════════════════════════════════════════
// DESAFÍOS 1vs1
// Colección "challenges": { id, type, fromUid, toUid, fromUsername, toUsername,
//   durationDays, startedAt, endsAt, status: 'pending'|'active'|'finished'|'declined',
//   fromProgress, toProgress, fromStartSnapshot, toStartSnapshot, winnerUid }
// ══════════════════════════════════════════════════════════
export const CHALLENGE_TYPES = {
  streak:    { label: 'Racha más larga',         icon: '🔥', metricKey: 'streak' },
  stars:     { label: 'Más estrellas ganadas',    icon: '⭐', metricKey: 'starsGained' },
  completed: { label: 'Más actividades completadas', icon: '✅', metricKey: 'actsCompleted' },
  perfect:   { label: 'Más días perfectos (100%)', icon: '🏆', metricKey: 'perfectDays' },
};

export async function createChallenge(fromUid, fromUsername, toUid, toUsername, type, durationDays) {
  const ref = doc(collection(db, 'challenges'));
  const now = Date.now();
  await setDoc(ref, {
    id: ref.id,
    type,
    fromUid, fromUsername,
    toUid, toUsername,
    durationDays,
    status: 'pending',
    createdAt: serverTimestamp(),
    createdAtMs: now,
    fromProgress: 0,
    toProgress: 0,
  });
  return ref.id;
}

export async function listMyChallenges(uid) {
  const qFrom = query(collection(db, 'challenges'), where('fromUid', '==', uid));
  const qTo = query(collection(db, 'challenges'), where('toUid', '==', uid));
  const [snapFrom, snapTo] = await Promise.all([getDocs(qFrom), getDocs(qTo)]);
  const all = [...snapFrom.docs, ...snapTo.docs].map(d => ({ id: d.id, ...d.data() }));
  // dedupe
  const seen = new Set();
  return all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
}

export function listenMyChallenges(uid, cb) {
  const qFrom = query(collection(db, 'challenges'), where('fromUid', '==', uid));
  const qTo = query(collection(db, 'challenges'), where('toUid', '==', uid));
  const state = { from: [], to: [] };
  const emit = () => {
    const seen = new Set(); const all = [];
    [...state.from, ...state.to].forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); all.push(c); } });
    cb(all);
  };
  const unsub1 = onSnapshot(qFrom, snap => { state.from = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit(); });
  const unsub2 = onSnapshot(qTo, snap => { state.to = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit(); });
  return () => { unsub1(); unsub2(); };
}

export async function acceptChallenge(challengeId, durationDays) {
  const now = Date.now();
  const endsAt = now + durationDays * 86400000;
  await updateDoc(doc(db, 'challenges', challengeId), {
    status: 'active',
    startedAtMs: now,
    endsAtMs: endsAt,
    fromProgress: 0,
    toProgress: 0,
  });
}

export async function declineChallenge(challengeId) {
  await updateDoc(doc(db, 'challenges', challengeId), { status: 'declined' });
}

export async function deleteChallenge(challengeId) {
  await deleteDoc(doc(db, 'challenges', challengeId));
}

// Actualiza el progreso propio dentro de un desafío activo (lo llama cada cliente para sí mismo)
export async function updateChallengeProgress(challengeId, isFromSide, value) {
  const field = isFromSide ? 'fromProgress' : 'toProgress';
  await updateDoc(doc(db, 'challenges', challengeId), { [field]: value });
}

export async function finishChallenge(challengeId, winnerUid) {
  await updateDoc(doc(db, 'challenges', challengeId), { status: 'finished', winnerUid });
}

// Listener en vivo de un desafío puntual (para pantalla de detalle)
export function listenChallenge(challengeId, cb) {
  return onSnapshot(doc(db, 'challenges', challengeId), (snap) => {
    if (snap.exists()) cb({ id: snap.id, ...snap.data() });
  });
}
