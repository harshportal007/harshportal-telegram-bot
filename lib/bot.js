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
const html = (t) => String(t)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;');

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

  /** -------- command sets (different for user vs admin) -------- */
// define user commands once
const userCommands = [
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Show help menu' },
  { command: 'order', description: 'Check your order (/order <id>)' },
  { command: 'product', description: 'Search product (/product <name>)' },
  { command: 'contact', description: 'Message admin (/contact <msg>)' },
  { command: 'ticket', description: 'Open support ticket (/ticket <issue>)' },
  { command: 'mytickets', description: 'View your tickets' }
];

// set for all private chats (normal users)
bot.telegram.setMyCommands(userCommands, {
  scope: { type: 'all_private_chats' }
});

// now extend with admin-only commands
const adminCommands = [
  ...userCommands,
  { command: 'reply', description: 'Reply to user (/reply <user_id> <msg>)' },
  { command: 'user', description: 'Lookup user (/user <email>)' },
  { command: 'alltickets', description: 'View all tickets' },
  { command: 'replyticket', description: 'Reply to ticket (/replyticket <id> <msg>)' }
];
// set for the admin only
bot.telegram.setMyCommands(adminCommands, {
  scope: { type: 'chat', chat_id: ADMIN_ID }
});


  // dynamically set commands per user role
  bot.use(async (ctx, next) => {
    try {
      if (ctx.from?.id === ADMIN_ID) {
        await bot.telegram.setMyCommands(adminCommands);
      } else {
        await bot.telegram.setMyCommands(userCommands);
      }
    } catch (e) {
      console.error('setMyCommands failed:', e?.response?.description || e?.message || e);
    }
    return next();
  });

  const adminContact =
    `For urgent help, contact admin:\n` +
    `📧 support@harshportal.in\n` +
    `📱 Telegram: @harshportal`;

  const userMenu = [
    '<b>Available Commands:</b>',
    '/order <orderId> – Track your order',
    '/product <name> – Get product info',
    '/contact <message> – Contact support',
    '/help – Show this menu',
    '',
    adminContact
  ].join('\n');

const adminMenu = [
  '<b>Admin Commands:</b>',
  '/order <orderId> – Lookup orders',
  '/product <name> – Lookup products',
  '/user <email> – Lookup user details',
  '/reply <user_id> <msg> – Reply to a user',
  '/alltickets – View all tickets',
  '/replyticket <id> <msg> – Reply & close a ticket',
  '/help – Show this menu'
].join('\n');


  /** -------- basics -------- */
  bot.start(async (ctx) => {
    await ctx.sendChatAction('typing');
    if (ctx.from.id === ADMIN_ID) {
      safeReply(ctx, `👋 Welcome back, Admin!\n\n${adminMenu}`);
    } else {
      safeReply(ctx,
        `👋 Welcome to <b>Harshportal Support Bot</b>!\n\n` +
        `I can help with your orders, products, and support requests.\n\n${userMenu}`
      );
    }
  });

  bot.command('help', (ctx) => {
    if (ctx.from.id === ADMIN_ID) return safeReply(ctx, adminMenu);
    return safeReply(ctx, userMenu);
  });

  /** -------- contact & reply -------- */
  bot.command('contact', async (ctx) => {
    await ctx.sendChatAction('typing');
    const msg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!msg) return safeReply(ctx, 'Please type your message after <code>/contact</code>.');

    const from = ctx.from || {};
    const userHandle = from.username ? `@${from.username}` : html(from.first_name || 'User');
    const header = `📩 <b>New message</b>\nFrom: ${userHandle} (ID: <code>${from.id}</code>)\n\n`;
    await notifyAdmin(bot, header + html(msg));
    await safeReply(ctx, '✅ Your message has been sent to the admin. You will get a reply here soon!');
  });

  bot.command('reply', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.sendChatAction('typing');
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
    await ctx.sendChatAction('typing');
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
    await ctx.sendChatAction('typing');
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

  /** -------- /user (admin only) -------- */
  bot.command('user', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.sendChatAction('typing');
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

  // inside getBot()

/** -------- /ticket (user creates support ticket) -------- */
bot.command('ticket', async (ctx) => {
  const issue = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!issue) return safeReply(ctx, '✍️ Please describe your issue after /ticket');

  const from = ctx.from;
  const { data, error } = await supabase
    .from('support_tickets')
    .insert([{ user_id: from.id, username: from.username || from.first_name, issue }])
    .select().single();

  if (error) {
    console.error('ticket error:', error);
    return safeReply(ctx, '❌ Could not create ticket. Try again later.');
  }

  await safeReply(ctx, `✅ Ticket #${data.id} created!\nWe will reply here soon.`);
  await notifyAdmin(bot, `🎫 New Ticket #${data.id}\nFrom: ${from.username || from.first_name}\n\n${html(issue)}`);
});


/** -------- /replyticket (admin replies) -------- */
bot.command('mytickets', async (ctx) => {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, issue, reply, status, created_at')
    .eq('user_id', ctx.from.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data?.length) return safeReply(ctx, '📭 No tickets found.');

  const lines = data.map(t => 
    `#${t.id} [${t.status}] – ${html(t.issue.slice(0,40))}` +
    (t.reply ? `\n↪️ Admin: ${html(t.reply.slice(0,40))}` : '')
  ).join('\n\n');

  return safeReply(ctx, `🎫 <b>Your Tickets</b>\n\n${lines}`);
});

bot.command('alltickets', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, user_id, username, issue, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data?.length) return safeReply(ctx, '📭 No tickets found.');

  const lines = data.map(t =>
    `#${t.id} [${t.status}] – ${html(t.issue.slice(0,40))}\n👤 User: ${t.username || t.user_id}`
  ).join('\n\n');

  return safeReply(ctx, `📋 <b>All Tickets</b>\n\n${lines}`);
});

/** -------- /replyticket (admin responds to a ticket) -------- */
bot.command('replyticket', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const args = ctx.message.text.split(' ').slice(1);
  const ticketId = args.shift();
  const replyMsg = args.join(' ').trim();

  if (!ticketId || !replyMsg) {
    return safeReply(ctx, 'Usage: <code>/replyticket &lt;id&gt; &lt;message&gt;</code>');
  }

  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .update({ reply: replyMsg, status: 'closed' })
      .eq('id', ticketId)
      .select()
      .single();

    if (error || !data) {
      console.error('replyticket error:', error);
      return safeReply(ctx, '❌ Failed to reply. Ticket not found.');
    }

    // notify the user safely
    try {
      await bot.telegram.sendMessage(
        data.user_id,
        `📩 <b>Reply to your Ticket #${data.id}</b>\n\n${html(replyMsg)}`,
        { parse_mode: 'HTML' }
      );
    } catch (notifyErr) {
      console.error('Failed to notify user:', notifyErr);
      await safeReply(ctx, `⚠️ Ticket #${data.id} updated, but user could not be notified (maybe blocked the bot).`);
      return;
    }

    await safeReply(ctx, `✅ Replied to Ticket #${data.id}`);
  } catch (e) {
    console.error('replyticket exception:', e);
    return safeReply(ctx, '❌ Could not reply to ticket.');
  }
});


  /** -------- friendly greetings & fallback -------- */
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
      return safeReply(ctx,
        `Sorry, I don’t have an answer for that yet.\n\n` +
        `💡 <b>Tip</b>: Use <code>/help</code> to see available commands.\n` +
        adminContact
      );
    } catch { return next(); }
  });

  _bot = bot;
  return _bot;
}

module.exports = getBot();
