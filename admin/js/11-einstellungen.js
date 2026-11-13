// Kronenwelt Admin – Einstellungen und Start der Seite
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// EINSTELLUNGEN
// ============================================================
async function saveSettings() {
  const token = document.getElementById('settingsToken').value.trim();
  if (!token || token === '(verschlüsselt gespeichert)') { showStatus('Bitte ein Token eintragen.', 'error'); return; }
  localStorage.setItem('mkw_github_token_enc', await encryptToken(token, _sessionPw));
  localStorage.removeItem('mkw_github_token');
  document.getElementById('settingsToken').value = '(verschlüsselt gespeichert)';
  showStatus('Token verschlüsselt gespeichert ✓');
}
// Neues Passwort: alles, was damit verschlüsselt ist, neu verschlüsseln
async function savePasswort() {
  const pw = document.getElementById('settingsPassword').value;
  const merken = document.getElementById('settingsMerken').checked;
  if (pw) {
    if (pw.length < 8) { showStatus('Das Passwort braucht mindestens 8 Zeichen.', 'error'); return; }
    for (const k of ['mkw_api_schluessel_enc', 'mkw_github_token_enc']) {
      const v = localStorage.getItem(k);
      const klar = v ? await decryptToken(v, _sessionPw) : null;
      if (klar) localStorage.setItem(k, await encryptToken(klar, pw));
    }
    _sessionPw = pw;
    document.getElementById('settingsPassword').value = '';
  }
  await passwortEinrichten(_sessionPw, merken);
  showStatus((pw ? 'Neues Passwort gespeichert' : 'Gespeichert') + (merken ? ' ✓ Du bleibst auf diesem Gerät angemeldet.' : ' ✓ Beim nächsten Öffnen wird nach dem Passwort gefragt.'));
}

function saveCloudinarySettings() {
  localStorage.setItem('mkw_cl_name',   document.getElementById('settingsCloudName').value.trim());
  localStorage.setItem('mkw_cl_key',    document.getElementById('settingsApiKey').value.trim());
  localStorage.setItem('mkw_cl_secret', document.getElementById('settingsApiSecret').value.trim());
  showStatus('Cloudinary Einstellungen gespeichert!');
  renderMedien();
}

// ============================================================
// START: angemeldet bleiben, Umstieg von 0.9, sonst Anmeldemaske
// ============================================================
window.addEventListener('load', async () => {
  const alt = localStorage.getItem('mkw_admin_pw');      // bis 0.9 im Klartext gespeichert und immer angemeldet
  if (alt) await passwortEinrichten(alt, true);          // gleiches Verhalten wie bisher, aber ohne Klartext-Passwort
  const gemerkt = localStorage.getItem(PW_MERKEN);
  if (gemerkt && await passwortPruefen(gemerkt)) { anmelden(gemerkt); return; }
  loginMaske();
});
