/* ======================================================================
   SECURITY QUEST : DATABASE LAYER
   ----------------------------------------------------------------------
   Everything that reads or writes saved data lives in this file.
   game.js only calls the functions exposed on window.SecurityQuestDB at
   the bottom; it never touches Firebase, localStorage or passwords.

   TWO BACKENDS, ONE API
     "firebase" : Firebase Authentication (login) + Cloud Firestore (save data).
                  Used automatically when js/firebase-config.js holds a real
                  config and the Firebase SDK loaded. Progress follows the
                  player to any device.
     "local"    : the old browser-only save (localStorage). Used when Firebase
                  is not set up yet or cannot load, so the game always runs.

   FIRESTORE LAYOUT
     players/{uid}   one document per player (uid = Firebase Auth user id)
       {
         credentials:   { username, createdAt, lastLogin, logins },
         character:     null | { skin, face, hair, hairColor, shirt, pants, badge, name },
         progress:      { stages: { <levelId>: { easy, medium, hard } },
                          unlocked: { <levelId>: true } },
         rewards:       { coins, lifetime, spent },
         inventory:     { owned: [], equipped: { outfit, badge } },
         notifications: [ { id, type, title, body, ts, read } ],
         settings:      { audio }
       }
     Each stage record: { cleared, bestCorrect, bestStars, bestTime, plays }

   LOGIN: players type a username; Firebase Auth needs an email, so the
   username is turned into  <username>@securityquest.game  behind the scenes.
   That address is never emailed, it is only an account id.

   SAVING: saveUser() is synchronous for the game. It keeps a snapshot and
   writes it to Firestore a moment later (debounced), on logout, and when the
   tab is hidden or closed.

   LOAD ORDER (index.html): Firebase SDK -> firebase-config.js -> this file -> game.js
   ====================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
     1. CONFIGURATION
     ------------------------------------------------------------------ */
  const DB_KEY        = 'securityQuestDB';          // local backend
  const DB_VERSION    = 2;
  const LEGACY_KEY    = 'sentinelProfiles';          // very old save format, imported once
  const LAST_USER_KEY = 'securityQuestLastUser';     // remembers the name for the sign-in box
  const DIFF_IDS      = ['easy', 'medium', 'hard'];
  const COLLECTION    = 'players';
  const EMAIL_DOMAIN  = 'securityquest.game';

  let levelIds = [];            // ordered posting ids, set by init()
  let mode = 'local';           // 'local' | 'firebase'
  let fb = null;                // { auth, db } once Firebase is ready
  let session = null;           // { uid, username } while signed in (firebase mode)

  function configLooksReal(c){
    const bad = v => !v || /^(PASTE|YOUR_)/i.test(String(v));
    return !!c && !bad(c.apiKey) && !bad(c.projectId);
  }
  function setupFirebase(){
    const cfg = global.SQ_FIREBASE_CONFIG;
    if (!global.firebase || !configLooksReal(cfg)) { mode = 'local'; return; }
    try {
      if (!global.firebase.apps.length) global.firebase.initializeApp(cfg);
      const auth = global.firebase.auth();
      const db = global.firebase.firestore();
      // the game always asks for a password at the sign-in screen, so do not keep the session between visits
      auth.setPersistence(global.firebase.auth.Auth.Persistence.NONE).catch(function(){});
      fb = { auth: auth, db: db };
      mode = 'firebase';
    } catch (e) {
      console.warn('Firebase could not start, using the local save instead.', e);
      fb = null; mode = 'local';
    }
  }

  function init(options) {
    levelIds = (options && options.levelIds) ? options.levelIds.slice() : [];
    setupFirebase();
  }

  /* ------------------------------------------------------------------
     2. RECORD FACTORIES (what a brand new record looks like)
     ------------------------------------------------------------------ */
  function emptyStage() {
    return { cleared: false, bestCorrect: 0, bestStars: 0, bestTime: null, plays: 0 };
  }

  function blankProgress() {
    const stages = {};
    levelIds.forEach(id => {
      stages[id] = { easy: emptyStage(), medium: emptyStage(), hard: emptyStage() };
    });
    const unlocked = {};
    if (levelIds.length) unlocked[levelIds[0]] = true;
    return { stages, unlocked };
  }

  function makeNote(type, title, body) {
    return {
      id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type, title, body, ts: Date.now(), read: false
    };
  }

  function blankUser(username, salt, hash) {
    return {
      credentials: { username, salt, hash, createdAt: Date.now(), lastLogin: null, logins: 0 },
      character: null,
      progress: blankProgress(),
      rewards: { coins: 0, lifetime: 0, spent: 0 },
      inventory: { owned: [], equipped: { outfit: null, badge: null } },
      notifications: [],
      settings: { audio: true }
    };
  }

  // Fills in any field an older save is missing, so new features never crash on old accounts.
  function normaliseUser(u) {
    u.credentials = u.credentials || {};
    u.progress = u.progress || blankProgress();
    u.progress.stages = u.progress.stages || {};
    levelIds.forEach(id => {
      const s = u.progress.stages[id] = u.progress.stages[id] || {};
      DIFF_IDS.forEach(d => { s[d] = Object.assign(emptyStage(), s[d] || {}); });
    });
    u.progress.unlocked = u.progress.unlocked || {};
    if (levelIds.length) u.progress.unlocked[levelIds[0]] = true;
    u.rewards = Object.assign({ coins: 0, lifetime: 0, spent: 0 }, u.rewards || {});
    u.inventory = Object.assign({ owned: [], equipped: {} }, u.inventory || {});
    u.inventory.owned = u.inventory.owned || [];
    u.inventory.equipped = Object.assign({ outfit: null, badge: null }, u.inventory.equipped || {});
    u.notifications = u.notifications || [];
    u.settings = Object.assign({ audio: true }, u.settings || {});
    return u;
  }

  // Firestore rejects "undefined", so every record goes through JSON first
  function clean(rec) { return JSON.parse(JSON.stringify(rec)); }

  /* ------------------------------------------------------------------
     3. LOCAL BACKEND (browser localStorage) - also the fallback
     ------------------------------------------------------------------ */
  function makeSalt() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  // Lightweight salted digest. Enough to keep passwords out of plain sight in devtools;
  // not a substitute for real authentication (that is what firebase mode is for).
  function hashPassword(pw, salt) {
    const s = salt + '::' + pw + '::securityquest';
    let a = 0x811c9dc5, b = 0x1505;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619) >>> 0;
      b = (Math.imul(b, 33) + c) >>> 0;
    }
    for (let round = 0; round < 600; round++) {
      a = Math.imul(a ^ (b >>> 7), 16777619) >>> 0;
      b = Math.imul(b ^ (a >>> 5), 2246822519) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }

  function migrateLegacy(db) {
    let old = null;
    try { old = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch (e) { old = null; }
    if (!old || typeof old !== 'object') return;
    Object.keys(old).forEach(name => {
      if (db.users[name]) return;
      const p = old[name] || {};
      const salt = makeSalt();
      const u = blankUser(name, salt, hashPassword(p.password || '', salt));
      u.character = p.character || null;
      (p.completedLevels || []).forEach((done, i) => {
        const id = levelIds[i];
        if (id && done) { u.progress.stages[id].easy.cleared = true; u.progress.stages[id].easy.bestStars = 1; }
      });
      (p.unlockedLevels || []).forEach((open, i) => {
        const id = levelIds[i];
        if (id && open) u.progress.unlocked[id] = true;
      });
      u.notifications.unshift(makeNote('info', 'Old save imported',
        'Your earlier progress was carried into the new account database.'));
      db.users[name] = u;
    });
  }
  function localWrite(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
    catch (e) { return false; }
  }
  function localRead() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { db = null; }
    if (!db || typeof db !== 'object' || !db.users) {
      db = { version: DB_VERSION, users: {}, lastUser: null };
      migrateLegacy(db);
      localWrite(db);
    }
    db.version = DB_VERSION;
    Object.keys(db.users).forEach(k => normaliseUser(db.users[k]));
    return db;
  }

  function localRegister(username, password) {
    const db = localRead();
    if (db.users[username]) return { ok: false, error: 'That username is taken — log in instead.' };
    const salt = makeSalt();
    const rec = blankUser(username, salt, hashPassword(password, salt));
    rec.notifications.unshift(makeNote('info', 'Account created',
      'Clear postings to earn credits, then spend them in the supply room.'));
    db.users[username] = rec;
    db.lastUser = username;
    localWrite(db);
    return { ok: true };
  }
  function localVerify(username, password) {
    const rec = localRead().users[username];
    if (!rec) return { ok: false, error: 'No account with that username — register to create one.' };
    if (rec.credentials.hash !== hashPassword(password, rec.credentials.salt)) {
      return { ok: false, error: 'That password does not match this account.' };
    }
    return { ok: true };
  }
  function localRecordLogin(username) {
    const db = localRead();
    const u = normaliseUser(db.users[username]);
    u.credentials.lastLogin = Date.now();
    u.credentials.logins = (u.credentials.logins || 0) + 1;
    db.users[username] = u;
    db.lastUser = username;
    localWrite(db);
    return u;
  }
  function localSave(username, userData) {
    const db = localRead();
    db.users[username] = userData;
    db.lastUser = username;
    return localWrite(db);
  }

  /* ------------------------------------------------------------------
     4. FIREBASE BACKEND
     ------------------------------------------------------------------ */
  const emailFor = username => String(username).trim().toLowerCase() + '@' + EMAIL_DOMAIN;

  function friendlyError(e) {
    const code = (e && e.code) || '';
    switch (code) {
      case 'auth/email-already-in-use': return 'That username is taken — log in instead.';
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/user-not-found':
      case 'auth/wrong-password':       return 'Wrong username or password.';
      case 'auth/weak-password':        return 'Passwords need at least 6 characters.';
      case 'auth/invalid-email':        return 'That username has characters that cannot be used. Use letters, numbers, dot, dash or underscore.';
      case 'auth/too-many-requests':    return 'Too many attempts. Wait a minute and try again.';
      case 'auth/network-request-failed': return 'No internet connection. Check your network and try again.';
      case 'auth/operation-not-allowed':  return 'Email/Password sign-in is not turned on in Firebase (Authentication → Sign-in method).';
      case 'permission-denied':         return 'Firestore blocked this request. Check the Firestore security rules.';
      case 'unavailable':               return 'Cannot reach the database right now. Try again in a moment.';
    }
    return (e && e.message) ? e.message : 'Something went wrong. Try again.';
  }
  function failure(e) { const err = new Error(friendlyError(e)); err.friendly = err.message; err.code = e && e.code; return err; }

  // if this browser already has a local save for the same name + password, carry it over
  function importLocal(username, password) {
    try {
      const rec = localRead().users[username];
      if (!rec || !rec.credentials) return null;
      if (rec.credentials.hash !== hashPassword(password, rec.credentials.salt)) return null;
      const copy = clean(rec);
      delete copy.credentials.salt; delete copy.credentials.hash;
      normaliseUser(copy);
      copy.notifications.unshift(makeNote('info', 'Progress imported',
        'Your saved progress from this browser was carried into your online account.'));
      return copy;
    } catch (e) { return null; }
  }

  async function fbRegister(username, password) {
    let cred;
    try { cred = await fb.auth.createUserWithEmailAndPassword(emailFor(username), password); }
    catch (e) { return { ok: false, error: friendlyError(e) }; }

    const rec = importLocal(username, password) || blankUser(username);
    rec.credentials = { username: username, createdAt: Date.now(), lastLogin: null, logins: 0 };
    rec.notifications.unshift(makeNote('info', 'Account created',
      'Your progress now saves online. Clear postings to earn credits, then spend them in the supply room.'));
    try {
      await fb.db.collection(COLLECTION).doc(cred.user.uid).set(clean(rec));
    } catch (e) {
      // do not leave a login without a save document behind
      try { await cred.user.delete(); } catch (_) {}
      return { ok: false, error: friendlyError(e) };
    }
    session = { uid: cred.user.uid, username: username };
    setLastUser(username);
    return { ok: true };
  }
  async function fbVerify(username, password) {
    try {
      const cred = await fb.auth.signInWithEmailAndPassword(emailFor(username), password);
      session = { uid: cred.user.uid, username: username };
      return { ok: true };
    } catch (e) { return { ok: false, error: friendlyError(e) }; }
  }
  async function fbRecordLogin(username) {
    if (!session) throw failure({ message: 'Not signed in.' });
    const ref = fb.db.collection(COLLECTION).doc(session.uid);
    let snap;
    try { snap = await ref.get(); } catch (e) { throw failure(e); }
    const rec = normaliseUser(snap.exists ? snap.data() : blankUser(username));
    rec.credentials = Object.assign({}, rec.credentials, {
      username: (rec.credentials && rec.credentials.username) || username,
      lastLogin: Date.now(),
      logins: ((rec.credentials && rec.credentials.logins) || 0) + 1
    });
    delete rec.credentials.salt; delete rec.credentials.hash;
    try { await ref.set(clean(rec)); } catch (e) { throw failure(e); }
    setLastUser(username);
    return rec;
  }

  /* ---- saving: the game calls saveUser() often, so writes are batched ---- */
  let pendingJSON = null, saveTimer = null, retryTimer = null, firstQueuedAt = 0, writing = null, errorShown = false;
  const SAVE_DELAY = 1200, SAVE_MAX_WAIT = 6000, RETRY_DELAY = 10000;

  function status(state, message) {
    if (typeof api.onSyncStatus === 'function') { try { api.onSyncStatus(state, message); } catch (_) {} }
  }
  function queueCloudSave(userData) {
    pendingJSON = JSON.stringify(userData);                  // snapshot now, later changes do not matter
    if (!firstQueuedAt) firstQueuedAt = Date.now();
    clearTimeout(saveTimer);
    if (Date.now() - firstQueuedAt > SAVE_MAX_WAIT) { flushCloud(); return; }
    saveTimer = setTimeout(flushCloud, SAVE_DELAY);
  }
  async function flushCloud() {
    clearTimeout(saveTimer); saveTimer = null;
    if (writing) { await writing; }                          // one write at a time, newest snapshot wins
    if (!pendingJSON || !session || !fb) return;
    const payload = pendingJSON, uid = session.uid;
    pendingJSON = null; firstQueuedAt = 0;
    status('saving');
    writing = fb.db.collection(COLLECTION).doc(uid).set(JSON.parse(payload)).then(function () {
      errorShown = false; status('saved');
    }).catch(function (e) {
      if (!pendingJSON) pendingJSON = payload;               // keep it and try again later
      if (!errorShown) { errorShown = true; status('error', friendlyError(e)); }
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flushCloud, RETRY_DELAY);
    }).then(function () { writing = null; });
    await writing;
  }

  function setLastUser(name) { try { localStorage.setItem(LAST_USER_KEY, name); } catch (e) {} }

  // save when the tab is hidden or closed (a mobile browser may never fire "beforeunload")
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && mode === 'firebase') flushCloud();
    });
  }
  if (global.addEventListener) {
    global.addEventListener('pagehide', function () { if (mode === 'firebase') flushCloud(); });
    global.addEventListener('beforeunload', function () { if (mode === 'firebase') flushCloud(); });
  }

  /* ------------------------------------------------------------------
     5. PUBLIC ACCOUNT API (the same calls work in both modes)
     ------------------------------------------------------------------ */
  // text for the sign-in note under the form
  function describeBackend() {
    return mode === 'firebase'
      ? 'Your progress is saved online to your account, so you can sign in from any device.'
      : 'Progress is saved in this browser only. Set up Firebase to save online (see FIREBASE_SETUP.md).';
  }

  // returns an error message, or '' when the name and password are acceptable for a NEW account
  function checkCredentials(username, password) {
    if (mode === 'firebase') {
      if (!/^[A-Za-z0-9._-]{3,20}$/.test(username)) return 'Username: 3 to 20 letters, numbers, dots, dashes or underscores.';
      if (String(password).length < 6) return 'Passwords need at least 6 characters.';
    } else {
      if (username.length < 3) return 'Usernames need at least 3 characters.';
      if (String(password).length < 4) return 'Passwords need at least 4 characters.';
    }
    return '';
  }

  function getLastUser() {
    try { const v = localStorage.getItem(LAST_USER_KEY); if (v) return v; } catch (e) {}
    return mode === 'local' ? (localRead().lastUser || null) : null;
  }

  async function register(username, password) {
    const r = mode === 'firebase' ? await fbRegister(username, password) : localRegister(username, password);
    if (r.ok) setLastUser(username);
    return r;
  }
  async function verifyLogin(username, password) {
    return mode === 'firebase' ? fbVerify(username, password) : localVerify(username, password);
  }
  // Called once a login/registration succeeds: loads the save and returns the full record.
  async function recordLogin(username) {
    const u = mode === 'firebase' ? await fbRecordLogin(username) : localRecordLogin(username);
    setLastUser(username);
    return u;
  }
  // synchronous on purpose: the game saves constantly. Online writes are batched behind the scenes.
  function saveUser(username, userData) {
    if (!username || !userData) return false;
    if (mode === 'firebase') {
      if (!session) return false;
      queueCloudSave(userData);
      setLastUser(username);
      return true;
    }
    setLastUser(username);
    return localSave(username, userData);
  }
  // writes anything still waiting, then signs out (firebase mode); a no-op in local mode
  async function logout() {
    if (mode !== 'firebase') return;
    try { await flushCloud(); } catch (_) {}
    session = null; pendingJSON = null; firstQueuedAt = 0;
    clearTimeout(saveTimer); clearTimeout(retryTimer);
    try { await fb.auth.signOut(); } catch (_) {}
  }

  /* ------------------------------------------------------------------
     6. PROGRESS QUERIES (pure reads on a user record)
     ------------------------------------------------------------------ */
  function stageRecord(user, levelId, diffId) {
    if (!user) return emptyStage();
    return user.progress.stages[levelId][diffId];
  }
  function isLevelCleared(user, i) {
    if (!user) return false;
    const id = levelIds[i];
    return DIFF_IDS.some(d => user.progress.stages[id][d].cleared);
  }
  function isLevelUnlocked(user, i) {
    if (i === 0) return true;
    if (!user) return false;
    if (user.progress.unlocked[levelIds[i]]) return true;
    const prev = levelIds[i - 1];
    return DIFF_IDS.some(d => user.progress.stages[prev][d].cleared);
  }

  /* ------------------------------------------------------------------
     PUBLIC API
     ------------------------------------------------------------------ */
  const api = {
    init,
    get mode() { return mode; },
    describeBackend,
    checkCredentials,
    DIFF_IDS,
    // factories
    emptyStage,
    makeNote,
    // accounts (register / verifyLogin / recordLogin / logout are async)
    getLastUser,
    register,
    verifyLogin,
    recordLogin,
    saveUser,
    logout,
    flush: function () { return mode === 'firebase' ? flushCloud() : Promise.resolve(); },
    // progress queries
    stageRecord,
    isLevelUnlocked,
    isLevelCleared,
    // the game can set this to be told about save problems: (state, message) => {}
    onSyncStatus: null
  };
  global.SecurityQuestDB = api;

})(window);
