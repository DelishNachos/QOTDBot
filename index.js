const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const AWS = require('aws-sdk');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const timezone = "America/Phoenix";
const DISCORD_TOKEN = process.env.BOT_TOKEN;
const DAILY_CHANNEL_ID = process.env.CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let cachedQuote = null;
let referenceDate = null;

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // Schedule the daily quote message
  schedule.scheduleJob({ hour: 10, minute: 50, tz: timezone }, async () => {
    const channel = client.channels.cache.get(DAILY_CHANNEL_ID);
    if (channel) {
      const quote = await getQuoteForToday();
      if (quote) {
        await sendQuoteEmbed(channel, quote, false);
      } else {
        console.error("Failed to fetch quote for the day.");
      }
    } else {
      console.error("Channel not found for daily quote.");
    }
  });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'quote') {
    console.log("Recieved Quote Command");
    await interaction.deferReply();

    const quote = await getQuoteForToday();

    if (quote) {
      const embed = createQuoteEmbed(quote);
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.editReply("No quotes available right now.");
    }
  } else if (interaction.commandName === 'add_quote') {
    const quoteText = interaction.options.getString('quote');
    const author = interaction.options.getString('author') || 'Unknown';
    const context = interaction.options.getString('context') || null;
    const date = interaction.options.getString('date') || null;

    const newQuote = {
      QuoteID: Date.now().toString(),
      Quote: quoteText,
      Author: author,
      Context: context,
      Date: date,
    };

    try {
      await addQuoteToDB(newQuote);
      await interaction.reply(`Quote added successfully: "${quoteText}" - ${author}`);
    } catch (error) {
      console.error("Error adding quote:", error);
      await interaction.reply("Failed to add quote.");
    }
  }
});

async function getQuoteForToday() {
  const currentDate = getDateWithoutTime(formatDateInTimezone(new Date(), timezone));
  console.log("Current Date: " + currentDate);
  if (cachedQuote && referenceDate === currentDate) {
    console.log("CachedQuote");
    return cachedQuote;
  }

  referenceDate = currentDate;

  const usedQuotes = await getUsedQuotesForDate(currentDate);

  if (usedQuotes.length > 0) {
    const quote = await getQuoteById(usedQuotes[0].NumberID);
    if (quote) {
      cachedQuote = quote;
      return quote;
    }
  }

  const randomQuote = await getRandomQuote();
  if (randomQuote) {
    await markQuoteAsUsed(randomQuote, currentDate);
    cachedQuote = randomQuote;
    return randomQuote;
  }

  return null;
}

function createQuoteEmbed(quote) {
  const embed = new EmbedBuilder()
    .setTitle("Quote of the Day")
    .setDescription(quote.Quote || "No quote available")
    .setColor("Random")
    .addFields(
      { name: "Source", value: quote.Author || "Unknown", inline: false },
      { name: "Context", value: quote.Context || "No additional context provided", inline: false },
      { name: "Date", value: quote.Date || "Date not available", inline: false }
    )
    .setFooter({ text: "QOTD" });

  return embed;
}

async function sendQuoteEmbed(channel, quote, mentionEveryone = false) {
  const embed = createQuoteEmbed(quote);
  const content = mentionEveryone ? "@everyone" : "";
  await channel.send({ content, embeds: [embed] });
}

function formatDateInTimezone(date, timezone) {
  return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
}

function getDateWithoutTime(date) {
  const dateWithoutTime = new Date(date);
  dateWithoutTime.setHours(0, 0, 0, 0);
  return dateWithoutTime;
}

async function getUsedQuotesForDate(date) {
  const params = {
    TableName: 'UsedQuotesTable',
  };

  const result = await dynamoDB.scan(params).promise();
  return result.Items.filter((item) => item.DateOfUse === String(date));
}

async function getQuoteById(id) {
  const params = {
    TableName: 'QuoteTable',
    Key: { QuoteID: id },
  };

  const result = await dynamoDB.get(params).promise();
  return result.Item || null;
}

async function getRandomQuote() {
  const allQuotes = await dynamoDB.scan({ TableName: 'QuoteTable' }).promise();
  const usedQuotes = await dynamoDB.scan({ TableName: 'UsedQuotesTable' }).promise();

  const usableQuotes = allQuotes.Items.filter((quote) =>
    !usedQuotes.Items.some((used) => String(used.NumberID) === String(quote.QuoteID))
  );

  if (usableQuotes.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * usableQuotes.length);
  return usableQuotes[randomIndex];
}

async function markQuoteAsUsed(quote, date) {
  const params = {
    TableName: 'UsedQuotesTable',
    Item: {
      NumberID: String(quote.QuoteID),
      DateOfUse: String(date),
    },
  };

  await dynamoDB.put(params).promise();
}

async function addQuoteToDB(quote) {
  const params = {
    TableName: 'QuoteTable',
    Item: quote,
  };

  await dynamoDB.put(params).promise();
}

client.login(DISCORD_TOKEN);
