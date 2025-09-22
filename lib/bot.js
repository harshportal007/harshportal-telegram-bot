// lib/bot.js
// Telegraf bot configured for webhooks (no bot.launch)

require('dotenv').config({ override: true });

const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

/** ---------- env ---------- */
const {
  TELEGRAM_BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_KEY,
  ADMIN_ID: ADMIN_ID_ENV
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN / SUPABASE_URL / SUPABASE_KEY');
}

const ADMIN_ID = Number(ADMIN_ID_ENV || 7057639075);

/** ---------- supabase (service role) ---------- */
const supabase = createClient(SUPABASE_URL.trim(), SUPABASE_KEY.trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
  global: { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
});

/** ---------- helpers ---------- */
const html = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

async function safeReply(ctx, text, extra = {}) {
  try {
    return await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  } catch (e) {
    console.error('Reply error:', e);
  }
}

async function notifyAdmin(bot, text, extra = {}) {
  try {
    return await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    console.error('Admin notify error:', e);
  }
}

function reportSupaError(ctx, cmd, error, bot) {
  console.error(`${cmd} error:`, error);
  safeReply(ctx, `❌ Error fetching ${cmd.replace('/', '')}.`);
  const msg = error?.message || (typeof error === 'string' ? error : JSON.stringify(error));
  notifyAdmin(bot, `❌ <b>${cmd}</b> failed:\n<pre>${html(msg)}</pre>`);
}

/** ---------- singleton bot so Vercel can reuse across invocations ---------- */
let _bot;
function getBot() {
  if (_bot) return _bot;

  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

  // Command list visible in Telegram; guard against transient network errors
  bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot and see welcome message' },
    { command: 'help',  description: 'Show help menu' },
    { command: 'order', description: 'Get order details (/order <id>)' },
    { command: 'product', description: 'Get product info (/product <name>)' },
    { command: 'user',  description: 'Get user details (/user <email>)' },
    { command: 'contact', description: 'Send a message to admin (/contact <msg>)' }
  ]).catch(e => console.error('setMyCommands failed:', e?.response?.description || e?.message || e));

  const adminContact =
    `For urgent help, message admin at:<br/>` +
    `📧 <a href="mailto:support@harshportal.in">support@harshportal.in</a><br/>` +
    `📱 Telegram: @harshportal`;

  const commandMenu = [
    '<b>Commands:</b>',
    '/order &lt;orderId&gt; – Get order details',
    '/product &lt;product name&gt; – Get product info',
    '/user &lt;email&gt; – Get user details',
    '/contact &lt;your message&gt; – Contact admin',
    '/help – Show this menu',
    '',
    adminContact
  ].join('\n');

  /** -------- basics -------- */
  bot.start((ctx) => safeReply(ctx,
    `👋 Welcome to <b>Harshportal Support Bot</b>!<br/><br/>` +
    `You can ask about your orders, products, account, or any help you need.<br/><br/>` +
    commandMenu
  ));
  bot.command('help', (ctx) => safeReply(ctx, commandMenu));

  /** -------- contact & reply -------- */
  bot.command('contact', async (ctx) => {
    const msg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!msg) return safeReply(ctx, 'Please type your message after <code>/contact</code>.');

    const from = ctx.from || {};
    const userHandle = from.username ? `@${from.username}` : html(from.first_name || 'User');
    const header = `📩 <b>New message</b>\nFrom: ${userHandle} (ID: <code>${from.id}</code>)\n\n`;
    await notifyAdmin(bot, header + html(msg));
    await safeReply(ctx, '✅ Your message has been sent to the admin. You will get a reply here soon!');
  });

  bot.command('reply', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return; // admin-only
    const args = ctx.message.text.split(' ').slice(1);
    const userId = args.shift();
    const replyMsg = args.join(' ').trim();
    if (!userId || !replyMsg) {
      return safeReply(ctx, 'Usage: <code>/reply &lt;user_id&gt; &lt;message&gt;</code>');
    }
    try {
      await bot.telegram.sendMessage(userId, `💬 <b>Admin:</b> ${html(replyMsg)}`, { parse_mode: 'HTML' });
      await safeReply(ctx, '✅ Reply sent to user.');
    } catch (e) {
      console.error('Admin reply error:', e);
      await safeReply(ctx, '❌ Could not deliver the message. Double-check the user ID.');
    }
  });

  /** -------- /order (robust column probing) -------- */
  bot.command('order', async (ctx) => {
    const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!raw) return safeReply(ctx, 'Usage: <code>/order &lt;orderId&gt;</code>');

    const cols = ['order_number','order_code','public_id','code','reference','id'];

    const tryCol = async (c) => {
      try {
        const { data, error } = await supabase.from('orders').select('*').eq(c, raw).maybeSingle();
        if (error) {
          if (/column .* does not exist/i.test(error.message)) return null;
          throw error;
        }
        return data || null;
      } catch (e) {
        if (/column .* does not exist/i.test(String(e.message))) return null;
        throw e;
      }
    };

    try {
      let order = null;
      for (const c of cols) { order = await tryCol(c); if (order) break; }
      if (!order) return safeReply(ctx, 'No matching order found.');

      const o = order;
      const idStr = String(o.order_number ?? o.order_code ?? o.public_id ?? o.code ?? o.reference ?? o.id ?? raw);
      const lines = [
        `🧾 <b>Order</b> <code>${html(idStr)}</code>`,
        o.customer        != null ? `👤 <b>Customer:</b> ${html(String(o.customer))}` : null,
        o.status          != null ? `📦 <b>Status:</b> ${html(String(o.status))}` : null,
        o.paymentmethod   != null ? `💳 <b>Payment:</b> ${html(String(o.paymentmethod))}` : null,
        o.total           != null ? `💰 <b>Total:</b> ₹${html(String(o.total))}` : null,
        o.date            != null ? `🗓️ <b>Date:</b> ${html(String(o.date))}` : null,
        o.created_at      != null ? `🕒 <b>Created:</b> ${html(String(o.created_at))}` : null
      ].filter(Boolean).join('\n');

      return safeReply(ctx, lines || 'Found the order, but fields are empty.');
    } catch (e) {
      return reportSupaError(ctx, '/order', e, bot);
    }
  });

  /** -------- /product (search in products & exclusive_products) -------- */
  bot.command('product', async (ctx) => {
    const qtext = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!qtext) return safeReply(ctx, 'Usage: <code>/product &lt;product name&gt;</code>');
    const fmtINR = (v) => (v==null || v==='') ? null : Number(v).toLocaleString('en-IN');

    const searchProducts = async () => {
      const exact = await supabase
        .from('products')
        .select('id,name,price,"originalPrice",stock,category,tags,description,image')
        .eq('name', qtext)
        .limit(1);
      if (!exact.error && exact.data?.length) return { table: 'products', row: exact.data[0] };

      const fuzzy = await supabase
        .from('products')
        .select('id,name,price,"originalPrice",stock,category,tags,description,image')
        .ilike('name', `%${qtext}%`)
        .order('name', { ascending: true })
        .limit(1);
      if (!fuzzy.error && fuzzy.data?.length) return { table: 'products', row: fuzzy.data[0] };

      if (exact.error) throw exact.error;
      if (fuzzy.error) throw fuzzy.error;
      return null;
    };

    const searchExclusive = async () => {
      const exact = await supabase
        .from('exclusive_products')
        .select('id,uuid,name,price,plan,tags,description,image_url,is_active,created_at')
        .eq('name', qtext)
        .limit(1);
      if (!exact.error && exact.data?.length) return { table: 'exclusive_products', row: exact.data[0] };

      const fuzzy = await supabase
        .from('exclusive_products')
        .select('id,uuid,name,price,plan,tags,description,image_url,is_active,created_at')
        .ilike('name', `%${qtext}%`)
        .order('name', { ascending: true })
        .limit(1);
      if (!fuzzy.error && fuzzy.data?.length) return { table: 'exclusive_products', row: fuzzy.data[0] };

      if (exact.error) throw exact.error;
      if (fuzzy.error) throw fuzzy.error;
      return null;
    };

    try {
      let found = await searchProducts();
      if (!found) found = await searchExclusive();
      if (!found) return safeReply(ctx, 'No matching product found.');

      const { table, row } = found;
      if (table === 'products') {
        const lines = [
          `🛍️ <b>${html(row.name)}</b>`,
          row.category ? `🗂️ <b>Category:</b> ${html(row.category)}` : null,
          row.price != null ? `💰 <b>Price:</b> ₹${fmtINR(row.price)}` : null,
          row.originalPrice != null ? `🏷️ <b>MRP:</b> ₹${fmtINR(row.originalPrice)}` : null,
          row.stock != null ? `📦 <b>Stock:</b> ${html(String(row.stock))}` : null,
          Array.isArray(row.tags) && row.tags.length ? `🔖 <b>Tags:</b> ${html(row.tags.join(', '))}` : null,
          row.description ? `\n📝 ${html(row.description)}` : null,
          `\n🆔 <b>ID:</b> <code>${row.id}</code> (products)`
        ].filter(Boolean).join('\n');

        return safeReply(
          ctx,
          lines,
          row.image ? { reply_markup: { inline_keyboard: [[{ text: 'View Image', url: row.image }]] } } : {}
        );
      } else {
        const lines = [
          `🌟 <b>${html(row.name)}</b>`,
          row.plan ? `📦 <b>Plan:</b> ${html(row.plan)}` : null,
          row.price != null ? `💰 <b>Price:</b> ₹${fmtINR(row.price)}` : null,
          Array.isArray(row.tags) && row.tags.length ? `🔖 <b>Tags:</b> ${html(row.tags.join(', '))}` : null,
          row.is_active != null ? `✅ <b>Active:</b> ${row.is_active ? 'Yes' : 'No'}` : null,
          row.created_at ? `🕒 <b>Created:</b> ${html(String(row.created_at))}` : null,
          row.description ? `\n📝 ${html(row.description)}` : null,
          `\n🆔 <b>ID:</b> <code>${row.id}</code>  •  <b>UUID:</b> <code>${row.uuid}</code> (exclusive_products)`
        ].filter(Boolean).join('\n');

        return safeReply(
          ctx,
          lines,
          row.image_url ? { reply_markup: { inline_keyboard: [[{ text: 'View Image', url: row.image_url }]] } } : {}
        );
      }
    } catch (e) {
      return reportSupaError(ctx, '/product', e, bot);
    }
  });

  /** -------- /user (profiles + auth.admin fallback) -------- */
  bot.command('user', async (ctx) => {
    const email = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!email) return safeReply(ctx, 'Usage: <code>/user &lt;email&gt;</code>');

    try {
      let profile;
      try {
        const { data, error } = await supabase
          .from('profiles').select('email, full_name, created_at')
          .ilike('email', `%${email}%`).order('created_at', { ascending: false }).limit(1);
        if (error && !/relation .* does not exist/i.test(error.message)) throw error;
        profile = (data && data[0]) || null;
      } catch { /* ignore and fall back */ }

      let user = null;
      try {
        const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 2000 });
        user = list?.data?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase()) || null;
      } catch (e) { console.error('auth.admin error:', e); }

      if (!profile && !user) return safeReply(ctx, 'No matching user found.');

      const lines = [
        '👤 <b>User</b>',
        profile?.email || user?.email ? `📧 <b>Email:</b> ${html(profile?.email || user?.email)}` : null,
        profile?.full_name ? `🪪 <b>Name:</b> ${html(profile.full_name)}` : null,
        (profile?.created_at || user?.created_at) ? `📅 <b>Joined:</b> ${html(String(profile?.created_at || user?.created_at))}` : null,
        user?.id ? `🆔 <b>Auth ID:</b> <code>${html(user.id)}</code>` : null,
        user?.phone ? `📱 <b>Phone:</b> ${html(user.phone)}` : null,
        user?.confirmed_at ? `✅ <b>Email confirmed:</b> ${html(String(user.confirmed_at))}` : null,
        user?.last_sign_in_at ? `🕑 <b>Last sign-in:</b> ${html(String(user.last_sign_in_at))}` : null
      ].filter(Boolean).join('\n');

      return safeReply(ctx, lines);
    } catch (e) {
      reportSupaError(ctx, '/user', e, bot);
    }
  });

  /** -------- friendly greetings & simple FAQ -------- */
  bot.hears(/^(hi|hello|hey|h+i+|hola|yo|sup)$/i, (ctx) =>
    safeReply(ctx, 'Hello! 👋 How can I help you today?')
  );

  bot.on('text', async (ctx, next) => {
    const text = (ctx.message?.text || '').trim();
    if (/^\/(contact|reply|order|product|user|help|start)\b/i.test(text)) return next();
    if (text.length < 3) return next();

    try {
      const { data, error } = await supabase.from('faqs').select('answer').ilike('question', `%${text}%`).limit(1);
      if (error) return next();
      if (data?.length) return safeReply(ctx, html(data[0].answer));
      return safeReply(ctx, `Sorry, I don't have an answer for that yet.<br/><br/>` +
        `💡 <b>Tip</b>: Use <code>/help</code> to see all commands!<br/>` + adminContact);
    } catch { return next(); }
  });

  _bot = bot;
  return _bot;
}

module.exports = getBot();
