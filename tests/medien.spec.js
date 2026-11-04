// Tests für weitere Produktfotos (bis zu 6) und Produktvideo aus medien.json
const { test, expect } = require('@playwright/test');

// 1×1-Pixel-Bild als Ersatz für Cloudinary-Fotos
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const MEDIEN = {
  'Party': {
    '_default': { bilder: ['party-2', 'party-3', 'party-4', 'party-5', 'party-6', 'party-7-zuviel'], video: 'party-clip' },
    'Grau mit Punkten': { bilder: ['party-grau-2.jpg'] }
  },
  'Glitzer': { '_default': { bilder: ['glitzer-2', 'fehlt-auf-cloudinary'] } }
};

async function openMitMedien(page, { errors } = {}) {
  if (errors) page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.route(/res\.cloudinary\.com\/.*\/image\/upload\//, route =>
    route.request().url().includes('fehlt-auf-cloudinary')
      ? route.fulfill({ status: 404, body: '' })
      : route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.route(/res\.cloudinary\.com\/.*\/video\/upload\/.*\.jpg/, route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.route('**/medien.json', route => route.fulfill({ json: MEDIEN }));
  await page.goto('/index.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.click('#ckViewMain .ck-btn-primary');
  await expect(page.locator('#colorChips [data-c]').first()).toBeVisible();
}

test('Konfigurator: höchstens 6 Fotos + 1 Video als Vorschaubilder', async ({ page }) => {
  const errors = [];
  await openMitMedien(page, { errors });
  await page.click('[data-v="Party"]');
  const thumbs = page.locator('#pThumbs .prev-thumb');
  await expect(thumbs).toHaveCount(7);                      // 6 Fotos + Video
  await expect(page.locator('#pThumbs .prev-thumb .play')).toHaveCount(1);
  // Klick auf 3. Foto wechselt das große Vorschaubild
  await thumbs.nth(2).click();
  await expect(thumbs.nth(2)).toHaveClass(/on/);
  await expect(page.locator('#pImg')).toHaveAttribute('src', /party-3\.jpg/);
  expect(errors).toEqual([]);
});

test('Konfigurator: Farbe mit eigenen Fotos, Video kommt aus _default', async ({ page }) => {
  await openMitMedien(page);
  await page.click('[data-v="Party"]');
  await page.click('#colorChips [data-c="Grau mit Punkten"]');
  const thumbs = page.locator('#pThumbs .prev-thumb');
  await expect(thumbs).toHaveCount(3);                      // Hauptfoto + 1 eigenes + Video
  await expect(thumbs.nth(1).locator('img')).toHaveAttribute('src', /party-grau-2\.jpg/);
});

test('Konfigurator: fehlendes Foto wird ausgeblendet, ohne medien.json keine Vorschaubilder', async ({ page }) => {
  await openMitMedien(page);
  await page.click('[data-v="Glitzer"]');
  await expect(page.locator('#pThumbs .prev-thumb')).toHaveCount(2);
  await page.click('[data-v="Einfarbig"]');
  await expect(page.locator('#pThumbs .prev-thumb')).toHaveCount(0);
});

test('Lightbox: blättern, Video abspielen, schließen', async ({ page }) => {
  await openMitMedien(page);
  await page.click('[data-v="Party"]');
  await expect(page.locator('#pBox')).toHaveClass(/has-photo/);
  await page.click('#pBox');
  const ov = page.locator('#lightboxOverlay');
  await expect(ov).toHaveClass(/open/);
  await expect(page.locator('#lightboxCaption')).toContainText('1 / 7');
  await page.keyboard.press('ArrowLeft');                   // vom ersten rückwärts → Video
  await expect(page.locator('#lightboxVideo')).toBeVisible();
  await expect(page.locator('#lightboxVideo')).toHaveAttribute('src', /video\/upload\/.*party-clip\.mp4/);
  await expect(page.locator('#lightboxCaption')).toContainText('Video');
  await page.click('.lb-next');
  await expect(page.locator('#lightboxImg')).toBeVisible();
  await expect(page.locator('#lightboxCaption')).toContainText('1 / 7');
  await page.keyboard.press('Escape');
  await expect(ov).not.toHaveClass(/open/);
});

test('Produktkarte: Knopf öffnet Fotos, ohne in den Konfigurator zu springen', async ({ page }) => {
  await openMitMedien(page);
  const btn = page.locator('.prod-card[data-variant="Party"] .prod-media-btn');
  await expect(btn).toContainText('6');
  await expect(btn).toContainText('Video');
  await expect(page.locator('.prod-card[data-variant="Einfarbig"] .prod-media-btn')).toHaveCount(0);
  await btn.click();
  await expect(page.locator('#lightboxOverlay')).toHaveClass(/open/);
  await expect(page.locator('#lightboxCaption')).toContainText('Party');
});

test('Galerie-Lightbox funktioniert weiter mit einem Foto (ohne Pfeile)', async ({ page }) => {
  await openMitMedien(page);
  await page.evaluate(() => openLightbox('https://res.cloudinary.com/dw6amyijc/image/upload/x.jpg', 'Luna'));
  await expect(page.locator('#lightboxOverlay')).toHaveClass(/open/);
  await expect(page.locator('#lightboxOverlay')).not.toHaveClass(/multi/);
  await expect(page.locator('#lightboxCaption')).toHaveText('Luna');
});
