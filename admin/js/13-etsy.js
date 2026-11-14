// Kronenwelt Admin – Etsy: Shop verbinden und neue Etsy-Bestellungen in die Tabelle holen
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// ETSY
// Zugang (Keystring + Shared Secret) und Tokens liegen nur im Apps Script. Der Browser bekommt sie nie zu sehen:
// „Verbinden“ holt nur die Anmeldeadresse; Etsy schickt danach einen einmaligen Code zurück an diese Seite,
// den das Apps Script einlöst.
// ============================================================
let etsyStand = '';                                      // '' = unbekannt · 'fehlt' · 'eingerichtet' · 'verbunden' (irgendein Shop)
let etsyKonten = [];                                     // je Shop {konto: '1'|'2', status, shop} – Konto 2 = zweiter Etsy-Shop (ab 1.11)
const ETSY_RUECKKEHR = 'mkw_etsy_rueckkehr';
let etsyMeldung = '';                                    // letzte Fehlermeldung, bleibt in der Etsy-Karte stehen

// Kommt die Seite gerade von Etsy zurück (…/admin.html?code=…&state=…)? Dann Code merken und Adresse sofort aufräumen,
// damit der Code nicht in der Adresszeile oder im Verlauf stehen bleibt. Eingelöst wird er nach der Anmeldung.
(function etsyRueckkehrMerken() {
  const q = new URLSearchParams(location.search);
  if (!q.get('state') || !(q.get('code') || q.get('error'))) return;
  try {
    sessionStorage.setItem(ETSY_RUECKKEHR, JSON.stringify({ code: q.get('code') || '', state: q.get('state'),
      fehler: q.get('error_description') || q.get('error') || '' }));
  } catch (e) { /* ohne Speicher: dann eben neu verbinden */ }
  history.replaceState(null, '', location.pathname + '#einstellungen');
})();

const etsyFehlerText = e => (e.daten && e.daten.text) || apiFehlerText(e);

// Stand vom Apps Script übernehmen (ping oder Antwort von etsyCode/etsyTrennen)
function etsyStandSetzen(r) {
  etsyKonten = (r && r.etsyKonten) || (r && r.konten) || (r && r.etsy ? [{ konto: '1', status: r.etsy, shop: '' }] : []);
  const k1 = etsyKonten.find(k => k.konto === '1');
  etsyStand = etsyKonten.some(k => k.status === 'verbunden') ? 'verbunden' : ((k1 && k1.status) || (r && r.etsy) || '');
}
const etsyKontoStand = k => (etsyKonten.find(x => x.konto === k) || {}).status || '';
const etsyShopName = k => (etsyKonten.find(x => x.konto === k) || {}).shop || '';

function etsyKarteZeigen() {
  const box = document.getElementById('etsyStatus'), knoepfe = document.getElementById('etsyKnoepfe');
  const box2 = document.getElementById('etsyStatus2'), knoepfe2 = document.getElementById('etsyKnoepfe2');
  if (!box || !knoepfe) return;
  const knopf = (text, fn, art) => `<button class="btn ${art || 'btn-teal'}" onclick="${fn}">${text}</button>`;
  if (box2) { box2.textContent = ''; knoepfe2.innerHTML = ''; }
  if (!apiKonfiguriert()) { box.textContent = 'Zuerst oben die Verbindung zur Google-Tabelle einrichten.'; knoepfe.innerHTML = ''; return; }
  const st1 = etsyKontoStand('1') || (etsyStand === 'verbunden' ? 'verbunden' : etsyStand);
  const shop1 = etsyShopName('1') ? ' (' + etsyShopName('1') + ')' : '';
  const gemeinsam = etsyStand === 'verbunden'
    ? knopf('Jetzt abrufen', 'etsyAbrufKlick()') + knopf('Etsy-Artikel abgleichen', 'etsyArtikelKlick()') : '';
  if (st1 === 'verbunden') {
    box.textContent = '✓ Mit dem Etsy-Shop verbunden' + shop1 + '. Neue Etsy-Bestellungen erscheinen unter „Bestellungen“.';
    knoepfe.innerHTML = gemeinsam + knopf('Verbindung trennen', "etsyTrennenKlick('1')", 'btn-outline');
  } else if (st1 === 'eingerichtet') {
    box.textContent = 'Der Etsy-Zugang ist eingetragen. Jetzt einmal bei Etsy den Zugriff auf den Shop erlauben.';
    knoepfe.innerHTML = knopf('Mit Etsy verbinden', "etsyVerbindenKlick('1')", 'btn-primary') + gemeinsam;
  } else if (st1 === 'fehlt') {
    box.textContent = 'Der Etsy-Zugang fehlt noch: ETSY_KEYSTRING und ETSY_SECRET in den Skript-Eigenschaften des Apps Script eintragen.';
    knoepfe.innerHTML = knopf('Erneut prüfen', 'etsyPruefen()');
  } else {
    box.textContent = 'Das Apps Script kennt Etsy noch nicht. Bitte die neue Version (ab 1.9) bereitstellen.';
    knoepfe.innerHTML = knopf('Erneut prüfen', 'etsyPruefen()');
  }
  if (etsyMeldung) box.textContent = '⚠ ' + etsyMeldung + ' ' + box.textContent;
  // Zweiter Shop (eigene Etsy-App im zweiten Etsy-Konto)
  const st2 = etsyKontoStand('2');
  if (!box2 || !st2) return;
  if (st2 === 'verbunden') {
    box2.textContent = '✓ Zweiter Etsy-Shop verbunden' + (etsyShopName('2') ? ' (' + etsyShopName('2') + ')' : '') + '.';
    knoepfe2.innerHTML = knopf('Zweiten Shop trennen', "etsyTrennenKlick('2')", 'btn-outline');
  } else if (st2 === 'eingerichtet') {
    box2.textContent = 'Zweiter Etsy-Shop: Zugang ist eingetragen. Vorher bei Etsy mit dem Konto des zweiten Shops anmelden, dann verbinden.';
    knoepfe2.innerHTML = knopf('Zweiten Shop verbinden', "etsyVerbindenKlick('2')", 'btn-primary');
  } else {
    box2.textContent = 'Zweiter Etsy-Shop (z. B. Sternenstaubhandmade): ETSY2_KEYSTRING und ETSY2_SECRET in den Skript-Eigenschaften eintragen.';
  }
}

async function etsyPruefen() {
  if (!apiKonfiguriert()) { etsyStand = ''; etsyKonten = []; etsyKarteZeigen(); return; }
  try { etsyStandSetzen(await schnittstelle('ping')); } catch (e) { etsyStand = ''; etsyKonten = []; }
  etsyKarteZeigen();
}

async function etsyVerbindenKlick(konto) {
  try {
    const r = await schnittstelle('etsyStart', { konto: konto || '1' });
    if (!/^https:\/\/www\.etsy\.com\/oauth\/connect\?/.test(r.url || '')) throw new Error('unerwartete Adresse');
    location.href = r.url;                                // weiter zu Etsy; zurück kommt die Seite mit ?code=…
  } catch (e) { showStatus(etsyFehlerText(e), 'error'); }
}

// Nach der Anmeldung: einen gemerkten Code von Etsy einlösen
async function etsyRueckkehrEinloesen() {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem(ETSY_RUECKKEHR) || 'null'); sessionStorage.removeItem(ETSY_RUECKKEHR); } catch (e) { r = null; }
  if (!r) return;
  if (!r.code) {
    etsyMeldung = 'Etsy hat den Zugriff nicht erlaubt' + (r.fehler ? ' (' + r.fehler + ')' : '') + '.';
    showStatus(etsyMeldung, 'error'); etsyKarteZeigen(); return;
  }
  await zugaengePruefen();                                // erst den Stand vom Start abwarten, sonst überschreibt er „verbunden“
  try {
    const a = await schnittstelle('etsyCode', { code: r.code, state: r.state });
    if (a.konten) etsyStandSetzen(a); else etsyStand = 'verbunden';
    etsyMeldung = '';
    etsyKarteZeigen();
    showStatus('Etsy ist verbunden ✓' + (a.shopName ? ' (' + a.shopName + ')' : '') + ' Neue Etsy-Bestellungen kommen ab jetzt in die Tabelle.');
  } catch (e) {
    etsyMeldung = etsyFehlerText(e);
    showStatus(etsyMeldung, 'error');
    etsyPruefen();
  }
}

// Neue Etsy-Bestellungen holen. still = true: ohne Meldung, wenn nichts Neues da ist (beim „Aktualisieren“)
async function etsyHolen(still) {
  if (etsyStand !== 'verbunden') return 0;
  try {
    const r = await schnittstelle('etsyAbruf');
    if (r.neu) showStatus(r.neu === 1 ? '1 neue Etsy-Bestellung übernommen ✓' : r.neu + ' neue Etsy-Bestellungen übernommen ✓');
    else if (!still) showStatus('Keine neuen Etsy-Bestellungen.');
    return r.neu || 0;
  } catch (e) {
    if (e.message === 'etsy_anmeldung' || e.message === 'etsy_nicht_verbunden') { etsyMeldung = etsyFehlerText(e); etsyPruefen(); }
    showStatus('Etsy: ' + etsyFehlerText(e), 'error');
    return 0;
  }
}

async function etsyAbrufKlick() {
  if (await etsyHolen(false)) ladeBestellungen(true);
}

// Blatt „Etsy-Artikel“ in der Google-Tabelle auffüllen: je Etsy-Artikel eine Zeile, in der die passende Krone steht
async function etsyArtikelKlick() {
  try {
    const r = await schnittstelle('etsyArtikel');
    etsyMeldung = '';
    showStatus(r.gesamt + ' Etsy-Artikel im Blatt „Etsy-Artikel“' + (r.neu ? ' (' + r.neu + ' neu)' : '')
      + (r.offen ? ', ' + r.offen + ' noch ohne Krone.' : ', alle zugeordnet ✓'));
  } catch (e) {
    showStatus('Etsy: ' + etsyFehlerText(e), 'error');
  }
}

async function etsyTrennenKlick(konto) {
  const shop = etsyShopName(konto || '1');
  if (!confirm('Verbindung zu Etsy' + (shop ? ' (' + shop + ')' : '') + ' trennen? Schon übernommene Bestellungen bleiben erhalten.')) return;
  try {
    const r = await schnittstelle('etsyTrennen', { konto: konto || '1' });
    if (r.konten) etsyStandSetzen(r); else etsyStand = r.etsy || 'eingerichtet';
    showStatus('Etsy ist getrennt.');
  }
  catch (e) { showStatus(etsyFehlerText(e), 'error'); }
  etsyKarteZeigen();
}

// Knopf „Aktualisieren“ bei den Bestellungen: erst Etsy fragen, dann die Tabelle neu laden
async function bestellungenAktualisieren() {
  const neu = await etsyHolen(true);
  await ladeBestellungen(true);
  if (neu) showStatus(neu === 1 ? '1 neue Etsy-Bestellung übernommen ✓' : neu + ' neue Etsy-Bestellungen übernommen ✓');
}
