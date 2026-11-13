// Kronenwelt Admin – Anmeldung, Verschlüsselung im Browser, Zugänge im Apps Script
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// LOGIN
// ============================================================
// ============================================================
// VERSCHLÜSSELUNG (Web Crypto API)
// Token wird mit dem Admin-Passwort als Schlüssel verschlüsselt
// ============================================================
async function deriveKey(password) {
  const enc  = new TextEncoder();
  const raw  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('mkw_salt_2024'), iterations: 100000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptToken(token, password) {
  const key = await deriveKey(password);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  // IV + verschlüsselte Daten als Base64 speichern
  const combined = new Uint8Array(iv.length + buf.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(buf), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptToken(encrypted, password) {
  try {
    const key     = await deriveKey(password);
    const bytes   = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const iv      = bytes.slice(0, 12);
    const data    = bytes.slice(12);
    const buf     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(buf);
  } catch {
    return null; // Falsches Passwort oder korrupte Daten
  }
}

// Aktuell eingeloggtes Passwort (nur im Speicher)
let _sessionPw = '';
// Passwort-Prüfung ohne gespeichertes Passwort: ein mit dem Passwort verschlüsselter Prüftext
const PW_PRUEF = 'mkw_pw_pruef', PW_MERKEN = 'mkw_angemeldet', PW_PRUEFTEXT = 'kronenwelt-ok';
const passwortGesetzt = () => !!localStorage.getItem(PW_PRUEF);
async function passwortPruefen(pw) {
  const pruef = localStorage.getItem(PW_PRUEF);
  return !!pw && !!pruef && (await decryptToken(pruef, pw)) === PW_PRUEFTEXT;
}
async function passwortEinrichten(pw, merken) {
  localStorage.setItem(PW_PRUEF, await encryptToken(PW_PRUEFTEXT, pw));
  localStorage.removeItem('mkw_admin_pw');
  if (merken) localStorage.setItem(PW_MERKEN, pw); else localStorage.removeItem(PW_MERKEN);
}
function loginMaske() {
  const neu = !passwortGesetzt();
  document.getElementById('loginText').textContent = neu
    ? 'Willkommen! Lege zuerst ein Passwort für den Admin auf diesem Gerät fest (mindestens 8 Zeichen).'
    : 'Bitte melde dich an, um den Shop zu verwalten.';
  document.getElementById('loginPassword2').style.display = neu ? '' : 'none';
  document.getElementById('loginKnopf').textContent = neu ? 'Passwort festlegen' : 'Einloggen';
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminScreen').style.display = 'none';
}
function loginFehler(t) { const e = document.getElementById('loginError'); e.textContent = t; e.style.display = 'block'; }

async function tryLogin() {
  const pw = document.getElementById('loginPassword').value;
  const merken = document.getElementById('loginMerken').checked;
  if (!passwortGesetzt()) {
    if (pw.length < 8) { loginFehler('Bitte mindestens 8 Zeichen.'); return; }
    if (pw !== document.getElementById('loginPassword2').value) { loginFehler('Die beiden Passwörter sind nicht gleich.'); return; }
  } else if (!(await passwortPruefen(pw))) {
    await new Promise(r => setTimeout(r, 600));
    loginFehler('Falsches Passwort. Bitte nochmal versuchen.');
    return;
  }
  await passwortEinrichten(pw, merken);
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginPassword2').value = '';
  anmelden(pw);
}

function anmelden(pw) {
  _sessionPw = pw;
  serverZugang = null;
  const altToken = localStorage.getItem('mkw_github_token');   // sehr alter Stand: Token im Klartext → verschlüsseln
  if (altToken) encryptToken(altToken, pw).then(enc => { localStorage.setItem('mkw_github_token_enc', enc); localStorage.removeItem('mkw_github_token'); });
  document.getElementById('settingsCloudName').value = localStorage.getItem('mkw_cl_name') || 'dw6amyijc';
  document.getElementById('settingsApiKey').value    = localStorage.getItem('mkw_cl_key') || '';
  document.getElementById('settingsApiSecret').value = localStorage.getItem('mkw_cl_secret') || '';
  document.getElementById('settingsToken').value     = localStorage.getItem('mkw_github_token_enc') ? '(verschlüsselt gespeichert)' : '';
  document.getElementById('settingsApiUrl').value = apiUrl();
  if (apiKonfiguriert()) document.getElementById('settingsApiSchluessel').value = '(verschlüsselt gespeichert)';
  document.getElementById('settingsMerken').checked = !!localStorage.getItem(PW_MERKEN);
  document.getElementById('loginScreen').style.display  = 'none';
  document.getElementById('adminScreen').style.display  = 'block';
  baueNavigation();
  seiteAusAdresse();
  loadCurrentData();
  etsyKarteZeigen();
  etsyRueckkehrEinloesen();
}

function logout() {
  _sessionPw = '';
  localStorage.removeItem(PW_MERKEN);                     // abmelden = nicht mehr angemeldet bleiben
  document.getElementById('loginPassword').value = '';
  loginMaske();
}

// Hat das Apps Script die Zugänge zu GitHub und Cloudinary (ab 1.8)? Dann gehören sie nicht mehr in den Browser.
let serverZugang = null;
async function zugaengePruefen() {
  if (serverZugang) return serverZugang;
  if (!apiKonfiguriert()) return { github: false, cloudinary: false };
  try {
    const r = await schnittstelle('ping');
    serverZugang = { github: r.github === 'eingerichtet', cloudinary: r.cloudinary === 'eingerichtet' };
    etsyStand = r.etsy || '';
  } catch (e) {
    return { github: false, cloudinary: false };          // nicht merken: beim nächsten Mal neu fragen
  }
  if (serverZugang.github) { localStorage.removeItem('mkw_github_token_enc'); localStorage.removeItem('mkw_github_token'); }
  if (serverZugang.cloudinary) { localStorage.removeItem('mkw_cl_key'); localStorage.removeItem('mkw_cl_secret'); }
  zugangsKartenZeigen();
  etsyKarteZeigen();
  return serverZugang;
}
function zugangsKartenZeigen() {
  const z = serverZugang || {};
  const zeig = (id, an) => { const el = document.getElementById(id); if (el) el.style.display = an ? '' : 'none'; };
  zeig('githubServer', z.github); zeig('githubAlt', !z.github);
  zeig('cloudServer', z.cloudinary); zeig('cloudAlt', !z.cloudinary);
}

// GitHub API: Token entschlüsselt holen
async function getToken() {
  const enc = localStorage.getItem('mkw_github_token_enc');
  if (enc && _sessionPw) return await decryptToken(enc, _sessionPw);
  // Fallback: alter Klartext-Token (Migration)
  return localStorage.getItem('mkw_github_token') || '';
}
