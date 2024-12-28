const fs = require('fs');
const axios = require('axios');
const Bottleneck = require('bottleneck');
require('dotenv').config();

const enhancedOutput = JSON.parse(fs.readFileSync('enhancedOutput.json', 'utf-8'));
const API_KEY = process.env.SOLANA_TRACKER_API_KEY;

// Initialize rate limiter with exponential backoff
const limiter = new Bottleneck({
  minTime: 1000, // Minimum 1 second between requests
  maxConcurrent: 1,
  retry: {
    retries: 5,
    minTimeout: 2000, // Start with 2 second delay
    maxTimeout: 10000, // Max 10 second delay
    backoffFactor: 2 // Exponential backoff
  }
});

const fetchPrice = async (mint, blockTime) => {
  try {
    const timestamp = blockTime * 1000;
    console.log(`Fetching price for mint ${mint} at timestamp ${timestamp}`);

    const response = await axios.get(
      `https://data.solanatracker.io/price/history/timestamp?token=${mint}&timestamp=${timestamp}`,
      {
        headers: {
          'x-api-key': API_KEY
        }
      }
    );
    
    console.log(`Successfully fetched price for mint ${mint}`);
    return {
      ...response.data,
      mint,
      queriedBlockTime: blockTime
    };
  } catch (error) {
    if (error.response?.status === 429) {
      console.log(`Rate limit hit for ${mint}. Response headers:`, error.response.headers);
      // Let Bottleneck handle the retry
      throw error;
    }
    console.error(`Error fetching price for mint ${mint}:`, error.message);
    return null;
  }
};

const fetchAllPrices = async () => {
  const wrappedFetchPrice = limiter.wrap(fetchPrice);
  const prices = [];

  for (const { mint, blockTime } of enhancedOutput) {
    try {
      const price = await wrappedFetchPrice(mint, blockTime);
      if (price) {
        prices.push(price);
        console.log(`Added price data for mint ${mint}`);
      }
    } catch (error) {
      console.error(`Failed to fetch price for mint ${mint} after all retries:`, error.message);
    }
  }

  fs.writeFileSync('prices.json', JSON.stringify(prices, null, 2));
  console.log(`Price data has been written to prices.json for ${prices.length} tokens`);
};

// Add error event handler for Bottleneck
limiter.on('failed', async (error, jobInfo) => {
  if (error.response?.status === 429) {
    const retryAfter = parseInt(error.response.headers['retry-after'], 10) || 10;
    console.log(`Rate limited. Waiting ${retryAfter} seconds before retry ${jobInfo.retryCount + 1}`);
    return retryAfter * 1000; // Return ms to wait before retry
  }
});

fetchAllPrices().catch(console.error);
