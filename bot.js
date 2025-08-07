require('dotenv').config();

const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// -- Set up environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;

// -- Admin Telegram user ID (get from @userinfobot or your own Telegram ID)
const ADMIN_ID = 7057639075; // <<< REPLACE with your real Telegram user ID

// -- Initialize Supabase (optional)
const supabase = createClient(supabaseUrl, supabaseKey);

// -- Initialize bot
const bot = new Telegraf(botToken);

// 1. Start/help commands
const adminContact = "For urgent help, message admin at:\n📧 support@harshportal.in\n📱 Telegram: @harshportal";
const commandMenu =
  `*Commands:*\n` +
  `/order <orderId> - Get order details\n` +
  `/product <product name> - Get product info\n` +
  `/user <email> - Get user details\n` +
  `/contact <your message> - Contact admin\n` +
  `/help - Show this menu\n\n` +
  `${adminContact}`;

bot.start((ctx) => ctx.reply(
  `👋 Welcome to Harshportal Support Bot!\n\nYou can ask about your orders, products, account, or any help you need.\n\n${commandMenu}`
));
bot.command('help', (ctx) => ctx.reply(commandMenu));

// 2. Contact admin handler (user to admin relay)
bot.command('contact', async (ctx) => {
  const msg = ctx.message.text.split(' ').slice(1).join(' ');
  if (!msg) return ctx.reply('Please type your message after /contact.');

  await bot.telegram.sendMessage(
    ADMIN_ID,
    `📩 New message from @${ctx.from.username || ctx.from.first_name} (ID: ${ctx.from.id}):\n\n${msg}`
  );
  ctx.reply('Your message has been sent to the admin. You will get a reply here soon!');
});

// 3. Admin reply handler (admin to user relay)
bot.command('reply', async (ctx) => {
  // Only allow admin to use this
  if (ctx.from.id !== ADMIN_ID) return;

  const args = ctx.message.text.split(' ').slice(1);
  const userId = args.shift();
  const replyMsg = args.join(' ');
  if (!userId || !replyMsg) return ctx.reply('Usage: /reply <user_id> <message>');

  await bot.telegram.sendMessage(userId, `💬 Admin: ${replyMsg}`);
  ctx.reply('Reply sent to user.');
});

// 4. Greet handler
bot.hears(/^(hi|hello|hey|hii|hiiii|hola|yo|sup)$/i, (ctx) => {
  ctx.reply('Hello! 👋 How can I help you today?');
});

// 5. (Optional) FAQ fallback (requires Supabase "faqs" table)
bot.on('text', async (ctx, next) => {
  // If user used /contact or /reply, skip FAQ fallback
  if (ctx.message.text.startsWith('/contact') || ctx.message.text.startsWith('/reply')) return next();

  // If Supabase is not configured, skip this handler
  if (!supabaseUrl || !supabaseKey) return next();

  // Simple FAQ fallback
  const userText = ctx.message.text;
  const { data, error } = await supabase
    .from('faqs')
    .select('answer')
    .ilike('question', `%${userText}%`);

  if (data && data.length > 0) {
    ctx.reply(data[0].answer);
  } else {
    ctx.reply(
      "Sorry, I do not have an answer for that yet.\n\n" +
      "💡 *Tip*: Use /help to see all commands!\n" +
      `${adminContact}`
    );
  }
});

// --- LAUNCH THE BOT ---
bot.launch();
console.log('Harshportal Bot is running...');

process.on('SIGINT', () => bot.stop('SIGINT'));
process.on('SIGTERM', () => bot.stop('SIGTERM'));
