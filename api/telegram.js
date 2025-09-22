// api/telegram.js
const bot = require('../lib/bot');

const SECRET = process.env.TG_WEBHOOK_SECRET || ''; // set this in Vercel

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('ok'); // health check
    return;
  }

  // Optional: verify Telegram secret header
  const token = req.headers['x-telegram-bot-api-secret-token'];
  if (SECRET && token !== SECRET) {
    return res.status(401).send('unauthorized');
  }

  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (e) {
    console.error('handleUpdate error', e);
    // Always 200 to avoid Telegram retry storm if error is ours
    res.status(200).send('OK');
  }
};
