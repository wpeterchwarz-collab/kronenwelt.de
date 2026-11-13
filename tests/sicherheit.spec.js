// Der Admin liegt öffentlich im Repo und auf kronenwelt.de. Diese Tests passen auf, dass dabei nichts Geheimes mitwandert.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const lesen = d => fs.readFileSync(path.join(ROOT, d), 'utf8');

test('keine Zugangsdaten in öffentlichen Dateien', () => {
  const dateien = ['admin.html', 'index.html', 'config.js', 'apps-script/Code.gs', 'admin.webmanifest'];
  for (const d of dateien) {
    const t = lesen(d);
    expect(t, d).not.toMatch(/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/);   // GitHub-Token
    expect(t, d).not.toMatch(/sk_(live|test)_[A-Za-z0-9]{10,}/);                     // Bezahl-Secrets
    expect(t, d).not.toContain('kronenwelt2024');                                      // altes Standardpasswort
  }
  expect(lesen('admin.html')).not.toMatch(/mkw_admin_pw['"]\s*,/);                   // Passwort wird nie mehr gespeichert
});

test('Admin: nicht für Suchmaschinen, als App installierbar, Shop verlinkt ihn nicht', () => {
  const admin = lesen('admin.html');
  expect(admin).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(admin).toContain('<link rel="manifest" href="admin.webmanifest">');
  expect(lesen('robots.txt')).toMatch(/^Disallow: \/admin\.html$/m);
  expect(lesen('sitemap.xml')).not.toContain('admin');
  expect(lesen('index.html')).not.toContain('admin.html');
  const m = JSON.parse(lesen('admin.webmanifest'));
  expect(m).toMatchObject({ start_url: '/admin.html', display: 'standalone' });
  for (const i of m.icons) expect(fs.existsSync(path.join(ROOT, i.src))).toBe(true);
});

test('EmailJS: nur noch die Mail an Sara (Empfänger fest in der Vorlage)', () => {
  const shop = lesen('index.html');
  expect(shop).toContain("'template_wihnwzo'");
  expect(shop).not.toContain('template_kodm23r');
});
