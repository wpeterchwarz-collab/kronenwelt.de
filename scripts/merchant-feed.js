/* Erzeugt merchant-feed.xml (Produktdatei für das Google Merchant Center)
   aus preise.json. Aufruf: node scripts/merchant-feed.js
   Läuft automatisch per GitHub-Action, sobald preise.json geändert wird. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOP = 'https://kronenwelt.de/';
const IMG = 'https://res.cloudinary.com/dw6amyijc/image/upload/v20551/';

const KRONEN = {
  'Party': {
    titel: 'Party Geburtstagskrone für Hunde mit Namen',
    text: 'Bunte Geburtstagskrone für Hunde mit weichen Bommeln, personalisiert mit dem Namen deines Hundes (bis 11 Zeichen).',
    bild: 'party-krone.jpg'
  },
  'Einfarbig': {
    titel: 'Einfarbige Hundekrone mit Namen',
    text: 'Einfarbige Hundekrone aus weichem Filz mit handgefertigten Bommeln, personalisiert mit dem Namen deines Hundes (bis 11 Zeichen).',
    bild: 'uni-mint.jpg'
  },
  'Glitzer': {
    titel: 'Glitzer Geburtstagskrone für Hunde mit Namen',
    text: 'Glitzernde Geburtstagskrone für Hunde mit Bommeln, personalisiert mit dem Namen deines Hundes (bis 11 Zeichen).',
    bild: 'glitzer-krone.jpg'
  },
  'Edel & Wild': {
    titel: 'Hundekrone Edel & Wild',
    text: 'Edle Hundekrone in Gold, Schwarz oder im Leo-Look mit goldenen Bommeln. Gold und Schwarz mit Namen personalisierbar, Leo-Muster ohne Aufdruck.',
    bild: 'royal-krone.jpg'
  },
  'Zahlenkrone Klassik': {
    titel: 'Zahlenkrone Klassik für Hunde – Geburtstagskrone mit Wechselzahlen',
    text: 'Geburtstagskrone für Hunde mit austauschbaren Zahlenpads – das Alter jedes Jahr neu anpassen und die Krone wieder verwenden. Inklusive 3 Zahlenpads.',
    bild: 'zahl-klassik-krone.jpg'
  },
  'Zahlenkrone Leo': {
    titel: 'Zahlenkrone Leo für Hunde – Geburtstagskrone mit Wechselzahlen',
    text: 'Geburtstagskrone für Hunde im Leo-Look mit austauschbaren Zahlenpads, jedes Jahr wieder verwendbar. Inklusive 3 Zahlenpads.',
    bild: 'zahl-leo-krone.jpg'
  },
  'Zahlenkrone Glitzer': {
    titel: 'Zahlenkrone Glitzer rosa für Hunde – Geburtstagskrone mit Wechselzahlen',
    text: 'Glitzernde Geburtstagskrone in Rosa mit austauschbaren Zahlenpads, jedes Jahr wieder verwendbar. Inklusive 3 Zahlenpads.',
    bild: 'zahl-glitzer-krone.jpg'
  },
  'Zahlenkrone Konfetti': {
    titel: 'Zahlenkrone Konfetti für Hunde – Geburtstagskrone mit Wechselzahlen',
    text: 'Geburtstagskrone im Konfetti-Look mit austauschbaren Zahlenpads, jedes Jahr wieder verwendbar. Inklusive 3 Zahlenpads.',
    bild: 'zahl-konfetti-krone.jpg'
  }
};

const GROESSEN = {
  'Gross':      { name: 'Groß',       info: 'Umfang ca. 37 cm, z. B. für Golden Retriever, Border Collie, Doodle' },
  'Klein':      { name: 'Klein',      info: 'Umfang ca. 26 cm, z. B. für Malteser, Französische Bulldogge' },
  'Mini':       { name: 'Mini',       info: 'Umfang ca. 22 cm, z. B. für Zwergdackel, Zwergpudel' },
  'Extra Mini': { name: 'Extra Mini', info: 'Umfang ca. 18 cm, z. B. für Chihuahua' }
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = s => s.toLowerCase().replace(/&/g, 'und').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const preise = JSON.parse(fs.readFileSync(path.join(ROOT, 'preise.json'), 'utf8'));
const items = [];
for (const [krone, meta] of Object.entries(KRONEN)) {
  const p = preise[krone];
  if (!p) continue;
  for (const [groesse, preis] of Object.entries(p)) {
    if (typeof preis !== 'number' || !GROESSEN[groesse]) continue;
    const g = GROESSEN[groesse];
    const link = SHOP + '?krone=' + encodeURIComponent(krone) + '&groesse=' + encodeURIComponent(groesse) + '#bestellen';
    items.push(`  <item>
    <g:id>${esc(slug(krone) + '-' + slug(groesse))}</g:id>
    <g:item_group_id>${esc(slug(krone))}</g:item_group_id>
    <g:title>${esc(meta.titel + ' – Größe ' + g.name)}</g:title>
    <g:description>${esc(meta.text + ' Größe ' + g.name + ': ' + g.info + '. Handgemacht in Deutschland, kostenloser Versand.')}</g:description>
    <g:link>${esc(link)}</g:link>
    <g:image_link>${esc(IMG + meta.bild)}</g:image_link>
    <g:availability>in_stock</g:availability>
    <g:price>${preis.toFixed(2)} EUR</g:price>
    <g:brand>Mila's Kronenwelt</g:brand>
    <g:condition>new</g:condition>
    <g:identifier_exists>no</g:identifier_exists>
    <g:google_product_category>5004</g:google_product_category>
    <g:product_type>Hundekronen &gt; ${esc(krone)}</g:product_type>
    <g:size>${esc(g.name)}</g:size>
    <g:is_bundle>no</g:is_bundle>
    <g:shipping>
      <g:country>DE</g:country>
      <g:price>0.00 EUR</g:price>
    </g:shipping>
  </item>`);
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Automatisch erzeugt aus preise.json – nicht von Hand bearbeiten (scripts/merchant-feed.js) -->
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>Mila's Kronenwelt</title>
  <link>${SHOP}</link>
  <description>Handgemachte, personalisierte Geburtstagskronen für Hunde</description>
${items.join('\n')}
</channel>
</rss>
`;
fs.writeFileSync(path.join(ROOT, 'merchant-feed.xml'), xml);
console.log(items.length + ' Produkte in merchant-feed.xml');
