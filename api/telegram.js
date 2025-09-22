// api/telegram.js
// Webhook handler for Telegram → Telegraf on Vercel

module.exports = async (req, res) => {
  try {
    // simple health check for GET/OPTIONS
    if (req.method !== 'POST') return res.status(200).send('ok');

    // verify Telegram secret header (must match TG_WEBHOOK_SECRET env)
    const expected = process.env.TG_WEBHOOK_SECRET || '';
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (expected && got !== expected) return res.status(401).send('unauthorized');

    // body may be a string on some edge runtimes
    const update = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    // lazy import so any import-time error doesn't break health checks
    let bot;
    try {
      bot = require('../lib/bot');
    } catch (e) {
      console.error('bot import failed:', e);
      // Return 200 so Telegram doesn't retry-storm while you fix the import
      return res.status(200).json({ ok: true });
    }

    await bot.handleUpdate(update);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    // Always 200 to avoid Telegram retry storms
    return res.status(200).json({ ok: true });
  }
};
