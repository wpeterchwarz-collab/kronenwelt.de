// Kronenwelt Admin – Schnittstelle zum Apps Script (Bestelltabelle)
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// SCHNITTSTELLE (Apps Script der Bestelltabelle)
// Adresse + Admin-Schlüssel stehen nur hier im Browser (Schlüssel verschlüsselt mit dem Admin-Passwort).
// ============================================================
const API_URL_STANDARD = 'https://script.google.com/macros/s/AKfycbxBOiDRyRPrbVlW3Pw92bU5TUcSo9ZRuUYk1qIkGodrVYUR71TIjZfNlW-7edFOL4el/exec';
const apiUrl = () => localStorage.getItem('mkw_api_url') || API_URL_STANDARD;
const apiKonfiguriert = () => !!localStorage.getItem('mkw_api_schluessel_enc');
async function apiSchluessel() {
  const enc = localStorage.getItem('mkw_api_schluessel_enc');
  if (!enc || !_sessionPw) return '';
  try { return await decryptToken(enc, _sessionPw); } catch (e) { return ''; }
}
// Eine Anfrage an die Schnittstelle. text/plain, damit der Browser ohne Vorab-Anfrage senden darf.
async function schnittstelle(aktion, extra) {
  const schluessel = await apiSchluessel();
  if (!schluessel) throw new Error('kein_schluessel');
  const res = await fetch(apiUrl(), {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ aktion, schluessel }, extra || {}))
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const r = await res.json();
  if (!r.ok) { const e = new Error(r.fehler || 'fehler'); e.daten = r; throw e; }
  return r;
}
const apiFehlerText = e => e.message === 'nicht_erlaubt' ? 'Der Admin-Schlüssel stimmt nicht. Bitte in den Einstellungen prüfen.'
  : e.message === 'kein_schluessel' ? 'Noch kein Admin-Schlüssel eingetragen.'
  : e.message === 'unbekannte_aktion' ? 'Das Apps Script ist noch die alte Version. Bitte neue Version bereitstellen.'
  : 'Die Tabelle ist gerade nicht erreichbar (' + e.message + ').';

async function saveSchnittstelle() {
  const url = document.getElementById('settingsApiUrl').value.trim();
  const sch = document.getElementById('settingsApiSchluessel').value.trim();
  const box = document.getElementById('schnittstelleStatus');
  if (url) localStorage.setItem('mkw_api_url', url);
  if (sch && sch !== '(verschlüsselt gespeichert)') {
    localStorage.setItem('mkw_api_schluessel_enc', await encryptToken(sch, _sessionPw));
    document.getElementById('settingsApiSchluessel').value = '(verschlüsselt gespeichert)';
  }
  box.textContent = 'Verbindung wird getestet …';
  serverZugang = null;
  try {
    const r = await schnittstelle('ping');
    zugaengePruefen();
    box.textContent = '✓ Verbunden mit „' + r.tabelle + '“ (Schnittstelle ' + r.version + ').'
      + (r.paypal === 'eingerichtet' ? ' PayPal-Prüfung ist eingerichtet.' : r.paypal === 'fehlt' ? ' PayPal-Prüfung fehlt noch: Zugang im Apps Script eintragen.' : '')
      + (r.serienliste === 'fehlt' ? ' Seriennummernliste fehlt noch (SERIENLISTE_ID).' : r.serienliste === 'fehler' ? ' Seriennummernliste ist nicht erreichbar.' : r.serienliste ? ' Seriennummernliste: zuletzt ' + r.serienliste + '.' : '')
      + (r.github === 'eingerichtet' ? ' GitHub läuft über das Apps Script.' : r.github === 'fehlt' ? ' GitHub-Token noch im Browser (GITHUB_TOKEN im Apps Script fehlt).' : '')
      + (r.cloudinary === 'eingerichtet' ? ' Cloudinary läuft über das Apps Script.' : r.cloudinary === 'fehlt' ? ' Cloudinary-Zugang noch im Browser.' : '');
    bestellungen = null; bestellFehler = '';
    showStatus('Verbindung zur Bestelltabelle steht ✓');
    if (r.github === 'eingerichtet') loadCurrentData();   // erster Start ohne Token im Browser: jetzt die Dateien laden
  } catch (e) {
    box.textContent = apiFehlerText(e);
    showStatus('Verbindung fehlgeschlagen', 'error');
  }
}
