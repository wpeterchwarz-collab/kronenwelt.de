/* Erzeugt merchant-feed.xml (Produktdatei für das Google Merchant Center)
   aus katalog.json (+ weitere Fotos aus medien.json). Aufruf: node scripts/merchant-feed.js
   Läuft automatisch per GitHub-Action, sobald katalog.json oder medien.json geändert wird. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOP = 'https://kronenwelt.de/';
const IMG = 'https://res.cloudinary.com/dw6amyijc/image/upload/v20551/';

// Produkte, Größen, Preise, Texte und Hauptfotos kommen aus katalog.json (eine Quelle mit Website und Admin).
const katalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'katalog.json'), 'utf8'));
const GROESSEN = {};
katalog.merkmale.groesse.werte.forEach(g => { GROESSEN[g.wert] = { name: g.name, info: g.info }; });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = s => s.toLowerCase().replace(/&/g, 'und').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Weitere Fotos (bis zu 5 zusätzlich) aus medien.json → additional_image_link
let medien = {};
try { medien = JSON.parse(fs.readFileSync(path.join(ROOT, 'medien.json'), 'utf8')); } catch (e) { medien = {}; }
const zusatzBilder = krone => {
  const d = ((medien[krone] || {})._default || {}).bilder;
  return (Array.isArray(d) ? d : [])
    .map(x => String(x || '').trim().replace(/\.(jpe?g|png|webp)$/i, ''))
    .filter(Boolean).slice(0, 5)
    .map(id => `\n    <g:additional_image_link>${esc(IMG + id + '.jpg')}</g:additional_image_link>`).join('');
};

const items = [];
for (const produkt of katalog.produkte) {
  const krone = produkt.name;
  const meta = { titel: produkt.texte.googleTitel, text: produkt.texte.googleText, bild: produkt.hauptfoto + '.jpg' };
  if (!meta.titel || !produkt.hauptfoto) continue;
  for (const { wert: groesse, preis } of produkt.merkmale.groesse) {
    if (typeof preis !== 'number' || !GROESSEN[groesse]) continue;
    const g = GROESSEN[groesse];
    const link = SHOP + '?krone=' + encodeURIComponent(krone) + '&groesse=' + encodeURIComponent(groesse) + '#bestellen';
    items.push(`  <item>
    <g:id>${esc(slug(krone) + '-' + slug(groesse))}</g:id>
    <g:item_group_id>${esc(slug(krone))}</g:item_group_id>
    <g:title>${esc(meta.titel + ' – Größe ' + g.name)}</g:title>
    <g:description>${esc(meta.text + ' Größe ' + g.name + ': ' + g.info + '. Handgemacht in Deutschland, kostenloser Versand.')}</g:description>
    <g:link>${esc(link)}</g:link>
    <g:image_link>${esc(IMG + meta.bild)}</g:image_link>${zusatzBilder(krone)}
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
<!-- Automatisch erzeugt aus katalog.json – nicht von Hand bearbeiten (scripts/merchant-feed.js) -->
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
