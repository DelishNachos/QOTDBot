const nacl = require('tweetnacl');
const AWS = require('aws-sdk');
const axios = require('axios');
const schedule = require('node-schedule');
const { Client, GatewayIntentBits } = require('discord.js');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const timezone = "America/Phoenix";
const channelId = process.env.CHANNEL_ID; // Channel ID stored in the environment variables

let quote = null;
let referenceDate = null;

// Initialize Discord Client
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

async function get_random_quote_from_db() {
  try {
    const tableName = 'QuoteTable'; // Replace with your actual DynamoDB table name
    const params = { TableName: tableName };

    const result = await dynamoDB.scan(params).promise();
    if (!result.Items || result.Items.length === 0) {
      console.error('No items found in the table.');
      return null;
    }

    const usedTableName = 'UsedQuotesTable';
    const usedParms = { TableName: usedTableName };
    const usedResult = await dynamoDB.scan(usedParms).promise();
    
    if (!usedResult.Items) {
      return null;
    }

    const usableQuotes = result.Items.filter((quote) => {
      return !usedResult.Items.some((usedQuote) => String(usedQuote.NumberID) === String(quote.QuoteID));
    });

    if (!usableQuotes || usableQuotes.length === 0) {
      console.error('No usable quotes found.');
      return null;
    }

    const randomIndex = Math.floor(Math.random() * usableQuotes.length);
    const randomQuote = usableQuotes[randomIndex];

    add_used_quote_to_db(randomQuote); // Add the used quote to the database

    return randomQuote;
  } catch (error) {
    console.error('Error retrieving item from DynamoDB:', error);
    return null;
  }
}

async function add_used_quote_to_db(quote) {
  try {
    const tableName = 'UsedQuotesTable';
    const params = {
      TableName: tableName,
      Item: {
        "NumberID": Number(quote.QuoteID),
        "DateOfUse": String(getDateWithoutTime(formatDateInTimezone(new Date(), 'America/Phoenix'))),
      },
    };

    await dynamoDB.put(params).promise();
    console.log('Used Quote added successfully.');
  } catch (error) {
    console.error('Error adding used quote to DynamoDB:', error);
  }
}

function formatDateInTimezone(date, timezone) {
  return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
}

function getDateWithoutTime(date) {
  const dateWithoutTime = new Date(date);
  dateWithoutTime.setHours(0, 0, 0, 0);
  return dateWithoutTime;
}

async function sendDeferredResponse(id, token) {
  const url = `https://discord.com/api/v10/interactions/${id}/${token}/callback`;
  const headers = { "Content-Type": "application/json" };
  const body = { type: 5 };

  try {
    await axios.post(url, body, { headers });
  } catch (error) {
    console.error("Error sending deferred response:", error);
  }
}

async function updateInteractionResponse(app_id, token, tempQuote) {
  const url = `https://discord.com/api/webhooks/${app_id}/${token}/messages/@original`;
  const headers = { "Content-Type": "application/json", "User-Agent": "DiscordBot" };

  if (!tempQuote) {
    const body = { content: "No quotes found in the database." };
    try {
      await axios.patch(url, body, { headers });
    } catch (error) {
      console.error("Error sending embed response:", error);
    }
    return;
  }

  const embed = {
    title: "Quote",
    description: tempQuote.Quote || "No quote available",
    color: 0xff0000, // Green color
    fields: [
      { name: "Source", value: tempQuote.Author || "Unknown", inline: false },
      { name: "Context", value: tempQuote.Context || "No additional context", inline: false },
      { name: "Date Quote Was Said", value: tempQuote.Date || "Date not available", inline: false },
    ],
    footer: { text: "QOTD" },
  };

  const body = { embeds: [embed] };
  try {
    await axios.patch(url, body, { headers });
  } catch (error) {
    console.error("Error sending embed response:", error);
  }
}

async function isNextDay() {
  const currentDate = formatDateInTimezone(new Date(), 'America/Phoenix');
  referenceDate = currentDate;

  const usedTableName = 'UsedQuotesTable';
  const usedParms = { TableName: usedTableName };
  const usedResult = await dynamoDB.scan(usedParms).promise();

  if (!usedResult || usedResult.Items.length === 0) {
    return;
  }

  let currentDayQuote = usedResult.Items.filter((quote) => {
    return String(getDateWithoutTime(new Date(quote.DateOfUse))) === String(getDateWithoutTime(currentDate));
  });

  if (!currentDayQuote || currentDayQuote.length === 0) {
    quote = null;
    return;
  }

  currentDayQuote = currentDayQuote.filter((quote) => String(quote.NumberID) !== '0');
  const quoteTableName = "QuoteTable";
  const quoteParams = { TableName: quoteTableName };
  const quoteResult = await dynamoDB.scan(quoteParams).promise();

  const newQuote = quoteResult.Items.filter((quote) => String(quote.QuoteID) === String(currentDayQuote[0].NumberID));
  if (newQuote) {
    quote = newQuote[0];
  } else {
    quote = null;
  }
}

schedule.scheduleJob({ hour: 10, minute: 0, tz: timezone }, async () => {
  // Send the scheduled quote message
  const channel = await client.channels.fetch(channelId);
  if (channel) {
    channel.send('/quote');
  } else {
    console.error('Channel not found!');
  }
});

client.once('ready', () => {
  console.log('Bot is online!');
});

client.login(process.env.BOT_TOKEN); // Login with the bot token stored in environment variable

// Handler to handle Discord interactions (e.g., slash commands)
exports.handler = async (event) => {
  const PUBLIC_KEY = process.env.PUBLIC_KEY;
  const signature = event.headers['x-signature-ed25519'];
  const timestamp = event.headers['x-signature-timestamp'];
  const strBody = event.body;

  const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + strBody),
    Buffer.from(signature, 'hex'),
    Buffer.from(PUBLIC_KEY, 'hex')
  );

  if (!isVerified) {
    return { statusCode: 401, body: JSON.stringify('Invalid request signature') };
  }

  const body = JSON.parse(strBody);
  const id = body.id;
  const token = body.token;

  if (body.type == 1) {
    return { statusCode: 200, body: JSON.stringify({ "type": 1 }) };
  }

  if (body.data.name == 'quote') {
    await sendDeferredResponse(id, token);
    quote = null;
    await isNextDay();

    if (quote != null) {
      await updateInteractionResponse(process.env.BOT_ID, token, quote);
      return;
    }

    let tempQuote = await get_random_quote_from_db();
    await updateInteractionResponse(process.env.BOT_ID, token, tempQuote);
    return;
  } else if (body.data.name == 'add_quote') {
    await sendDeferredResponse(id, token);

    const options = body.data.options.reduce((acc, option) => {
      acc[option.name] = option.value;
      return acc;
    }, {});

    const newQuote = {
      QuoteID: Date.now().toString(),
      Quote: options.quote,
      Author: options.source || 'Unknown',
      Context: options.context || null,
      Date: options.date || null,
    };

    try {
      const tableName = 'QuoteTable';
      const params = { TableName: tableName, Item: newQuote };
      await dynamoDB.put(params).promise();
      await updateInteractionText(process.env.BOT_ID, token, `Quote added successfully:\n"${newQuote.Quote}" - ${newQuote.Author}`);
      return;
    } catch (error) {
      console.error('Error adding quote to DynamoDB:', error);
      await updateInteractionText(process.env.BOT_ID, token, 'Failed to add quote!');
      return;
    }
  }

  return { statusCode: 404 };
};
