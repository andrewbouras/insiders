const fs = require('fs');
const axios = require('axios');
const Bottleneck = require('bottleneck');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Split proxy pools for different endpoints
const signatureProxyPool = Array.from({ length: 50 }, (_, i) => ({
  url: `http://2345678a-${i + 1}:2345678a@p.webshare.io:80`,
  lastUsed: 0
}));

const transactionProxyPool = Array.from({ length: 50 }, (_, i) => ({
  url: `http://2345678a-${i + 51}:2345678a@p.webshare.io:80`,
  lastUsed: 0
}));

let signatureProxyIndex = 0;
let transactionProxyIndex = 0;

// Separate proxy usage tracking for each endpoint
const signatureProxyUsage = new Map(Array.from({ length: 50 }, (_, i) => [
  `signature-proxy-${i + 1}`,
  {
    requests: 0,
    lastReset: Date.now(),
    limiter: new Bottleneck({
      reservoir: 100,
      reservoirRefreshAmount: 100,
      reservoirRefreshInterval: 10000,
      maxConcurrent: 100
    })
  }
]));

const transactionProxyUsage = new Map(Array.from({ length: 50 }, (_, i) => [
  `transaction-proxy-${i + 1}`,
  {
    requests: 0,
    lastReset: Date.now(),
    limiter: new Bottleneck({
      reservoir: 100,
      reservoirRefreshAmount: 100,
      reservoirRefreshInterval: 10000,
      maxConcurrent: 100
    })
  }
]));

// Separate functions to get proxies for each endpoint
function getNextSignatureProxy() {
  const now = Date.now();
  let selectedProxy = null;

  for (let i = 0; i < signatureProxyPool.length; i++) {
    const proxyIndex = (signatureProxyIndex + i) % signatureProxyPool.length;
    const proxyKey = `signature-proxy-${proxyIndex + 1}`;
    const proxyState = signatureProxyUsage.get(proxyKey);

    if (now - proxyState.lastReset >= 10000) {
      proxyState.requests = 0;
      proxyState.lastReset = now;
    }

    if (proxyState.requests < 100) {
      selectedProxy = signatureProxyPool[proxyIndex];
      proxyState.requests++;
      signatureProxyIndex = (proxyIndex + 1) % signatureProxyPool.length;
      break;
    }
  }

  if (!selectedProxy) {
    console.log('All signature proxies at rate limit, waiting for reset...');
    return new Promise(resolve => setTimeout(() => resolve(getNextSignatureProxy()), 1000));
  }

  return new HttpsProxyAgent(selectedProxy.url);
}

function getNextTransactionProxy() {
  const now = Date.now();
  let selectedProxy = null;

  for (let i = 0; i < transactionProxyPool.length; i++) {
    const proxyIndex = (transactionProxyIndex + i) % transactionProxyPool.length;
    const proxyKey = `transaction-proxy-${proxyIndex + 1}`;
    const proxyState = transactionProxyUsage.get(proxyKey);

    if (now - proxyState.lastReset >= 10000) {
      proxyState.requests = 0;
      proxyState.lastReset = now;
    }

    if (proxyState.requests < 100) {
      selectedProxy = transactionProxyPool[proxyIndex];
      proxyState.requests++;
      transactionProxyIndex = (proxyIndex + 1) % transactionProxyPool.length;
      break;
    }
  }

  if (!selectedProxy) {
    console.log('All transaction proxies at rate limit, waiting for reset...');
    return new Promise(resolve => setTimeout(() => resolve(getNextTransactionProxy()), 1000));
  }

  return new HttpsProxyAgent(selectedProxy.url);
}

// Function to read JSON file
function readJSONFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Function to write JSON file
function writeJSONFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Create separate limiters for different API endpoints
const solanaMainnetLimiter = new Bottleneck({
  reservoir: 100, // 100 requests
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 11000, // 11 seconds (added 1 second buffer)
  maxConcurrent: 100
});

// Update Solana Tracker limiter to use per-proxy rate limiting
const solanaTrackerLimiter = new Bottleneck({
  reservoir: 1,  // 1 request at a time
  reservoirRefreshAmount: 1,
  reservoirRefreshInterval: 2000, // 2 seconds per IP
  maxConcurrent: 50,  // Allow multiple concurrent requests (one per proxy)
  minTime: 2000  // Ensure 2 seconds between requests per IP
});

// Add connection pooling and caching
const connectionPool = {
  mainnet: new Map(),
  tracker: new Map()
};

const cache = {
  signatures: new Map(),
  transactions: new Map(),
  prices: new Map()
};

// Update fetchSignatures with parallel processing
async function fetchSignatures(walletAddress) {
  if (cache.signatures.has(walletAddress)) {
    return cache.signatures.get(walletAddress);
  }

  const batchSize = 20; // Increased from 5 to 20
  const parallelBatches = 5; // Process 5 batches in parallel
  
  const makeRequest = async (before = null) => {
    try {
      const params = [walletAddress, { limit: batchSize }];
      if (before) params[1].before = before;

      const response = await axios.post('https://api.mainnet-beta.solana.com', {
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params
      }, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: await getNextSignatureProxy(),
        timeout: 10000
      });
      
      return response.data.result.map(item => ({
        blockTime: item.blockTime,
        signature: item.signature
      }));
    } catch (error) {
      console.error(`Error fetching signatures: ${error.message}`);
      return [];
    }
  };

  const results = await solanaMainnetLimiter.schedule(() => 
    Promise.all(Array(parallelBatches).fill().map(() => makeRequest()))
  );

  const signatures = results.flat();
  cache.signatures.set(walletAddress, signatures);
  return signatures;
}

// Optimize enhanceSignatures with parallel processing and caching
async function enhanceSignatures(signatures) {
  const rawTransactions = [];
  const results = [];
  const uncachedSignatures = signatures.filter(s => !cache.transactions.has(s.signature));
  
  const batchSize = 10;
  const batches = [];
  
  for (let i = 0; i < uncachedSignatures.length; i += batchSize) {
    batches.push(uncachedSignatures.slice(i, i + batchSize));
  }

  await Promise.all(batches.map(async (batch) => {
    const batchPromises = batch.map(async ({ signature }) => {
      if (cache.transactions.has(signature)) {
        return cache.transactions.get(signature);
      }

      const transaction = await fetchTransaction(signature);
      if (transaction) {
        cache.transactions.set(signature, transaction);
        rawTransactions.push(transaction);
        
        const mint = transaction.meta?.preTokenBalances?.[0]?.mint || 
                    transaction.meta?.postTokenBalances?.[0]?.mint || null;
        results.push({ signature, mint });
      }
    });

    await Promise.all(batchPromises);
  }));

  // Add cached transactions
  signatures.forEach(({ signature }) => {
    if (cache.transactions.has(signature)) {
      const transaction = cache.transactions.get(signature);
      rawTransactions.push(transaction);
      const mint = transaction.meta?.preTokenBalances?.[0]?.mint || 
                  transaction.meta?.postTokenBalances?.[0]?.mint || null;
      results.push({ signature, mint });
    }
  });

  return { results, rawTransactions };
}

// Function to fetch transaction details
async function fetchTransaction(signature) {
  try {
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
      headers: { 'Content-Type': 'application/json' },
      httpsAgent: await getNextTransactionProxy()
    });
    
    return response.data.result;
  } catch (error) {
    console.error(`Error fetching transaction ${signature}: ${error.message}`);
    return null;
  }
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

// Optimize fetchPrices with aggressive parallel processing
async function fetchPrices(transactions) {
  require('dotenv').config();
  const API_KEY = process.env.SOLANA_TRACKER_API_KEY;
  const prices = [];
  
  // Enhanced validation function
  function isValidPrice(priceData) {
    return (
      priceData &&
      typeof priceData.price === 'number' &&
      priceData.timestamp &&
      priceData.pool &&
      priceData.mint &&
      !isNaN(new Date(priceData.timestamp).getTime())
    );
  }

  // Enhanced parallel processing
  const batchSize = 25; // Increased from 10 to 25
  const maxConcurrent = 5; // Increased from 3 to 5
  const batches = [];
  
  for (let i = 0; i < transactions.length; i += batchSize) {
    batches.push(transactions.slice(i, i + batchSize));
  }

  const limiter = new Bottleneck({
    minTime: 1000, // Decreased from 2000 to 1000
    maxConcurrent,
    reservoir: 50, // Increased from 25 to 50
    reservoirRefreshAmount: 50,
    reservoirRefreshInterval: 60 * 1000
  });

  // Process batches in parallel with proxy rotation
  await Promise.all(batches.map(async (batch, batchIndex) => {
    const proxyAgent = await getNextTransactionProxy();
    const batchPromises = batch.map(tx => {
      const cacheKey = `${tx.mint}-${tx.blockTime}`;
      if (cache.prices.has(cacheKey)) {
        return cache.prices.get(cacheKey);
      }

      return limiter.schedule(async () => {
        try {
          const timestamp = tx.blockTime * 1000;
          const response = await axios.get(
            `https://data.solanatracker.io/price/history/timestamp?token=${tx.mint}&timestamp=${timestamp}`,
            { 
              headers: { 'x-api-key': API_KEY },
              timeout: 30000,
              validateStatus: (status) => status < 500
            }
          );

          const result = {
            ...(response.data || {}),
            mint: tx.mint,
            queriedBlockTime: tx.blockTime,
            timestamp_est: new Date(timestamp).toLocaleString('en-US', {
              timeZone: 'America/New_York'
            })
          };

          if (!isValidPrice(result)) {
            result.price = null;
            result.error = response.data?.error || "Invalid price data";
          }

          prices.push(result);
          cache.prices.set(cacheKey, result);
          return result;

        } catch (error) {
          const errorResult = {
            price: null,
            timestamp: tx.blockTime * 1000,
            mint: tx.mint,
            queriedBlockTime: tx.blockTime,
            error: error.response?.data?.error || "Internal Server Error",
            timestamp_est: new Date(tx.blockTime * 1000).toLocaleString('en-US', {
              timeZone: 'America/New_York'
            })
          };
          prices.push(errorResult);
          cache.prices.set(cacheKey, errorResult);
          return errorResult;
        }
      });
    });

    const batchResults = await Promise.all(batchPromises);
    prices.push(...batchResults);
  }));

  return prices;
}

// Update singleRunFlow for parallel processing
async function singleRunFlow() {
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

  // Increased parallel wallet processing
  const walletLimiter = new Bottleneck({
    maxConcurrent: 10, // Increased from 5 to 10
    minTime: 500 // Decreased from 1000 to 500
  });

  // Process wallets and their transactions in parallel
  const walletPromises = walletAddresses.map(address => 
    walletLimiter.schedule(async () => {
      const signatures = await fetchSignatures(address);
      const { enhancedResults, rawTransactions } = await enhanceSignatures(signatures);
      return { enhancedResults, rawTransactions };
    })
  );

  const walletResults = await Promise.all(walletPromises);

  // Combine results
  const allEnhancedData = [];
  const allRawTransactions = [];

  walletResults.forEach(({ enhancedResults, rawTransactions }) => {
    allEnhancedData.push(...enhancedResults);
    allRawTransactions.push(...rawTransactions);
  });

  // Write combined data
  writeJSONFile('enhancedOutput.json', allEnhancedData);
  writeJSONFile('rawTransactions.json', allRawTransactions);

  // Parse and process in parallel
  const parsedTransactions = parseMintAddresses(allEnhancedData);
  const transactionsWithTimestamps = convertTimestamps(parsedTransactions);

  // Fetch prices with improved validation
  const prices = await fetchPrices(transactionsWithTimestamps);

  // Enhanced filterPrices function
  function filterPrices(prices) {
    const validPrices = prices.filter(price => 
      price.price !== null && 
      price.pool && 
      !price.error && 
      !isNaN(new Date(price.timestamp).getTime())
    );

    const nullPrices = prices.filter(price => 
      !validPrices.find(v => v.mint === price.mint)
    );

    writeJSONFile('prices-valid.json', validPrices);
    writeJSONFile('prices-null.json', nullPrices);

    console.log(`Found ${nullPrices.length} null prices and ${validPrices.length} valid prices`);
  }

  filterPrices(prices);
  console.log('Done! Generated prices-valid.json and prices-null.json');
}

singleRunFlow();