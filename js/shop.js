/* ============================================================
   MILA'S KRONENWELT – Hauptscript
   Dieses Script steht am Ende von <body> – der DOM ist
   garantiert geladen wenn dieser Code ausgeführt wird.
   ============================================================ */


/* ============================================================
   WARENKORB
   ============================================================ */
let cart = JSON.parse(sessionStorage.getItem('mkw_cart') || '[]');

function saveCart() {
  sessionStorage.setItem('mkw_cart', JSON.stringify(cart));
}

// Text sicher in HTML einsetzen (Warenkorb-Inhalte kommen aus dem Browser-Speicher)
function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Preis eines Warenkorb-Artikels immer aus der Preisliste berechnen – nie dem gespeicherten Wert trauen
function priceFor(item) {
  const m = /^(.+?) \+ (\d+) Pets$/.exec(item.size || '');
  const size = m ? m[1] : item.size;
  const pets = m ? +m[2] : 0;
  const base = (PRICES[item.variant] || {})[size];
  if (typeof base !== 'number') return null;                 // unbekannte Variante/Grösse
  if (isZahl(item.variant)) {
    if (![3, 6, 9].includes(pets)) return null;
    return base + petAufpreis(pets);
  }
  return base;
}
function repriceCart() {
  const before = cart.length;
  cart = cart.filter(i => i && typeof i === 'object')
             .map(i => ({ ...i, price: priceFor(i) }))
             .filter(i => typeof i.price === 'number');
  saveCart();
  updateCartBadge();
  return before - cart.length;   // Anzahl entfernter, ungültiger Artikel
}

function openCart() {
  document.getElementById('cartPanel').classList.add('open');
  document.getElementById('cartOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderCart();
}

function closeCart() {
  document.getElementById('cartPanel').classList.remove('open');
  document.getElementById('cartOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  const count = cart.length;
  badge.textContent = count;
  badge.classList.toggle('visible', count > 0);
}

function renderCart() {
  const container = document.getElementById('cartItems');
  const foot      = document.getElementById('cartFoot');
  const empty     = document.getElementById('cartEmpty');

  if (cart.length === 0) {
    if (empty) empty.style.display = 'block';
    if (foot)  foot.style.display  = 'none';
    container.querySelectorAll('.cart-item').forEach(e => e.remove());
    return;
  }

  if (empty) empty.style.display = 'none';
  if (foot)  foot.style.display  = 'block';

  // Artikel neu rendern
  container.querySelectorAll('.cart-item').forEach(e => e.remove());
  let total = 0;

  cart.forEach((item, idx) => {
    total += item.price;
    const variantMap = (typeof PRODUCT_IMAGES !== 'undefined') ? (PRODUCT_IMAGES[item.variant] || {}) : {};
    const imgSrc = variantMap[item.color] || variantMap['_default'] || '';

    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <div class="cart-item-img">
        ${imgSrc ? `<img src="${esc(imgSrc)}" alt="${esc(item.variant)}">` :
          `<svg width="28" height="24" viewBox="0 0 44 36"><polygon points="22,2 32,14 42,6 38,28 6,28 2,6 12,14" fill="none" stroke="#729599" stroke-width="2.5" stroke-linejoin="round"/></svg>`}
      </div>
      <div class="cart-item-body">
        <div class="cart-item-name">${esc(item.variant)}</div>
        <div class="cart-item-meta">${esc(item.color)} · ${esc(item.size)}</div>
        ${itemPers(item) ? `<div class="cart-item-personalisierung">${esc(itemPers(item))}</div>` : `<div class="cart-item-meta">Ohne Namen</div>`}
        <div class="cart-item-price">${item.price.toFixed(2).replace('.', ',')} €</div>
      </div>
      <button class="cart-item-del" onclick="removeFromCart(${idx})" aria-label="Entfernen">&#x2715;</button>
    `;
    container.appendChild(div);
  });

  const fmt = v => v.toFixed(2).replace('.', ',') + ' €';
  document.getElementById('cartSubtotal').textContent = fmt(total);
  document.getElementById('cartTotal').textContent    = fmt(total);
  // Pflichtinfo vor der Bestellung: kein Widerruf bei personalisierten Kronen
  const legal = document.getElementById('cartLegal');
  if (legal) legal.innerHTML = cart.some(i => i.name)
    ? 'Personalisierte Kronen werden für dich angefertigt und sind vom Widerrufsrecht ausgeschlossen. <a href="widerruf.html">Widerrufsbelehrung</a> · <a href="agb.html">AGB</a>'
    : 'Es gelten unsere <a href="agb.html">AGB</a> und die <a href="widerruf.html">Widerrufsbelehrung</a>.';
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  saveCart();
  updateCartBadge();
  renderCart();
}

function addToCart() {
  if (isZahl()) {
    if (state.numbers.length < state.pets) {
      alert(`Bitte wähle unter Schritt 4 noch ${state.pets - state.numbers.length} Zahl(en) für deine ${state.pets} Zahlenpets.`);
      document.getElementById('petSlots').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  } else if (nameAllowed() && !state.name.trim()) {
    alert('Bitte gib unter Schritt 4 eine Personalisierung ein.');
    document.getElementById('nIn').focus();
    return;
  }

  cart.push({
    variant: state.variant,
    color:   state.color,
    size:    isZahl() ? `${state.size} + ${state.pets} Pets` : state.size,
    name:    !isZahl() && nameAllowed() ? state.name : '',
    zahlen:  isZahl() ? state.numbers.join(', ') : '',
    price:   currentPrice()
  });

  saveCart();
  updateCartBadge();

  // Kurzes visuelles Feedback
  const btn = document.querySelector('.btn-add-cart');
  const orig = btn.innerHTML;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Hinzugefügt!';
  btn.style.background = '#4d6d71';
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.style.background = '';
    openCart();
  }, 800);
}

function buildCartSummaryHTML(total) {
  return cart.map(i =>
    `<div style="padding:4px 0;border-bottom:0.5px solid #e8ddd4;font-size:12px">
      <strong>${esc(i.variant)}</strong> · ${esc(i.color)} · ${esc(i.size)}
      ${itemPers(i) ? `· <span style="color:#729599;letter-spacing:2px">${esc(itemPers(i))}</span>` : '· ohne Namen'}
      <span style="float:right;font-weight:700">${i.price.toFixed(2).replace('.', ',')} €</span>
    </div>`
  ).join('') +
  `<div style="padding:8px 0 2px;font-size:13px">
    Versand: <strong style="color:#4d6d71">Kostenlos</strong>
    <span style="float:right;font-size:16px;font-weight:700;color:#729599">${total.toFixed(2).replace('.', ',')} €</span>
  </div>`;
}

function sendOrderEmails(details, total) {
  const shipping = details.purchase_units?.[0]?.shipping?.address;
  const lieferadresse = shipping
    ? [shipping.address_line_1, shipping.address_line_2, shipping.postal_code + ' ' + shipping.admin_area_2, shipping.country_code]
        .filter(Boolean).join(', ')
    : 'Nicht angegeben';
  const emailParams = {
    variante:      cart.map(i => i.variant).join(', '),
    farbe:         cart.map(i => i.color).join(', '),
    groesse:       cart.map(i => i.size).join(', '),
    hundename:     cart.map(i => itemPers(i) || 'ohne Namen').join(' | '),
    preis:         total.toFixed(2).replace('.', ','),
    kunde_name:    details.payer.name.given_name + ' ' + details.payer.name.surname,
    kunde_email:   details.payer.email_address,
    lieferadresse: lieferadresse,
    agb_link:      'https://kronenwelt.de/agb.html',
    widerruf_link: 'https://kronenwelt.de/widerruf.html'
  };
  try {
    emailjs.send('service_vwuvctq', 'template_wihnwzo', emailParams)
      .catch(err => console.warn('EmailJS Sara fehlgeschlagen:', err));
  } catch (err) { console.warn('EmailJS nicht geladen:', err); }
  return { ...emailParams, lieferadresse };
}

// Bestellung an die Google-Tabelle. Antwort: { success, bestellnr, bestaetigung } oder null (Fehler/zu langsam)
function saveToSheets(orderData, zahlung) {
  if (!CONFIG.SHEETS_URL || CONFIG.SHEETS_URL.length < 10) return Promise.resolve(null);
  const body = JSON.stringify({ ...orderData, zahlung });
  const zuLangsam = new Promise(ok => setTimeout(() => ok(null), 30000));
  const anfrage = fetch(CONFIG.SHEETS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body })
    .then(r => r.json())
    // Antwort nicht lesbar: nicht nochmal senden (sonst stünde die Bestellung doppelt in der Tabelle),
    // Sara hat die Bestellung trotzdem per Mail (EmailJS)
    .catch(err => { console.warn('Google Sheets: keine lesbare Antwort', err); return null; });
  return Promise.race([anfrage, zuLangsam]);
}

function clearCartAfterPayment() {
  cart = []; saveCart(); updateCartBadge();
  try { renderCart(); closeCart(); } catch (e) { /* Warenkorb war nicht offen */ }
}

// Danke-Fenster
const dankeEsc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Datum in n Werktagen (Mo–Fr)
function inWerktagen(n, ab = new Date()) {
  const d = new Date(ab);
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) n--; }
  return d;
}
const tagKurz = d => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.';
function dankeZeigen(vorname, email, artikel, summe) {
  const f = document.getElementById('dankeFenster');
  if (!f) return;
  const $ = id => document.getElementById(id);
  artikel = artikel || [];
  const namen = artikel.map(i => itemPers(i)).filter(Boolean);
  $('dankeTitel').textContent = vorname ? 'Danke für deine Bestellung, ' + vorname + '!' : 'Danke für deine Bestellung!';
  $('dankeText').innerHTML = 'Deine Zahlung ist bei PayPal eingegangen. Die Bestätigung mit allen Details schicken wir an <b>'
    + dankeEsc(email || 'deine E-Mail-Adresse') + '</b>.';
  $('dankeDatum').textContent = tagKurz(new Date());
  $('dankePositionen').innerHTML = artikel.map(i => `<div class="danke-pos"><div>${dankeEsc(i.variant)}
      <small>${dankeEsc(i.color)} · ${dankeEsc(i.size)}${itemPers(i) ? ` · <em>${dankeEsc(itemPers(i))}</em>` : ''}</small></div>
      <div>${typeof i.price === 'number' ? i.price.toFixed(2).replace('.', ',') + ' €' : ''}</div></div>`).join('');
  $('dankeSumme').innerHTML = (typeof summe === 'number' ? summe.toFixed(2).replace('.', ',') + ' €' : '') + '<small>· PayPal</small>';
  const n = artikel.length;
  $('dankeSchritt1').textContent = (n > 1 ? 'Sara fertigt deine ' + n + ' Kronen jetzt von Hand' : 'Sara fertigt deine Krone jetzt von Hand')
    + (namen.length ? ', mit ' + namen.map(x => '„' + x + '“').join(' und ') + '.' : '.');
  $('dankeSchritt3').textContent = 'Voraussichtlich bei dir zwischen ' + tagKurz(inWerktagen(5)) + ' und ' + tagKurz(inWerktagen(6));
  $('dankeHinweis').textContent = namen.length
    ? 'Hat sich beim Namen ein Fehler eingeschlichen? Schreib uns am besten gleich, dann ändern wir ihn, bevor wir nähen.'
    : 'Möchtest du noch etwas ändern? Schreib uns am besten gleich, bevor wir mit dem Nähen anfangen.';
  const shop = CONFIG.SHOP_EMAIL || 'm.kronenwelt@gmail.com';
  $('dankeEmail').href = 'mailto:' + shop;
  $('dankeWa').href = 'https://wa.me/' + (CONFIG.WA_NUMBER || '') + '?text=' + encodeURIComponent('Hallo Sara, ich habe gerade eine Krone bestellt und eine Frage:');
  f.classList.add('offen');
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const b = f.querySelector('.danke-zu'); if (b) b.focus({ preventScroll: true }); }, 50);
}
function dankeNummer(nr) {
  const $ = id => document.getElementById(id);
  $('dankeNrWert').textContent = nr;
  const shop = CONFIG.SHOP_EMAIL || 'm.kronenwelt@gmail.com';
  $('dankeEmail').href = 'mailto:' + shop + '?subject=' + encodeURIComponent('Bestellung ' + nr);
  $('dankeWa').href = 'https://wa.me/' + (CONFIG.WA_NUMBER || '') + '?text=' + encodeURIComponent('Hallo Sara, zu meiner Bestellung ' + nr + ':');
}
function dankeSchliessen() {
  document.getElementById('dankeFenster').classList.remove('offen');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('dankeFenster')?.classList.contains('offen')) dankeSchliessen(); });

function startCartCheckout(method) {
  if (cart.length === 0) return;
  // Preise vor dem Bezahlen frisch aus der Preisliste berechnen
  if (repriceCart() > 0) { renderCart(); alert('Ein Artikel in deinem Warenkorb war nicht mehr verfügbar und wurde entfernt. Bitte prüfe deinen Warenkorb.'); return; }
  if (cart.length === 0) return;

  const total = cart.reduce((s, i) => s + i.price, 0);
  const desc  = cart.map(i => `${i.variant} ${i.color} ${i.size} ${itemPers(i) ? '"' + itemPers(i) + '"' : 'ohne Namen'}`).join(' | ');
  closeCart();

  // PayPal (default)
  document.getElementById('paypal-order-summary').innerHTML = buildCartSummaryHTML(total);
  // Pflichtinformationen unmittelbar vor der Bestellung (§ 312j BGB)
  document.getElementById('ppLegal').innerHTML =
    'Lieferzeit 5–6 Werktage · Versand nur innerhalb Deutschlands · Endpreis, gemäß § 19 UStG ohne Umsatzsteuer. ' +
    (cart.some(i => i.name) ? 'Personalisierte Kronen sind vom Widerrufsrecht ausgeschlossen. ' : '') +
    'Es gelten unsere <a href="agb.html" target="_blank">AGB</a> und die <a href="widerruf.html" target="_blank">Widerrufsbelehrung</a>.' +
    '<strong>Mit Klick auf einen Bezahl-Button gibst du deine Bestellung zahlungspflichtig auf.</strong>';
  document.getElementById('paypal-button-container').innerHTML = '';
  document.getElementById('paypalModal').style.display = 'flex';

  if (!CONFIG.PAYPAL_ID || CONFIG.PAYPAL_ID.length < 10) {
    document.getElementById('paypal-button-container').innerHTML =
      '<p style="font-family:sans-serif;font-size:13px;color:#5f6d6e;text-align:center;padding:20px">⚙️ PayPal Client ID noch nicht eingetragen.</p>';
    return;
  }

  const renderPayPal = () => {
    paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'buynow' },
      createOrder: (data, actions) => actions.order.create({
        purchase_units: [{ description: desc.substring(0, 127), amount: { value: total.toFixed(2), currency_code: 'EUR' } }]
      }),
      onApprove: (data, actions) => actions.order.capture().then(details => {
        closePayPalModal();
        const orderData = sendOrderEmails(details, total);       // Mail an Sara sofort
        // Artikelnummern (gleiche Reihenfolge wie die Kronen), damit das Lager automatisch abbucht;
        // PayPal-Nummer, damit die Tabelle bei PayPal nachprüft, ob genau diese Zahlung angekommen ist
        const zuSpeichern = { ...orderData, artikel: cart.map(i => artikelnummer(i.variant, i.color, i.size, true)).join(', '),
          paypal_id: details.id || '', bestaetigung_per_schnittstelle: true };
        dankeZeigen(details.payer.name.given_name, orderData.kunde_email, cart.slice(), total);
        clearCartAfterPayment();
        // Bestätigung an den Kunden schickt nur noch die Tabelle (mit Bestellnummer). Über EmailJS geht nur die Mail an Sara,
        // deren Empfänger fest in der Vorlage steht – so kann niemand über EmailJS Mails an fremde Adressen schicken.
        saveToSheets(zuSpeichern, 'PayPal').then(r => {
          if (r && r.bestellnr) dankeNummer(r.bestellnr);
        });
      }),
      onError:  () => alert('❌ PayPal Fehler. Bitte nochmal versuchen.'),
      onCancel: () => closePayPalModal()
    }).render('#paypal-button-container');
  };

  if (!window.paypal) {
    const s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' + CONFIG.PAYPAL_ID + '&currency=EUR';
    s.onload = renderPayPal;
    document.head.appendChild(s);
  } else {
    renderPayPal();
  }
}

// Personalisierungstext eines Warenkorb-Artikels (Name oder Zahlen)
function itemPers(i) {
  if (i.zahlen) return 'Zahlen ' + i.zahlen;
  return i.name || '';
}

/* ---- KONFIGURATOR HELPERS (für dynamisch generierte Chips) ---- */
function selectV(el) {
  document.querySelectorAll('[data-v]').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  state.variant = el.dataset.v;
  applyMode();
  renderColorChips(state.variant);
  updatePreview();
}
function selectVariant(v) {
  const btn = [...document.querySelectorAll('[data-v]')].find(b => b.dataset.v === v);
  if (btn) selectV(btn);
}
function selectC(el) {
  document.querySelectorAll('[data-c]').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  state.color = el.dataset.c;
  state.bg    = el.dataset.bg;
  state.sc    = el.dataset.sc;
  state.dot   = el.dataset.dot;
  updatePreview();
}
function selectS(el) {
  document.querySelectorAll('[data-s]').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  state.size = el.dataset.s;
  updatePreview();
}

/* ---- LIGHTBOX (Fotos + Video, mit Blättern) ---- */
let lbItems = [], lbIdx = 0, lbCaption = '';
function openLightbox(src, caption) {
  openMediaLightbox([{ typ: 'bild', src }], 0, caption);
}
function openMediaLightbox(items, idx, caption) {
  lbItems = (items || []).filter(it => it && !it.kaputt);
  if (!lbItems.length) return;
  lbIdx = Math.max(0, Math.min(idx || 0, lbItems.length - 1));
  lbCaption = caption || '';
  const ov = document.getElementById('lightboxOverlay');
  ov.classList.toggle('multi', lbItems.length > 1);
  showLightboxItem();
  ov.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function showLightboxItem() {
  const it  = lbItems[lbIdx];
  const img = document.getElementById('lightboxImg');
  const vid = document.getElementById('lightboxVideo');
  if (it.typ === 'video') {
    img.style.display = 'none';
    vid.style.display = '';
    vid.poster = it.poster || '';
    vid.src = it.src;
    vid.muted = true;
    const p = vid.play(); if (p && p.catch) p.catch(() => {});
  } else {
    stopLightboxVideo();
    vid.style.display = 'none';
    img.style.display = '';
    img.src = it.src;
    img.alt = lbCaption;
  }
  const zaehler = lbItems.length > 1 ? (lbIdx + 1) + ' / ' + lbItems.length : '';
  document.getElementById('lightboxCaption').textContent =
    [lbCaption, it.typ === 'video' ? 'Video' : '', zaehler].filter(Boolean).join(' · ');
}
function lightboxStep(d) {
  if (lbItems.length < 2) return;
  lbIdx = (lbIdx + d + lbItems.length) % lbItems.length;
  showLightboxItem();
}
function stopLightboxVideo() {
  const vid = document.getElementById('lightboxVideo');
  if (!vid || !vid.getAttribute('src')) return;
  vid.pause(); vid.removeAttribute('src'); vid.load();
}
function hideLightbox() {
  stopLightboxVideo();
  document.getElementById('lightboxOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
function closeLightbox(e) {
  if (e && e.target !== document.getElementById('lightboxOverlay') &&
      !e.target.classList.contains('lightbox-close')) return;
  hideLightbox();
}
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightboxOverlay').classList.contains('open')) return;
  if (e.key === 'Escape') hideLightbox();
  else if (e.key === 'ArrowLeft') lightboxStep(-1);
  else if (e.key === 'ArrowRight') lightboxStep(1);
});
(function () {
  // Wischen auf dem Handy
  const ov = document.getElementById('lightboxOverlay');
  let x0 = null;
  ov.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  ov.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) lightboxStep(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

/* ---- 0. STRUKTURBAUM ---- */
const VARIANTEN = {};   // Inhalt kommt aus katalog.json (Notfall-Stand: js/katalog-notfall.js)
// pet: [Farbe des Zahlenpads, Farbe der Zahl] – wird in Auswahl, Vorschau und Farb-Chips verwendet

/* Aufpreis je Anzahl Zahlenpets (Grundpreis in PRICES gilt für 3 Pets).
   Wird in katalog.json → optionen.zahlenpets (Admin: Preise) gepflegt; das hier ist nur der Fallback. */
const PET_AUFPREIS = { 3: 0, 6: 3, 9: 6 };
function petAufpreis(n) {
  const a = PRICES['Zahlenpets Aufpreis'];
  if (n === 3) return 0;
  return (a && typeof a[n + ' Pets'] === 'number') ? a[n + ' Pets'] : (PET_AUFPREIS[n] || 0);
}
const isZahl = (v) => (VARIANTEN[v || state.variant] || {}).typ === 'zahl';
function currentPrice() {
  const base = (PRICES[state.variant] || {})[state.size] || 15;
  return base + (isZahl() ? petAufpreis(state.pets) : 0);
}

/* ---- PRODUKTFOTOS ---- */
const CL = 'https://res.cloudinary.com/dw6amyijc/image/upload/';
// Cache-Buster: stündliche Versionsnummer als Fallback
const CLV = 'v' + Math.floor(Date.now() / 3600000) + '/';

/* Hauptfoto je Krone und Farbe kommt aus katalog.json (Cloudinary-Namen ohne .jpg).
   Dieselbe Datei nutzt die Admin-Seite → jede Farbe im Konfigurator ist dort pflegbar. */
let PRODUCT_IMAGES = {};
function setProduktFotos(json) {
  const out = {};
  Object.entries(json || {}).forEach(([v, farben]) => {
    if (v.startsWith('_') || !farben || typeof farben !== 'object') return;
    out[v] = {};
    Object.entries(farben).forEach(([f, id]) => { if (id) out[v][f] = CL + CLV + clId(medienId(id)) + '.jpg'; });
  });
  PRODUCT_IMAGES = out;
  previewKey = '';
}

/* ---- PRODUKTKATALOG (katalog.json) ----
   Eine Quelle für Konfigurator, Preise, Hauptfotos und Google-Texte (siehe _info in der Datei).
   Falls katalog.json nicht geladen werden kann, gilt der Notfall-Stand KATALOG_NOTFALL aus
   js/katalog-notfall.js – eine Kopie von katalog.json, die scripts/seiten.js bei jeder Änderung neu erzeugt.
   Gepflegt wird ausschliesslich katalog.json. */
let KATALOG = null;
function applyKatalog(k) {
  if (!k || !Array.isArray(k.produkte) || !k.produkte.length) return false;
  const neuV = {}, neuP = {}, fotos = {};
  k.produkte.forEach(p => {
    const m = p.merkmale || {}, cfg = p.konfigurator || {};
    if (!p.name || !Array.isArray(m.farbe) || !Array.isArray(m.groesse)) return;
    neuV[p.name] = {
      farben: m.farbe.map(f => Object.assign({ label: f.wert }, f.anzeige || {}, f.personalisierbar === false ? { noName: true } : {})),
      groessen: m.groesse.map(g => g.wert)
    };
    if (cfg.typ) neuV[p.name].typ = cfg.typ;
    if (cfg.naht != null) neuV[p.name].naht = cfg.naht;
    if (cfg.farbLabel) neuV[p.name].farbLabel = cfg.farbLabel;
    if (Array.isArray(cfg.bommeln)) BOMMELS[p.name] = cfg.bommeln;
    if (p.texte && p.texte.kurz) SEO_TEXTE[p.name] = p.texte.kurz;
    neuP[p.name] = {};
    m.groesse.forEach(g => { if (typeof g.preis === 'number') neuP[p.name][g.wert] = g.preis; });
    fotos[p.name] = { _default: p.hauptfoto };
    m.farbe.forEach(f => { if (f.foto) fotos[p.name][f.wert] = f.foto; });
  });
  if (!Object.keys(neuV).length) return false;
  Object.keys(VARIANTEN).forEach(v => delete VARIANTEN[v]);    // Reihenfolge wie im Katalog
  Object.assign(VARIANTEN, neuV);
  const pets = ((k.optionen || {}).zahlenpets || {}).werte;
  if (Array.isArray(pets)) {
    neuP['Zahlenpets Aufpreis'] = {};
    pets.forEach(o => { if (o.wert !== 3) neuP['Zahlenpets Aufpreis'][o.wert + ' Pets'] = o.aufpreis; });
  }
  PRICES = neuP;
  setProduktFotos(fotos);
  KATALOG = k;
  return true;
}

// Artikelnummer aus dem Katalog: Gruppe-Produkt-Merkmal-… (z. B. KR-PARTY-ROSA-GR).
// Die Reihenfolge der Merkmale steht bei der Gruppe; Kürzel am Produkt (Farbe) oder global (Größe).
// Zusätze wie „ + 6 Pets“ gehören nicht zur Artikelnummer. Unbekannt → ''.
// fuerLager: Farben mit „lager“ im Katalog (z. B. Zahlenfarbe bei Zahlenkronen) liegen als ein Lagerartikel.
function artikelnummer(name, farbe, groesse, fuerLager) {
  const k = KATALOG;
  const p = k && (k.produkte || []).find(x => x.name === name);
  const g = p && (k.gruppen || []).find(x => x.id === p.gruppe);
  if (!g) return '';
  const werte = { farbe, groesse: String(groesse || '').replace(/\s*\+.*$/, '') };
  const teile = [g.kuerzel, p.kuerzel];
  for (const m of g.merkmale || []) {
    const am = ((p.merkmale || {})[m] || []).find(x => x.wert === werte[m]);
    const glob = (((k.merkmale || {})[m] || {}).werte || []).find(x => x.wert === werte[m]);
    const kz = (fuerLager && am && am.lager && am.lager.kuerzel) || (am && am.kuerzel) || (glob && glob.kuerzel);
    if (!am || !kz) return '';
    teile.push(kz);
  }
  return teile.join('-');
}

/* ---- WEITERE FOTOS + VIDEO (aus medien.json) ----
   Pro Krone und Farbe bis zu 6 Fotos (Hauptfoto oben + bis zu 5 weitere) und 1 Video.
   medien.json: { "Party": { "_default": { "bilder": ["id", …], "video": "id" },
                             "Rosa mit Punkten": { "bilder": […] } } }
   Die IDs sind die Cloudinary-Namen ohne Endung. Farbe ohne eigenen Eintrag → _default. */
const MAX_FOTOS = 6;
const CLVID = 'https://res.cloudinary.com/dw6amyijc/video/upload/';
let MEDIEN = {};
function medienId(x) {
  return String(x == null ? '' : x).trim().replace(/\.(jpe?g|png|webp|mp4|mov|m4v|webm)$/i, '');
}
function clId(id) { return id.split('/').map(encodeURIComponent).join('/'); }
const clBild   = id => CL + CLV + clId(id) + '.jpg';
const clThumb  = id => CL + 'c_fill,w_160,h_160,q_auto/' + CLV + clId(id) + '.jpg';
const clVideo  = id => CLVID + 'q_auto,w_1280,c_limit/' + CLV + clId(id) + '.mp4';
const clPoster = (id, w) => CLVID + 'so_0,' + (w <= 200 ? 'c_fill,w_' + w + ',h_' + w : 'w_' + w + ',c_limit') + ',q_auto/' + CLV + clId(id) + '.jpg';

function medienEintrag(v, c) {
  const m   = (MEDIEN && MEDIEN[v]) || {};
  const own = (c && m[c]) || {};
  const def = m._default || {};
  const bilder = Array.isArray(own.bilder) && own.bilder.length ? own.bilder
               : Array.isArray(def.bilder) ? def.bilder : [];
  return { bilder: bilder.map(medienId).filter(Boolean), video: medienId(own.video || def.video) };
}
function medienListe(v, c) {
  const map   = PRODUCT_IMAGES[v] || {};
  const haupt = (c && map[c]) || map['_default'] || '';
  const e     = medienEintrag(v, c);
  const items = [];
  if (haupt) items.push({ typ: 'bild', src: haupt, thumb: haupt, haupt: true });
  e.bilder.forEach(id => {
    const src = clBild(id);
    if (items.length < MAX_FOTOS && !items.some(it => it.src === src)) items.push({ typ: 'bild', src, thumb: clThumb(id) });
  });
  if (e.video) items.push({ typ: 'video', src: clVideo(e.video), poster: clPoster(e.video, 1280), thumb: clPoster(e.video, 160) });
  return items;
}

let previewKey = '', previewItems = [], previewIdx = 0;

function updatePreviewImage() {
  const imgEl  = document.getElementById('pImg');
  if (!imgEl) return;
  const key = state.variant + '|' + state.color;
  if (key !== previewKey) {
    previewKey   = key;
    previewItems = medienListe(state.variant, state.color);
    previewIdx   = 0;
    renderPreviewThumbs();
    showPreviewPhoto(0);
  }
}

function showPreviewPhoto(idx) {
  const imgEl = document.getElementById('pImg');
  const svgEl = document.getElementById('pSvg');
  const box   = document.getElementById('pBox');
  const map   = PRODUCT_IMAGES[state.variant] || {};
  const it    = previewItems[idx];
  const zeigeSvg = () => {
    imgEl.style.opacity = '0';
    if (svgEl) svgEl.style.opacity = '1';
    if (box) box.classList.remove('has-photo');
  };
  const zeige = src => {
    imgEl.src = src;
    imgEl.style.opacity = '1';
    if (svgEl) svgEl.style.opacity = '0';
    if (box) box.classList.add('has-photo');
  };
  if (!it || it.typ !== 'bild') { zeigeSvg(); return; }
  previewIdx = idx;
  document.querySelectorAll('#pThumbs .prev-thumb').forEach(t => t.classList.toggle('on', +t.dataset.i === idx));
  const key = previewKey;
  // Foto vorladen und mit Fade einblenden
  const tmp = new Image();
  tmp.onload = () => { if (key === previewKey) zeige(it.src); };
  tmp.onerror = () => {
    if (key !== previewKey) return;
    // Hauptfoto nicht gefunden → Fallback auf _default, sonst SVG
    const fallback = map['_default'] || '';
    if (it.haupt && fallback && fallback !== it.src) { it.src = it.thumb = fallback; zeige(fallback); }
    else if (it.haupt) zeigeSvg();
  };
  tmp.src = it.src;
}

function renderPreviewThumbs() {
  const wrap = document.getElementById('pThumbs');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (previewItems.length < 2) return;
  previewItems.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'prev-thumb' + (i === 0 ? ' on' : '');
    b.dataset.i = i;
    b.setAttribute('aria-label', it.typ === 'video' ? 'Video ansehen' : 'Foto ' + (i + 1));
    const im = document.createElement('img');
    im.alt = ''; im.loading = 'lazy';
    im.onerror = () => { if (!it.haupt) { it.kaputt = true; b.remove(); } };
    im.src = it.thumb;
    b.appendChild(im);
    if (it.typ === 'video') { const pl = document.createElement('span'); pl.className = 'play'; pl.textContent = '▶'; b.appendChild(pl); }
    b.addEventListener('click', () => {
      if (it.typ === 'video') openMediaLightbox(previewItems, i, previewCaption());
      else showPreviewPhoto(i);
    });
    wrap.appendChild(b);
  });
}
function previewCaption() { return state.variant + (state.color ? ' – ' + state.color : ''); }
function openPreviewLightbox() {
  const box = document.getElementById('pBox');
  if (!box || !box.classList.contains('has-photo') || !previewItems.length) return;
  const sichtbar = previewItems.filter(it => !it.kaputt);
  const idx = Math.max(0, sichtbar.indexOf(previewItems[previewIdx]));
  openMediaLightbox(sichtbar, idx, previewCaption());
}

/* Produktkarten: Knopf für weitere Fotos / Video */
function renderProduktMedien() {
  document.querySelectorAll('.prod-card[data-variant]').forEach(card => {
    const v = card.dataset.variant;
    const holder = card.querySelector('.prod-img');
    const alt = card.querySelector('.prod-media-btn');
    if (alt) alt.remove();
    const items = medienListe(v, null);
    const fotos = items.filter(it => it.typ === 'bild').length;
    const video = items.some(it => it.typ === 'video');
    if (!holder || items.length < 2) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'prod-media-btn';
    b.setAttribute('aria-label', 'Weitere Fotos' + (video ? ' und Video' : '') + ' von ' + v + ' ansehen');
    b.innerHTML = (fotos > 1
        ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="3.5" width="13" height="10" rx="2"/><circle cx="8" cy="8.5" r="2.6"/><path d="M5.5 3.5l1-1.8h3l1 1.8"/></svg>' + fotos
        : '') +
      (video ? (fotos > 1 ? ' · ' : '') + '▶ Video' : '');
    b.addEventListener('click', e => {
      e.stopPropagation();
      const name = (card.querySelector('.prod-name') || {}).textContent || v;
      openMediaLightbox(items, 0, name.trim());
    });
    holder.appendChild(b);
  });
}

/* ---- 1. KONFIGURATION ---- */
let PRICES = {};

const BOMMELS = {};

/* ---- 2. ZUSTAND ---- */
const state = {
  variant: 'Party',
  color:   '',
  size:    'Gross',
  bg:      '#f7eaed',
  sc:      '#a05070',
  dot:     '#c07090',
  name:    '',
  pets:    3,     // Zahlenkronen: Anzahl Zahlenpets
  numbers: []     // Zahlenkronen: gewählte Zahlen
};

/* ---- 3. KONFIGURATOR ---- */

// Farbmuster für die Farb-Chips: Punkte, Leo-Flecken, Glitzer usw. statt nur eines Farbpunkts
function swatchFor(variant, f) {
  const dots = (c, bg) => `radial-gradient(circle, ${c} 22%, transparent 25%) 0 0/5px 5px, ${bg}`;
  const leo = (spot, bg) =>
    `radial-gradient(ellipse 2.2px 1.6px at 4px 4px, ${spot} 90%, transparent 100%),` +
    `radial-gradient(ellipse 1.8px 2.2px at 10px 6px, ${spot} 90%, transparent 100%),` +
    `radial-gradient(ellipse 2px 1.5px at 6px 11px, ${spot} 90%, transparent 100%),` +
    `radial-gradient(ellipse 1.6px 2px at 12px 12px, ${spot} 90%, transparent 100%),` +
    `radial-gradient(ellipse 1.4px 1.4px at 1px 9px, ${spot} 90%, transparent 100%), ${bg}`;
  const glitter = (bg) =>
    `radial-gradient(circle at 30% 30%, rgba(255,255,255,.95) 0 1px, transparent 1.6px),` +
    `radial-gradient(circle at 70% 45%, rgba(255,255,255,.85) 0 .8px, transparent 1.4px),` +
    `radial-gradient(circle at 45% 75%, rgba(255,255,255,.9) 0 .9px, transparent 1.5px),` +
    `linear-gradient(135deg, rgba(255,255,255,.45), rgba(255,255,255,0) 50%, rgba(0,0,0,.12)), ${bg}`;
  const L = f.label;
  if (variant === 'Party') {
    if (L === 'Konfetti') return `radial-gradient(circle at 4px 4px, #e8a0b8 1.4px, transparent 1.8px), radial-gradient(circle at 10px 5px, #8cc4b8 1.4px, transparent 1.8px), radial-gradient(circle at 6px 10px, #e8c060 1.4px, transparent 1.8px), radial-gradient(circle at 11px 11px, #9cb4d8 1.4px, transparent 1.8px), #fff`;
    if (L === 'Weiss/Blau/Grün') return 'conic-gradient(#ffffff 0 33%, #8fb0d8 0 66%, #9cc8a8 0)';
    return dots('#ffffff', f.dot);
  }
  if (variant === 'Glitzer') return glitter(L === 'Weiss' ? '#efefeb' : L === 'Silber' ? '#c4c4cc' : f.dot);
  if (variant === 'Edel & Wild') {
    if (L === 'Gold')      return 'linear-gradient(135deg, #f3dc8a, #c09820 55%, #9a7410)';
    if (L === 'Schwarz')   return '#22202c';
    if (L === 'Leo Braun') return leo('#3a2414', '#b07a3a');
    if (L === 'Leo Weiss') return leo('#5a4a40', '#f3ede4');
    if (L === 'Leopard')   return leo('#1e1612', '#d9b27c');
  }
  return f.dot;
}

function renderColorChips(variant) {
  const container = document.getElementById('colorChips');
  if (!container) return;
  const farben = (VARIANTEN[variant] || {}).farben || [];
  container.innerHTML = farben.map((f, i) => {
    const dotHtml = f.pet
      ? `<span style="margin-right:6px;display:inline-flex">${miniPad(1, f.pet[0], f.pet[1], 18, hatNaht(variant))}</span>`
      : `<span class="swatch" style="background:${swatchFor(variant, f)};${f.label === 'Schwarz' ? 'border-color:#c9a85c' : ''}"></span>`;
    return `<span class="chip ${f.css || ''} ${i === 0 ? 'on' : ''}"
      data-c="${f.label}"
      data-bg="${f.bg}" data-sc="${f.sc}" data-dot="${f.dot}"
      onclick="selectC(this)"
      style="display:inline-flex;align-items:center"
    >${dotHtml}${f.label}</span>`;
  }).join('');

  // Ersten Chip als aktiv setzen
  if (farben.length > 0) {
    state.color = farben[0].label;
    state.bg    = farben[0].bg;
    state.sc    = farben[0].sc;
    state.dot   = farben[0].dot;
  }
}

// Darf bei der gewählten Farbe ein Name aufgedruckt werden?
function nameAllowed() {
  const f = ((VARIANTEN[state.variant] || {}).farben || []).find(x => x.label === state.color);
  return !(f && f.noName);
}

let savedName = '';   // Name merken, falls der Kunde zurück zu einer Farbe mit Namen wechselt
function applyNameAvailability() {
  const input = document.getElementById('nIn');
  if (!input) return;
  const allowed = nameAllowed();
  const wrap = document.getElementById('nWrap');
  const hint = document.getElementById('nHint');
  const lbl  = document.getElementById('nLbl');
  const cnt  = document.getElementById('nCnt');
  document.getElementById('cNote').hidden = allowed;
  wrap.classList.toggle('off', !allowed);
  input.disabled = !allowed;
  hint.hidden = allowed;

  if (!allowed) {
    if (state.name) savedName = state.name;
    state.name = '';
    input.value = '';
    input.placeholder = 'Bei diesem Muster ohne Personalisierung';
    lbl.textContent = 'Personalisierung';
    const alt = ((VARIANTEN[state.variant] || {}).farben || []).filter(f => !f.noName);
    hint.innerHTML = 'Auf dem Leo-Muster wäre ein Name kaum lesbar – deshalb fertigen wir diese Krone <strong>ohne Aufdruck</strong>. ' +
      (alt.length ? 'Du möchtest einen Namen? Wähle eine dieser Farben:<div class="nhint-alt">' +
        alt.map(f => `<button type="button" class="nhint-btn" onclick="pickColor('${f.label}')">${f.label}</button>`).join('') + '</div>' : '');
  } else {
    if (input.disabled === false && !state.name && savedName) {
      state.name = savedName; input.value = savedName; savedName = '';
    }
    input.placeholder = 'MILA';
    lbl.textContent = 'Personalisierung eingeben (max. 11 Buchstaben)';
    if (cnt) cnt.textContent = state.name.length + ' / 11';
  }
}

function pickColor(label) {
  const chip = [...document.querySelectorAll('[data-c]')].find(c => c.dataset.c === label);
  if (chip) { selectC(chip); document.getElementById('nIn').focus(); }
}

/* ---- ZAHLENKRONEN ---- */
function selectMode(mode) {
  const first = [...document.querySelectorAll('.chip[data-v]')].find(c => c.dataset.mode === mode);
  if (first && first.dataset.mode !== (isZahl() ? 'zahl' : 'name')) selectV(first);
}

// Tabs, Varianten-Chips, Grössen und Schritt 4 an die gewählte Variante anpassen
function applyMode() {
  const mode = isZahl() ? 'zahl' : 'name';
  document.querySelectorAll('.mode-tab').forEach(t => { const on = t.dataset.mode === mode; t.classList.toggle('on', on); t.setAttribute('aria-checked', on); });
  document.querySelectorAll('.chip[data-v]').forEach(c => c.hidden = c.dataset.mode !== mode);
  document.querySelectorAll('[data-block]').forEach(b => b.hidden = b.dataset.block !== mode);
  const cfg = VARIANTEN[state.variant] || {};
  const lbl = document.getElementById('cLbl');
  if (lbl) lbl.textContent = cfg.farbLabel || 'Stil & Farbe wählen';

  const sizes = cfg.groessen || ['Gross', 'Klein', 'Mini', 'Extra Mini'];
  document.querySelectorAll('.szcard[data-s]').forEach(c => c.hidden = !sizes.includes(c.dataset.s));
  if (!sizes.includes(state.size)) {
    const card = document.querySelector(`.szcard[data-s="${sizes[0]}"]`);
    if (card) selectS(card);
  }
  if (mode === 'zahl') {
    document.querySelectorAll('#petCount [data-p]').forEach(c => {
      const d = c.querySelector('.pet-delta'), a = petAufpreis(+c.dataset.p);
      if (d) d.textContent = a ? '+' + String(a).replace('.', ',') + ' €' : '';
    });
    renderPets();
  }
}

// Mini-Zahlenpad (Kreis in Padfarbe mit Zahl in Zahlenfarbe)
function isLightHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 225;
}
function padStyle(bg, fg) {
  return `background-color:${bg};color:${fg};border-color:${isLightHex(bg) ? 'var(--border2)' : bg};--pad-edge:${shadeHex(bg, isLightHex(bg) ? 0.80 : 0.68)}`;
}
// Farbe abdunkeln (für die Seitenkante der Pads)
function shadeHex(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 'rgba(0,0,0,0.3)';
  const n = parseInt(m[1], 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(c * f).toString(16).padStart(2, '0')).join('');
}
const hatNaht = (v) => !!(VARIANTEN[v || state.variant] || {}).naht;
function miniPad(n, bg, fg, size, naht) {
  return `<span class="mini-pad${naht ? ' naht' : ''}" style="${padStyle(bg, fg)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px">${n}</span>`;
}

function petColors() {
  const f = ((VARIANTEN[state.variant] || {}).farben || []).find(x => x.label === state.color);
  return (f && f.pet) || ['#e6eeef', '#263234'];
}

function selectPets(n) {
  state.pets = n;
  state.numbers = state.numbers.slice(0, n);
  document.querySelectorAll('#petCount [data-p]').forEach(c => c.classList.toggle('on', +c.dataset.p === n));
  renderPets();
  updatePreview();
}

function addNumber(n) {
  if (state.numbers.length >= state.pets) return;
  state.numbers.push(String(n));
  renderPets();
  updatePreview();
}

function addOtherNumber() {
  const inp = document.getElementById('petOther');
  const v = parseInt(inp.value, 10);
  if (isNaN(v) || v < 0 || v > 99) { inp.focus(); return; }
  addNumber(v);
  inp.value = '';
}

function removeNumber(i) {
  state.numbers.splice(i, 1);
  renderPets();
  updatePreview();
}

function renderPets() {
  const slots = document.getElementById('petSlots');
  const pad   = document.getElementById('petPad');
  if (!slots || !pad) return;
  const [bg, fg] = petColors();
  const full = state.numbers.length >= state.pets;
  let html = '';
  for (let i = 0; i < state.pets; i++) {
    const n = state.numbers[i];
    html += n !== undefined
      ? `<button type="button" class="pet-slot${hatNaht() ? ' naht' : ''}" style="${padStyle(bg, fg)}" onclick="removeNumber(${i})" title="Entfernen">${n}</button>`
      : `<span class="pet-slot empty ${i === state.numbers.length ? 'next' : ''}">${i + 1}</span>`;
  }
  slots.innerHTML = html;
  if (!pad.dataset.built) {
    pad.innerHTML = Array.from({ length: 20 }, (_, i) =>
      `<button type="button" class="pet-key" onclick="addNumber(${i + 1})">${i + 1}</button>`).join('');
    pad.dataset.built = '1';
  }
  pad.querySelectorAll('.pet-key').forEach(k => k.disabled = full);
  const other = document.getElementById('petOther');
  if (other) other.disabled = full;
  const st = document.getElementById('petStatus');
  if (st) {
    st.classList.toggle('ok', full);
    st.textContent = full
      ? `✓ Alle ${state.pets} Zahlen gewählt – zum Ändern ein Pet antippen.`
      : `${state.numbers.length} von ${state.pets} Zahlen gewählt`;
  }
}

function softBg(hex) {
  // Vorschau-Hintergrund dezent: Farbe zu 40 % auf Weiß (dunkle Farben bleiben)
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if ((r * 299 + g * 587 + b * 114) / 1000 < 128) return hex;
  const mix = c => Math.round(255 - (255 - c) * 0.4);
  return '#' + [r, g, b].map(c => mix(c).toString(16).padStart(2, '0')).join('');
}

function updatePreview() {
  if (isZahl()) {
    document.getElementById('cNote').hidden = true;
    renderPets();
  } else {
    applyNameAvailability();
  }
  const el = (id) => document.getElementById(id);
  const pb = el('pBox'); if (!pb) return;

  pb.style.background = softBg(state.bg);

  const pp = el('pp'); if (pp) pp.setAttribute('stroke', state.sc);
  const pf = el('pf'); if (pf) pf.setAttribute('fill',
    state.variant === 'Edel & Wild' && state.color === 'Schwarz' ? 'rgba(212,184,64,0.4)' : 'rgba(74,144,144,0.1)');

  const colors = BOMMELS[state.variant] || BOMMELS['Party'];
  ['pb1','pb2','pb3'].forEach((id, i) => {
    const b = el(id);
    if (b) { b.setAttribute('fill', colors[i]); b.setAttribute('stroke', state.sc); }
  });

  const pt = el('pt');
  if (pt) { pt.setAttribute('fill', isZahl() && !isLightHex(petColors()[0]) ? petColors()[0] : state.sc); pt.textContent = isZahl() ? (state.numbers.join(' ') || '1 2 3') : (nameAllowed() ? (state.name || 'MILA') : ''); }

  const pvn = el('pvn'); if (pvn) pvn.textContent = state.variant;
  const pcd = el('pcd'); if (pcd) pcd.style.background = isZahl() ? petColors()[0] : state.dot;
  const pcl = el('pcl'); if (pcl) pcl.textContent = state.color;
  const pnt = el('pnt');
  if (pnt) {
    if (isZahl()) { const [pbg, pfg] = petColors(); pnt.innerHTML = state.numbers.map(n => miniPad(n, pbg, pfg, 26, hatNaht())).join(''); pnt.classList.remove('off'); }
    else { pnt.textContent = nameAllowed() ? state.name : 'ohne Namensaufdruck'; pnt.classList.toggle('off', !nameAllowed()); }
  }
  const tp  = el('totP');
  if (tp) tp.textContent = currentPrice().toFixed(2).replace('.', ',') + ' €';

  updatePreviewImage();
}

function initConfigurator() {
  // Krone, Farbe und Grösse wählen die Knöpfe selbst (onclick="selectV/selectC/selectS") – hier keine zweiten Listener.

  // Personalisierung
  const nameInput = document.getElementById('nIn');
  const nameCount = document.getElementById('nCnt');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      state.name = nameInput.value.toUpperCase();
      nameInput.value = state.name;
      if (nameCount) nameCount.textContent = state.name.length + ' / 11';
      updatePreview();
    });
  }

  applyMode();
  renderColorChips(state.variant);
  updatePreview();
}

/* ---- 4. BEZAHLUNG ---- */
function closePayPalModal() {
  document.getElementById('paypalModal').style.display = 'none';
  document.getElementById('paypal-button-container').innerHTML = '';
}

function initPayment() {
  // Cookie-Check bereits in startCartCheckout integriert
}

/* ---- 5. GALERIE LIKES ---- */
function toggleLike(btn) {
  const liked   = btn.classList.contains('liked');
  const numEl   = btn.closest('.kg-like-row').querySelector('.ln');
  const ho      = btn.querySelector('.ho');
  const hf      = btn.querySelector('.hf');
  const n       = parseInt(numEl.textContent);
  btn.classList.toggle('liked');
  ho.style.display = liked ? ''     : 'none';
  hf.style.display = liked ? 'none' : '';
  numEl.textContent = liked ? n - 1 : n + 1;
  if (!liked) {
    const svg = btn.querySelector('svg');
    svg.style.transform = 'scale(1.3)';
    setTimeout(() => svg.style.transform = '', 200);
  }
}

/* ---- 5b. GALERIE AUS galerie.json RENDERN ---- */
function kgEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function kgCard(d, size) {
  const datei = String(d.datei || '').trim();
  const name  = String(d.name  || '').trim();
  const rasse = String(d.rasse || '').trim();
  const krone = String(d.krone || '').trim();
  const badge = String(d.badge || '').trim();
  const likes = parseInt(d.likes) || 0;
  const src   = CL + CLV + encodeURIComponent(datei) + '.jpg';
  const srcLc = CL + CLV + encodeURIComponent(datei.toLowerCase()) + '.jpg';
  const badgeHtml = badge
    ? '<div class="kg-badge ' + (d.featured ? 'kg-badge-gold' : 'kg-badge-new') + '">' + kgEsc(badge) + '</div>'
    : '';
  const el = document.createElement('div');
  el.className = 'kg-card' + (d.featured ? ' kg-card-feat' : '');
  el.innerHTML =
    '<div class="kg-img ' + size + '" style="background:#f8f6f3">' + badgeHtml +
      '<img alt="' + kgEsc(name) + '" style="width:100%;height:100%" loading="lazy">' +
    '</div>' +
    '<div class="kg-body">' +
      '<div class="kg-dog-name">' + kgEsc(name) + '</div>' +
      (rasse ? '<div class="kg-meta">' + kgEsc(rasse) + '</div>' : '') +
      (krone ? '<div class="kg-crown-tag">' + kgEsc(krone) + '</div>' : '') +
      '<div class="kg-like-row">' +
        '<button class="kg-like-btn" onclick="toggleLike(this)">' +
          '<svg viewBox="0 0 14 14" fill="none"><path d="M7 12S1 8 1 4.5A3 3 0 017 3a3 3 0 016 1.5C13 8 7 12 7 12z" stroke="#c05060" stroke-width="1.2" class="ho"/><path d="M7 12S1 8 1 4.5A3 3 0 017 3a3 3 0 016 1.5C13 8 7 12 7 12z" fill="#e07080" class="hf" style="display:none"/></svg>' +
          ' Gefällt mir' +
        '</button>' +
        '<span class="kg-like-count"><span class="ln">' + likes + '</span> Likes</span>' +
      '</div>' +
    '</div>';
  const img = el.querySelector('img');
  // Cloudinary-IDs sind case-sensitiv: erst Dateiname wie im Admin, sonst kleingeschrieben
  img.onerror = function () { if (this.src !== srcLc) { this.onerror = null; this.src = srcLc; } };
  img.src = src;
  img.onclick = () => openLightbox(img.src, name);
  return el;
}
function renderGalerie(list) {
  const top = document.getElementById('kg-top');
  const b1  = document.getElementById('kg-bot1');
  const b2  = document.getElementById('kg-bot2');
  if (!Array.isArray(list) || !list.length || !top || !b1 || !b2) return; // Fallback: statisches HTML bleibt
  // "Foto des Monats" immer zuerst
  const items = list.filter(d => d && d.datei).slice().sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  const addCard = b1.querySelector('.kg-add-card');
  top.innerHTML = ''; b1.innerHTML = ''; b2.innerHTML = '';
  items.slice(0, 3).forEach(d => top.appendChild(kgCard(d, 'kg-img-lg')));
  items.slice(3, 6).forEach(d => b1.appendChild(kgCard(d, 'kg-img-sm')));
  if (addCard) b1.appendChild(addCard);
  items.slice(6).forEach(d => b2.appendChild(kgCard(d, 'kg-img-sm')));
  b2.style.display = items.length > 6 ? '' : 'none';
}

/* ---- 6. COOKIE-HINWEIS ---- */
// Es gibt nur notwendige Speicher (Warenkorb, dieser Hinweis, PayPal an der Kasse) –
// der Banner informiert beim ersten Besuch, eine Auswahl ist nicht nötig.
// Version erhöhen, wenn sich Dienste ändern -> alle Besucher sehen den Hinweis erneut
const COOKIE_KEY = 'mk_cookie_consent';
const CONSENT_VERSION = 3;

function setCookieConsent() {
  const exp = new Date();
  exp.setFullYear(exp.getFullYear() + 1);
  const data = { v: CONSENT_VERSION, ts: new Date().toISOString() };
  document.cookie = COOKIE_KEY + '=' + encodeURIComponent(JSON.stringify(data)) +
    '; expires=' + exp.toUTCString() + '; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
}

function getCookieConsent() {
  const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_KEY + '=([^;]*)'));
  try {
    const c = m ? JSON.parse(decodeURIComponent(m[1])) : null;
    return c && c.v === CONSENT_VERSION ? c : null;
  } catch { return null; }
}

function ckShowView(view) {
  ['main', 'settings'].forEach(v => {
    document.getElementById('ckView' + v[0].toUpperCase() + v.slice(1)).style.display = v === view ? '' : 'none';
  });
}

function ckOpen(view) {
  const banner = document.getElementById('ckBanner');
  const modal  = view === 'settings';
  ckShowView(view);
  banner.classList.toggle('ck-center', modal);
  banner.setAttribute('aria-modal', modal ? 'true' : 'false');
  document.getElementById('ckBackdrop').classList.toggle('show', modal);
  banner.classList.add('show');
  document.getElementById('ckFab').classList.remove('show');
  const first = banner.querySelector('[id^="ckView"]:not([style*="none"]) button');
  if (modal && first) first.focus();
}

function ckHide() {
  document.getElementById('ckBanner').classList.remove('show');
  document.getElementById('ckBackdrop').classList.remove('show');
  if (getCookieConsent()) document.getElementById('ckFab').classList.add('show');
}

function ckSave() {
  setCookieConsent();
  ckHide();
}

// Kompatibilität mit bestehenden Aufrufen
function showCookieBanner() { ckOpen('main'); }
function reopenCookieBanner() { ckOpen('settings'); }

document.addEventListener('keydown', e => {
  const b = document.getElementById('ckBanner');
  if (e.key === 'Escape' && b.classList.contains('show') && b.classList.contains('ck-center')) {
    getCookieConsent() ? ckHide() : ckOpen('main');
  }
});
document.getElementById('ckBackdrop')?.addEventListener('click', () => {
  getCookieConsent() ? ckHide() : ckOpen('main');
});

function initCookies() {
  getCookieConsent() ? document.getElementById('ckFab').classList.add('show') : ckOpen('main');
}

/* ---- 7. NAVIGATION ---- */
function closeMobileMenu() {
  document.getElementById('mobileMenu').classList.remove('open');
}

function initNav() {
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  if (hamburger) hamburger.onclick = () => mobileMenu.classList.toggle('open');

  const waBtn = document.getElementById('wa-btn');
  if (waBtn) waBtn.onclick = () =>
    window.open('https://wa.me/' + CONFIG.WA_NUMBER +
      '?text=Hallo%20Milas%20Kronenwelt!%20Ich%20habe%20eine%20Frage%20zu%20euren%20Hundekronen.', '_blank');
}

/* ---- 8. INSTAGRAM LINKS ---- */
function initInstagram() {
  const url    = CONFIG.INSTA_URL;
  const handle = '@' + CONFIG.INSTA_HANDLE;
  ['nav-insta-link','galerie-insta-link','about-insta-link','footer-insta-link']
    .forEach(id => { const el = document.getElementById(id); if (el) el.href = url; });
  ['nav-insta-text','mobile-insta-text','galerie-insta-text','footer-insta-text']
    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = handle; });
  const mi = document.getElementById('mobile-insta-link'); if (mi) mi.href = url;
  const ge = document.getElementById('galerie-email');     if (ge) ge.textContent = CONFIG.EMAIL_GALERIE;
}

/* ---- 8b. "AB"-PREISE AUS DER PREISLISTE ---- */
function abPreis(variant) {
  const v = Object.values(PRICES[variant] || {}).filter(x => typeof x === 'number');
  return v.length ? Math.min(...v) : null;
}
function fmtEuro(v) { return v.toFixed(2).replace('.', ',') + ' €'; }
function updateAbPreise() {
  document.querySelectorAll('.prod-card[data-variant]').forEach(c => {
    const a = abPreis(c.dataset.variant), el = c.querySelector('.prod-price');
    if (a != null && el) el.textContent = 'ab ' + fmtEuro(a);
  });
  document.querySelectorAll('[data-ab-mode]').forEach(el => {
    const list = Object.keys(VARIANTEN).filter(v => (isZahl(v) ? 'zahl' : 'name') === el.dataset.abMode).map(abPreis).filter(x => x != null);
    if (list.length) el.textContent = 'ab ' + fmtEuro(Math.min(...list));
  });
}

/* ---- 8c. PRODUKTDATEN FÜR GOOGLE (JSON-LD) ----
   Wird aus PRICES (katalog.json) erzeugt – Preise bleiben so immer aktuell. */
const SEO_TEXTE = {};
function updateProduktSchema() {
  try {
    const items = [];
    document.querySelectorAll('.prod-card[data-variant]').forEach(c => {
      const v = c.dataset.variant;
      const preise = Object.values(PRICES[v] || {}).filter(x => typeof x === 'number');
      if (!preise.length) return;
      const img = c.querySelector('img');
      const name = (c.querySelector('.prod-name') || {}).textContent || v;
      items.push({
        '@type': 'Product',
        name: name.trim() + ' – Hundekrone',
        description: SEO_TEXTE[v] || 'Handgemachte Krone für Hunde.',
        image: img ? img.src : undefined,
        brand: { '@type': 'Brand', name: "Mila's Kronenwelt" },
        category: 'Hundezubehör > Hundekostüme',
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'EUR',
          lowPrice: Math.min(...preise).toFixed(2),
          highPrice: Math.max(...preise).toFixed(2),
          offerCount: preise.length,
          availability: 'https://schema.org/InStock',
          seller: { '@id': 'https://kronenwelt.de/#shop' }
        }
      });
    });
    let el = document.getElementById('ld-produkte');
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = 'ld-produkte';
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': items });
  } catch (e) { console.warn('SEO-Schema:', e); }
}

/* ---- 9. START ---- */
// Zuerst der Notfall-Stand (sofort da, ohne Laden), danach ersetzt katalog.json ihn
try { if (typeof KATALOG_NOTFALL !== 'undefined' && applyKatalog(KATALOG_NOTFALL)) repriceCart(); }   // Warenkorb sofort prüfen, nicht erst nach katalog.json
catch (e) { console.warn('Notfall-Katalog:', e); }
initNav();
initInstagram();
initCookies();
updateCartBadge();

// Katalog (Produkte, Preise, Fotos), Galerie und Medien dynamisch laden
Promise.all([
  fetch('katalog.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null),
  fetch('galerie.json').then(r => r.json()).catch(() => null),
  fetch('medien.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null)
]).then(([katalog, galerie, medien]) => {
  try { if (!applyKatalog(katalog)) console.warn('katalog.json nicht geladen – Notfall-Stand aktiv'); }
  catch (e) { console.warn('Katalog:', e); }
  if (medien && typeof medien === 'object') { MEDIEN = medien; previewKey = ''; }
  try { renderProduktMedien(); } catch (e) { console.warn('Medien:', e); }
  repriceCart();
  if (document.getElementById('cartPanel').classList.contains('open')) renderCart();   // schon offen: neu zeichnen
  updateAbPreise();
  updateProduktSchema();
  try { renderGalerie(galerie); } catch (e) { console.warn('Galerie:', e); }
  initConfigurator();
  initPayment();
  applyLinkAuswahl();
}).catch(() => {
  updateProduktSchema();
  initConfigurator();
  initPayment();
  applyLinkAuswahl();
});

/* ---- 10. VORAUSWAHL PER LINK ----
   z.B. https://kronenwelt.de/?krone=Party&groesse=Klein#bestellen
   (wird von den Google-Shopping-Anzeigen genutzt, damit Krone + Größe + Preis
   direkt richtig angezeigt werden) */
function applyLinkAuswahl() {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('krone'), g = q.get('groesse');
    if (!v || !VARIANTEN[v]) return;
    selectVariant(v);
    if (g) {
      const card = [...document.querySelectorAll('.szcard[data-s]')].find(c => c.dataset.s === g && !c.hidden);
      if (card) selectS(card);
    }
    const ziel = document.getElementById('bestellen');
    if (ziel) setTimeout(() => ziel.scrollIntoView(), 50);
  } catch (e) { console.warn('Link-Auswahl:', e); }
}
