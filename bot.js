require('dotenv').config();

const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Env variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;

const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Telegraf(botToken);

bot.start((ctx) =>
  ctx.reply(
    `👋 Welcome to Harshportal Support Bot!\n\n` +
    `You can ask about your orders, products, account, or any help you need.\n\n` +
    `*Commands you can use:*\n` +
    `/order <orderId> - Get order details\n` +
    `/product <product name> - Get product info\n` +
    `/user <email> - Get user details\n` +
    `/help - Show this help menu\n\n` +
    `Or just type your question!`
  )
);

// 2. /help handler (same as above, or even more detailed)
bot.command('help', (ctx) =>
  ctx.reply(
    `*Harshportal Bot Help:*\n\n` +
    `/order <orderId> - Show your order status\n` +
    `/product <product name> - Look up product details\n` +
    `/user <email> - Look up user info\n` +
    `/help - Show this menu\n\n` +
    `Try typing: /product Netflix`
  )
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
bot.on('text', async (ctx) => {
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
      "Or contact support@harshportal.in."
    );
  }
});

bot.launch();
console.log('Harshportal Bot is running...');
