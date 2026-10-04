const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bypassSFL(url) {
  if (!url || !url.startsWith('http')) throw new Error('URL tidak valid');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--single-process',
      '--no-zygote',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36'
    );
    await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.open = () => {};
      window.alert = () => {};
      window.confirm = () => true;
    });

    await page.evaluateOnNewDocument((accel) => {
      const NT = window.setTimeout;
      const NI = window.setInterval;
      window.setTimeout = (f, m) => NT(f, m / accel);
      window.setInterval = (f, m) => NI(f, m / accel);
    }, 1e7);

    // === GOTO dengan handle error redirect ===
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } catch (e) {
      // Abaikan error navigasi — halaman mungkin udah redirect
      if (!/Execution context|navigation|ERR_ABORTED/i.test(e.message)) {
        throw e;
      }
    }

    // Tunggu halaman stabil dulu
    await sleep(2000);

    const selectors = [
      '#submit-button',
      '#btn-2',
      '#verify > a',
      '#verify > button',
      '#first_open_button_page_1',
      '#btn-3',
    ];

    const start = Date.now();
    let finalUrl = page.url();

    // === LOOP UTAMA — semua operasi dibungkus try/catch ===
    while (Date.now() - start < 60000) {
      // Baca URL dengan aman
      let currentUrl;
      try {
        currentUrl = page.url();
      } catch {
        currentUrl = finalUrl;
      }

      // Kalau udah keluar dari sfl.gl → selesai
      if (currentUrl !== finalUrl && !/sfl\.gl/i.test(currentUrl)) {
        finalUrl = currentUrl;
        break;
      }
      finalUrl = currentUrl;

      // Coba klik tombol
      try {
        await page.evaluate((sels) => {
          for (const sel of sels) {
            for (const el of document.querySelectorAll(sel)) {
              if (el && el.offsetParent !== null && !el.dataset.bypassed) {
                if (sel === '#verify > a' && el.textContent.trim() === 'Scroll Down')
                  continue;
                el.dataset.bypassed = '1';
                try { el.click(); } catch {}
              }
            }
          }
          if (location.href.includes('sfl.gl/ready/go')) {
            for (const el of document.querySelectorAll('span.font-medium.text-base')) {
              if (el.textContent.trim() === 'OPEN LINK' && !el.dataset.bypassed) {
                el.dataset.bypassed = '1';
                el.click();
              }
            }
          }
        }, selectors);
      } catch (e) {
        // Abaikan error navigasi
        if (!/Execution context|Cannot find context|navigation/i.test(e.message)) {
          console.error('[loop]', e.message);
        }
      }

      await sleep(400);
    }

    // Tunggu redirect final
    await sleep(3000);

    try {
      finalUrl = page.url();
    } catch {}

    if (/sfl\.gl/i.test(finalUrl)) {
      return {
        success: false,
        original: url,
        result: finalUrl,
        error: 'Bypass gagal — masih di halaman SFL.GL',
      };
    }

    return {
      success: true,
      original: url,
      result: finalUrl,
      service: 'sfl.gl',
      via: 'puppeteer',
    };
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}

app.get('/api/bypass', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success: false, error: 'Parameter ?url= required' });

  const start = Date.now();
  try {
    const result = await bypassSFL(url);
    res.json({ ...result, time: `${((Date.now() - start) / 1000).toFixed(2)}s` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, original: url });
  }
});

app.get('/', (req, res) => {
  res.json({
    creator: 'xDonzCode',
    scraperName: 'sfl.gl',
    status: 'online',
    usage: '/api/bypass?url=https://sfl.gl/xxx',
  });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
