require('dotenv').config();

const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Env variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;

const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Telegraf(botToken);

// 1. Start command
bot.start((ctx) =>
  ctx.reply('Welcome to Harshportal Support! Type your question, or use /help to see commands.')
);

// 2. Help command
bot.command('help', (ctx) =>
  ctx.reply(`/order [orderId] — check order status\n/product [name] — get product info\n/user [email] — lookup user\n\nOr just ask your question!`)
);

// 3. Order status lookup
bot.command('order', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const orderId = args[0];
  if (!orderId) return ctx.reply('Please provide an order ID. Example: /order 12345');

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error || !data) return ctx.reply('Order not found or error.');

  ctx.reply(`Order #${data.id}\nStatus: ${data.status}\nCustomer: ${data.customer}\nTotal: ₹${data.total}\nDate: ${data.date}`);
});

// 4. Product lookup
bot.command('product', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const name = args.join(' ');
  if (!name) return ctx.reply('Please provide a product name. Example: /product Netflix');

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .ilike('name', `%${name}%`)
    .limit(1)
    .single();

  if (error || !data) return ctx.reply('Product not found.');
  ctx.reply(`Product: ${data.name}\nPrice: ₹${data.price}\nCategory: ${data.category}\nDescription: ${data.description}`);
});

// 5. User lookup
bot.command('user', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const email = args.join(' ');
  if (!email) return ctx.reply('Please provide a user email. Example: /user harsh@gmail.com');

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', `%${email}%`)
    .single();

  if (error || !data) return ctx.reply('User not found.');
  ctx.reply(`User: ${data.email}\nName: ${data.name}\nStatus: ${data.status}`);
});

// 6. Greetings handler
bot.hears(/^(hi|hello|hey|hii|hiiii|hola|yo|sup)$/i, (ctx) => {
  ctx.reply('Hello! 👋 How can I help you today?');
});

// 7. FAQ fallback (always LAST!)
bot.on('text', async (ctx) => {
  const userText = ctx.message.text;
  const { data, error } = await supabase
    .from('faqs')
    .select('answer')
    .ilike('question', `%${userText}%`);

  if (data && data.length > 0) {
    ctx.reply(data[0].answer);
  } else {
    ctx.reply('Sorry, I do not have an answer for that yet. Please contact support@harshportal.in or ask in another way!');
  }
});

bot.launch();
console.log('Harshportal Bot is running...');
