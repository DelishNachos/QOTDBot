const nacl = require('tweetnacl');
const AWS = require('aws-sdk');
const axios = require('axios');
const schedule = require('node-schedule');
//var Scraper = require('image-scraper');
//const cheerio = require('cheerio');
//const axios = require('axios');
//const {GoogleImages} = require("google-images");
const dynamoDB = new AWS.DynamoDB.DocumentClient();

let quote = null;
let referenceDate = null;

const timezone = "America/Phoenix";

async function get_random_quote_from_db() {
  try {

    // QuoteDB Fetch
    const tableName = 'QuoteTable'; // Replace with your actual DynamoDB table name

    const params = {
      TableName: tableName,
    };

    // Scan the DynamoDB table to get all the items
    const result = await dynamoDB.scan(params).promise();

    if (!result.Items || result.Items.length === 0) {
      console.error('No items found in the table.');
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No items found.' }),
      };
    }

    //UsedID Fetch
    const usedTableName = 'UsedQuotesTable';

    const usedParms = {
      TableName: usedTableName,
    };

    const usedResult = await dynamoDB.scan(usedParms).promise();

    if (!usedResult.Items) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No items found.' }),
      };
    }

    console.log("Used Result: " + usedResult.Items.map(obj => obj.NumberID));

    const usableQuotes = result.Items.filter((quote) => {
      return !usedResult.Items.some((usedQuote) => {
        return String(usedQuote.NumberID) === String(quote.QuoteID);
      });
    });

    if (!usableQuotes || usableQuotes.length === 0) {
      console.error('No usable quotes found.');
      return null;
    }
    console.log("Usable Quotes: " + usableQuotes.map(obj => obj.QuoteID));

    // Pick a random item from the result
    const randomIndex = Math.floor(Math.random() * usableQuotes.length);
    const randomQuote = usableQuotes[randomIndex];

    console.log('Random item retrieved successfully:', randomQuote);

    //add used quote to db
    add_used_quote_to_db(randomQuote);

    return randomQuote;
  } catch (error) {
    console.error('Error retrieving item from DynamoDB:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
}

async function add_used_quote_to_db(quote) {
  try {
    const tableName = 'UsedQuotesTable'; // Replace with your actual DynamoDB table name

    const params = {
      TableName: tableName,
      Item: {
        "NumberID": Number(quote.QuoteID), // Replace with your actual partition key value
        "DateOfUse": String(getDateWithoutTime(formatDateInTimezone(new Date(), 'America/Phoenix'))),
      },
    };

    await dynamoDB.put(params).promise();

    console.log('Used Quote added successfully.');

    return JSON.stringify({
      "type": 4,
      "data": {"content" : "added the used quote"}
    });
  } catch (error) {
    console.error('Error adding used quote to DynamoDB:', error);
    return JSON.stringify({
      "type": 4,
      "data": {"content" : "failed to add the used quote"}
    });
  }
}

function formatDateInTimezone(date, timezone) {
  return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
}

async function isNextDay() {
  // Helper function to format a date in 'America/Phoenix' timezone
  

  // Get the current date in 'America/Phoenix' timezone
  const currentDate = formatDateInTimezone(new Date(), 'America/Phoenix');
  console.log("Current Date:", currentDate);
  referenceDate = currentDate;

  const usedTableName = 'UsedQuotesTable';

  const usedParms = {
    TableName: usedTableName,
  };

  const usedResult = await dynamoDB.scan(usedParms).promise();

  if(!usedResult || usedResult.Items.length === 0) {
    return;
  }

  if (!usedResult.Items) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'No items found.' }),
    };
  }

  let currentDayQuote = usedResult.Items.filter((quote) => {
    return String(getDateWithoutTime(new Date(quote.DateOfUse))) === String(getDateWithoutTime(currentDate));
  });

  console.log("Reference Data: " + String(referenceDate));
  console.log("Current Date: " + String(getDateWithoutTime(currentDate)));
  
  
  if (!currentDayQuote || currentDayQuote.length === 0) {
    quote = null;
    return;
  }
  
  
  currentDayQuote = currentDayQuote.filter((quote) => {
    return String(quote.NumberID) !== '0';
  });

  //console.log("Date of Use: " + String(getDateWithoutTime(new Date(quote.DateOfUse))));
  console.log("Current Day Quote: " + currentDayQuote.map(obj => obj.NumberID));

  const quoteTableName = "QuoteTable";

  const quoteParams = {
    TableName: quoteTableName,
  };

  const quoteResult = await dynamoDB.scan(quoteParams).promise();

  const newQuote = quoteResult.Items.filter((quote) => {
    return String(quote.QuoteID) === String(currentDayQuote[0].NumberID);
  })

  console.log("New Quote: " + newQuote.map(obj => obj.Quote))

  if (newQuote) {
    quote = newQuote[0];
    return;
  } else {
    quote = null;
    return;
  }
}

// Helper function to get a date without time
function getDateWithoutTime(date) {
  const dateWithoutTime = new Date(date);
  dateWithoutTime.setHours(0, 0, 0, 0);
  return dateWithoutTime;
}

async function sendDeferredResponse(id, token) {
  console.log("Preparing to send deferred response..."); // Log before the API call
  console.log('Interaction ID:', id);
  console.log('Interaction Token:', token);
  const url = `https://discord.com/api/v10/interactions/${id}/${token}/callback`;
  const headers = {
    "Content-Type": "application/json",
  };

  const body = {
    type: 5, // Deferred response type
  };

  try {
    console.log("Sending POST request to:", url);
    console.log("Request body:", body);
    const response = await axios.post(url, body, { headers });
    console.log("Deferred response successful:", response.status);
  } catch (error) {
    console.error("Error sending deferred response:", error.response?.data || error.message);
    throw error; // Rethrow to handle it upstream
  }
}

async function updateInteractionResponse(app_id, token, tempQuote) {
  const url = `https://discord.com/api/webhooks/${app_id}/${token}/messages/@original`;
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "DiscordBot (https://example.com, 1.0.0)",
  };

  if (!tempQuote) {
    const body = { content: "No quotes found in the database." };
    try {
      await axios.patch(url, body, { headers });
      console.log("Embed response sent successfully.");
    } catch (error) {
      console.error("Error sending embed response:", error.response?.data || error.message);
    }
    return;
  }

  // Format the embed
  const embed = {
    title: "Quote",
    description: truncate(tempQuote.Quote || "No quote available", 4096),
    color: 0xff0000, // Green color
    fields: [
      {
        name: "Source",
        value: truncate(tempQuote.Author || "Unknown", 1024),
        inline: false,
      },
      {
        name: "Context",
        value: tempQuote.Context ? `||${truncate(tempQuote.Context, 1024)}||` : "No additional context provided",
        inline: false,
      },
      {
        name: "Date Quote Was Said",
        value: tempQuote.Date || "Date not available",
        inline: false,
      },
      {
        name: "Date Of The Quote",
        value: formatDate(referenceDate),
        inline: false,
      },
    ],
    footer: { text: "QOTD" },
  };

  const body = { embeds: [embed] };

  try {
    await axios.patch(url, body, { headers });
    console.log("Embed response sent successfully.");
  } catch (error) {
    console.error("Error sending embed response:", error.response?.data || error.message);
  }
}

async function updateInteractionText(app_id, token, text) {
  const url = `https://discord.com/api/webhooks/${app_id}/${token}/messages/@original`;
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "DiscordBot (https://example.com, 1.0.0)",
  };

  const body = { content: text };

  try {
    await axios.patch(url, body, { headers });
    console.log("Embed response sent successfully.");
  } catch (error) {
    console.error("Error sending embed response:", error.response?.data || error.message);
  }
}

function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}


//
// Helper function to format the date
function formatDate(date) {
  if (!date) {
    return "Date not available";
  }

  const options = { year: "numeric", month: "long", day: "numeric" }; // Example: December 28, 2024
  return new Date(date).toLocaleDateString("en-US", options);
}

async function sendQuote() {
  await sendDeferredResponse(id, token);
  quote = null;

  console.log("Quote: " + quote);
  
  await isNextDay();

  console.log("Quote: " + quote);

  if (quote != null) {
    await updateInteractionResponse(process.env.BOT_ID, token, quote);
    return;
  }    

  let tempQuote =  await get_random_quote_from_db();
  console.log("Temp Quote: " + tempQuote);
  await updateInteractionResponse(
    process.env.BOT_ID,
    token,
    tempQuote
  );
  return;
}

schedule.scheduleJob({ hour: 16, minute: 15, tz: timezone }, sendQuote);

exports.handler = async (event) => {
  // Checking signature (requirement 1.)
  // Your public key can be found on your application in the Developer Portal
  const PUBLIC_KEY = process.env.PUBLIC_KEY;
  const signature = event.headers['x-signature-ed25519']
  const timestamp = event.headers['x-signature-timestamp'];
  const strBody = event.body; // should be string, for successful sign


  const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + strBody),
    Buffer.from(signature, 'hex'),
    Buffer.from(PUBLIC_KEY, 'hex')
  );

  if (!isVerified) {
    return {
      statusCode: 401,
      body: JSON.stringify('invalid request signature'),
    };
  }


  // Replying to ping (requirement 2.)
  const body = JSON.parse(strBody)
  const id = body.id; // Discord sends the application ID in the payload
  const token = body.token;      // Discord sends the interaction token in the payload

  if (body.type == 1) {
    return {
      statusCode: 200,
      body: JSON.stringify({ "type": 1 }),
    }
  }

  if (body.data.name == 'quote') {
    await sendDeferredResponse(id, token);
    quote = null;

    console.log("Quote: " + quote);
    
    await isNextDay();

    console.log("Quote: " + quote);

    if (quote != null) {
      await updateInteractionResponse(process.env.BOT_ID, token, quote);
      return;
    }    

    let tempQuote =  await get_random_quote_from_db();
    console.log("Temp Quote: " + tempQuote);
    await updateInteractionResponse(
      process.env.BOT_ID,
      token,
      tempQuote
    );
    return;

  } else if  (body.data.name == 'add_quote') {
    await sendDeferredResponse(id, token);

    const options = body.data.options.reduce((acc, option) => {
      acc[option.name] = option.value;
      return acc;
    }, {});

    const newQuote = {
      QuoteID: Date.now().toString(), // Generate a unique ID based on the current timestamp
      Quote: options.quote,
      Author: options.source || 'Unknown',
      Context: options.context || null,
      Date: options.date || null,
    };

    try {
      // Insert into DynamoDB
      const tableName = 'QuoteTable'; // Replace with your table name
      const params = {
        TableName: tableName,
        Item: newQuote,
      };
  
      await dynamoDB.put(params).promise();
  
      await updateInteractionText(
        process.env.BOT_ID,
        token,
        `Quote added successfully:\n"${newQuote.Quote}" - ${newQuote.Author}`
      );
      return;
    } catch (error) {
      console.error('Error adding quote to DynamoDB:', error);
  
      await updateInteractionText(
        process.env.BOT_ID,
        token,
        'Failed to add quote!'
      );
      return;
    }

    await updateInteractionText(
      process.env.BOT_ID,
      token,
      'Failed to add quote!'
    );
    return;
    
  }
  
  return {
    statusCode:404
  }
};