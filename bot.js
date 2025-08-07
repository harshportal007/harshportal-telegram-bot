require('dotenv').config();

const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// GET your keys from .env
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Create bot instance
const bot = new Telegraf(botToken);

bot.start((ctx) =>
  ctx.reply('Welcome to Harshportal Support! Type your question, I will help you automatically.')
);

// Dynamic FAQ handler (always at the end)
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
