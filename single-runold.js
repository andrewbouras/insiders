const fs = require('fs');
const axios = require('axios');
const Bottleneck = require('bottleneck');

// Function to read JSON file
function readJSONFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Function to write JSON file
function writeJSONFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Function to fetch transaction signatures
async function fetchSignatures(walletAddress) {
  try {
    const response = await axios.post('https://api.mainnet-beta.solana.com', {
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [
        walletAddress,
        { limit: 20 }
      ]
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    const filtered = response.data.result.map(item => ({
      blockTime: item.blockTime,
      signature: item.signature
    }));
    return filtered;
  } catch (error) {
    console.error(error);
    return [];
  }
}

// Function to enhance with transaction data
async function enhanceSignatures(signatures) {
  const rawTransactions = [];
  const results = [];

  // Function to fetch a single transaction with retry logic
  async function fetchTransaction(signature) {
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        console.log(`Fetching transaction for signature: ${signature} (Attempt ${attempts + 1})`);
        const response = await axios.post('https://api.mainnet-beta.solana.com', {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            {
              encoding: 'json',
              maxSupportedTransactionVersion: 0
            }
          ]
        }, {
          headers: { 'Content-Type': 'application/json' }
        });

        const transaction = response.data.result;
        if (transaction.preTokenBalances) {
          console.log(`preTokenBalances found for signature: ${signature}`);
        } else {
          console.log(`preTokenBalances NOT found for signature: ${signature}`);
        }
        if (transaction.postTokenBalances) {
          console.log(`postTokenBalances found for signature: ${signature}`);
        } else {
          console.log(`postTokenBalances NOT found for signature: ${signature}`);
        }

        rawTransactions.push(transaction);

        const mint = transaction.preTokenBalances && transaction.preTokenBalances.length > 0
          ? transaction.preTokenBalances[0].mint
          : null;

        console.log(`Successfully fetched transaction for signature: ${signature}`);
        return { signature, mint };
      } catch (error) {
        if (error.response && error.response.status === 429 && attempts < maxAttempts - 1) {
          const retryAfter = parseInt(error.response.headers['retry-after'], 10) || 10;
          console.warn(`Rate limited. Retrying after ${retryAfter} seconds... (Attempt ${attempts + 1})`);
          await new Promise(res => setTimeout(res, retryAfter * 1000));
          attempts++;
        } else {
          console.error(`Error fetching transaction for signature ${signature}:`, error.message);
          return { signature, mint: null };
        }
      }
    }
  }

  // Bottleneck for rate limiting
  const limiter = new Bottleneck({
    reservoir: 10, // Further reduce to 10 requests
    reservoirRefreshAmount: 10,
    reservoirRefreshInterval: 10 * 1000, // Refresh every 10 seconds
    maxConcurrent: 1,
    minTime: 1000 // 1 second between requests
  });

  const limitedFetchTransaction = limiter.wrap(fetchTransaction);

  // Process each signature in series
  for (const s of signatures) {
    console.log(`Processing signature: ${s.signature}`);
    const result = await limitedFetchTransaction(s.signature);
    results.push(result);
  }

  console.log('All transactions processed.');

  return { results, rawTransactions };
}

// Function to parse mint addresses
function parseMintAddresses(enhancedData) {
  // Load raw transactions from disk
  const rawData = JSON.parse(fs.readFileSync('rawTransactions.json', 'utf-8'));
  // Wrapped SOL token mint address to exclude
  const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

  // Helper function to convert blockTime to Unix timestamp
  function blockTimeToUnixTimestamp(blockTime) {
    return blockTime * 1000; // Convert seconds to milliseconds
  }

  const parsed = [];
  // Iterate over raw transaction data
  for (const transaction of rawData) {
    const signature = transaction.transaction.signatures[0];
    let mint = null;

    if (transaction.meta.preTokenBalances && transaction.meta.preTokenBalances.length > 0) {
      mint = transaction.meta.preTokenBalances[0].mint;
    } else if (transaction.meta.postTokenBalances && transaction.meta.postTokenBalances.length > 0) {
      mint = transaction.meta.postTokenBalances[0].mint;
    }

    // Only include if mint exists and is not wrapped SOL
    if (mint && mint !== WRAPPED_SOL_MINT) {
      parsed.push({
        signature,
        mint,
        blockTime: transaction.blockTime,
        timestamp: blockTimeToUnixTimestamp(transaction.blockTime)
      });
    }
  }

  // Return our parsed array for further processing
  return parsed;
}

// Function to add block time
function addBlockTime(transactions) {
  const output = JSON.parse(fs.readFileSync('output.json', 'utf-8'));

  const blockTimeMap = output.reduce((map, item) => {
    map[item.signature] = item.blockTime;
    return map;
  }, {});

  const updatedOutput = transactions.map(item => ({
    signature: item.signature,
    mint: item.mint,
    blockTime: blockTimeMap[item.signature]
  }));

  fs.writeFileSync('enhancedOutput.json', JSON.stringify(updatedOutput, null, 2));
  console.log('BlockTime values have been added to enhancedOutput.json');

  return updatedOutput;
}

// Function to convert timestamps
function convertTimestamps(transactions) {
  function blockTimeToUnixTimestamp(blockTime) {
    return blockTime * 1000; // Convert seconds to milliseconds
  }

  const updatedOutput = transactions.map(item => ({
    ...item,
    timestamp: blockTimeToUnixTimestamp(item.blockTime)
  }));

  fs.writeFileSync('enhancedOutput.json', JSON.stringify(updatedOutput, null, 2));
  console.log('Timestamps have been added to enhancedOutput.json');

  return updatedOutput;
}

// Function to fetch prices
async function fetchPrices(transactions) {
  require('dotenv').config();
  const API_KEY = process.env.SOLANA_TRACKER_API_KEY;

  const limiter = new Bottleneck({
    minTime: 1000, 
    maxConcurrent: 1,
    retry: {
      retries: 5,
      minTimeout: 2000, 
      maxTimeout: 10000,
      backoffFactor: 2
    }
  });

  limiter.on('failed', async (error, jobInfo) => {
    if (error.response?.status === 429) {
      const retryAfter = parseInt(error.response.headers['retry-after'], 10) || 10;
      console.log(`Rate limited. Waiting ${retryAfter} seconds before retry ${jobInfo.retryCount + 1}`);
      return retryAfter * 1000;
    }
  });

  async function fetchPrice(mint, blockTime) {
    try {
      const timestamp = blockTime * 1000;
      console.log(`Fetching price for mint ${mint} at timestamp ${timestamp}`);
      const response = await axios.get(
        `https://data.solanatracker.io/price/history/timestamp?token=${mint}&timestamp=${timestamp}`,
        { headers: { 'x-api-key': API_KEY } }
      );

      // Check if response contains "Internal Server Error"
      if (response.data && response.data.error === "Internal Server Error") {
        console.log(`Internal Server Error received for mint ${mint}`);
        return {
          price: null,
          timestamp,
          mint,
          queriedBlockTime: blockTime,
          error: "Internal Server Error"
        };
      }

      console.log(`Successfully fetched price for mint ${mint}`);
      return {
        ...response.data,
        mint,
        queriedBlockTime: blockTime
      };
    } catch (error) {
      if (error.response?.status === 429) {
        console.log(`Rate limit hit for mint ${mint}, letting Bottleneck handle retries.`);
        throw error;
      }
      console.error(`Error fetching price for mint ${mint}:`, error.message);
      return {
        price: null,
        timestamp: blockTime * 1000,
        mint,
        queriedBlockTime: blockTime,
        error: error.message
      };
    }
  }

  const wrappedFetchPrice = limiter.wrap(fetchPrice);
  const prices = [];

  for (const { mint, blockTime } of transactions) {
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
  return prices;
}

// Function to filter prices
function filterPrices(prices) {
  // Helper function to convert Unix timestamp to EST
  function convertToEST(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  // Add EST time to each price object
  const pricesWithEST = prices.map(price => ({
    ...price,
    timestamp_est: convertToEST(price.timestamp)
  }));

  // First split into null and valid prices
  const initialNullPrices = pricesWithEST.filter(item => item.price === null);
  const initialValidPrices = pricesWithEST.filter(item => item.price !== null);

  // Deduplicate null prices
  const nullMintMap = new Map();
  initialNullPrices.forEach(price => {
    if (!nullMintMap.has(price.mint)) {
      nullMintMap.set(price.mint, price);
    }
  });

  // Deduplicate valid prices
  const validMintMap = new Map();
  initialValidPrices.forEach(price => {
    if (!validMintMap.has(price.mint) || 
        price.timestamp > validMintMap.get(price.mint).timestamp) {
      validMintMap.set(price.mint, price);
    }
  });

  const uniqueNullPrices = Array.from(nullMintMap.values());
  const uniqueValidPrices = Array.from(validMintMap.values());

  fs.writeFileSync('prices-null.json', JSON.stringify(uniqueNullPrices, null, 2));
  fs.writeFileSync('prices-valid.json', JSON.stringify(uniqueValidPrices, null, 2));

  console.log(`Found ${uniqueNullPrices.length} unique null prices and ${uniqueValidPrices.length} unique valid prices`);
  console.log('Deduplicated data has been written to prices-null.json and prices-valid.json');
}

async function singleRunFlow() {
  // 1) Read input.json
  const input = readJSONFile('input.json');
  let walletAddresses = [];

  if (input.walletAddresses && Array.isArray(input.walletAddresses)) {
    walletAddresses = input.walletAddresses;
  } else if (input.walletAddress) {
    walletAddresses = [input.walletAddress];
  } else {
    console.error('No walletAddress or walletAddresses found in input.json');
    return;
  }

  let allSignatures = [];
  let allEnhancedData = [];
  let allRawTransactions = [];
  let allPrices = [];

  for (const walletAddress of walletAddresses) {
    console.log(`Processing wallet address: ${walletAddress}`);
    
    // 2) Fetch transaction signatures
    const signatures = await fetchSignatures(walletAddress);
    allSignatures.push(...signatures);

    // 3) Enhance with transaction data
    const { results, rawTransactions } = await enhanceSignatures(signatures);
    allEnhancedData.push(...results);
    allRawTransactions.push(...rawTransactions);
  }

  // Write combined data
  fs.writeFileSync('enhancedOutput.json', JSON.stringify(allEnhancedData, null, 2));
  fs.writeFileSync('rawTransactions.json', JSON.stringify(allRawTransactions, null, 2));

  // 4) Parse mint addresses
  const parsedTransactions = parseMintAddresses(allEnhancedData);

  // 5) Add blockTime (optional if needed)
  // ...existing code to map blockTime if required...

  // 6) Convert timestamps
  const transactionsWithTimestamps = convertTimestamps(parsedTransactions);

  // 7) Fetch prices
  const prices = await fetchPrices(transactionsWithTimestamps);
  allPrices.push(...prices);

  // 8) Filter into prices-valid.json and prices-null.json
  filterPrices(allPrices);

  console.log('Done! Generated prices-valid.json and prices-null.json');
}

singleRunFlow();