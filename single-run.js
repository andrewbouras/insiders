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
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 2000, // 2 seconds
  maxConcurrent: 1, // Only one request at a time per proxy
  minTime: 2000 // Minimum time between requests per proxy
});

// Function to fetch transaction signatures
async function fetchSignatures(walletAddress) {
  const makeRequest = async () => {
    try {
      const response = await axios.post('https://api.mainnet-beta.solana.com', {
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [
          walletAddress,
          { limit: 5 }
        ]
      }, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: await getNextSignatureProxy()
      });
      
      // Add this mapping to match the old implementation
      const filtered = response.data.result.map(item => ({
        blockTime: item.blockTime,
        signature: item.signature
      }));
      return filtered; // Return the filtered data instead of raw result
    } catch (error) {
      console.error(`Error fetching signatures: ${error.message}`);
      return [];
    }
  };

  return solanaMainnetLimiter.schedule(makeRequest);
}

// Function to enhance with transaction data
async function enhanceSignatures(signatures) {
  const rawTransactions = [];
  const results = [];

  for (let i = 0; i < signatures.length; i++) {
    console.log(`Processing signature: ${signatures[i].signature}`);
    const transaction = await fetchTransaction(signatures[i].signature);
    
    if (transaction) {
      rawTransactions.push(transaction); // Store the raw transaction
      const mint = transaction.meta?.preTokenBalances?.[0]?.mint || 
                  transaction.meta?.postTokenBalances?.[0]?.mint || null;
      results.push({ signature: signatures[i].signature, mint });
    }
  }

  // Write raw transactions immediately
  fs.writeFileSync('rawTransactions.json', JSON.stringify(rawTransactions, null, 2));
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

// Add proxy tracking with cooldown
const proxyUsageMap = new Map();
const COOLDOWN_TIME = 3000; // 3 seconds cooldown
const REQUEST_QUEUE = [];
let isProcessingQueue = false;

class ProxyManager {
  constructor(proxyPool) {
    this.proxyPool = proxyPool;
    this.proxyStates = new Map();
    this.initializeProxyStates();
  }

  initializeProxyStates() {
    this.proxyPool.forEach(proxy => {
      this.proxyStates.set(proxy.url, {
        lastUsed: 0,
        failureCount: 0,
        cooldownUntil: 0
      });
    });
  }

  async getAvailableProxy() {
    const now = Date.now();
    const availableProxies = this.proxyPool.filter(proxy => {
      const state = this.proxyStates.get(proxy.url);
      return now >= state.cooldownUntil && state.failureCount < 3;
    });

    if (availableProxies.length === 0) {
      // Wait for the proxy with shortest cooldown
      const earliestAvailable = Math.min(
        ...Array.from(this.proxyStates.values()).map(state => state.cooldownUntil)
      );
      const waitTime = Math.max(0, earliestAvailable - now);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.getAvailableProxy();
    }

    // Sort by last used time and failure count
    const proxy = availableProxies.sort((a, b) => {
      const stateA = this.proxyStates.get(a.url);
      const stateB = this.proxyStates.get(b.url);
      return (stateA.lastUsed - stateB.lastUsed) || (stateA.failureCount - stateB.failureCount);
    })[0];

    this.proxyStates.get(proxy.url).lastUsed = now;
    return proxy;
  }

  markProxyFailure(proxyUrl) {
    const state = this.proxyStates.get(proxyUrl);
    state.failureCount++;
    state.cooldownUntil = Date.now() + (COOLDOWN_TIME * Math.pow(2, state.failureCount));
  }

  resetProxyState(proxyUrl) {
    const state = this.proxyStates.get(proxyUrl);
    state.failureCount = 0;
    state.cooldownUntil = Date.now() + COOLDOWN_TIME;
  }
}

// Initialize proxy managers
const priceProxyManager = new ProxyManager(transactionProxyPool);

// API Key Management
class ApiKeyManager {
  constructor() {
    require('dotenv').config();
    const apiKeysString = process.env.SOLANA_TRACKER_API_KEY || '';
    this.apiKeys = apiKeysString.split(',').map(key => key.trim()).filter(key => key.length > 0);
    this.currentIndex = 0;
    this.keyUsage = new Map();
    
    // Initialize usage tracking for each key
    this.apiKeys.forEach(key => {
      this.keyUsage.set(key, {
        lastUsed: 0,
        failureCount: 0,
        limiter: new Bottleneck({
          minTime: 2000, // 2 seconds between requests
          maxConcurrent: 1
        })
      });
    });
  }

  getNextApiKey() {
    const key = this.apiKeys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
    return key;
  }

  async getAvailableApiKey() {
    const now = Date.now();
    for (const key of this.apiKeys) {
      const usage = this.keyUsage.get(key);
      if (now - usage.lastUsed >= 2000 && usage.failureCount < 3) {
        usage.lastUsed = now;
        return key;
      }
    }
    // If no key is immediately available, wait for the least recently used one
    const leastRecentKey = [...this.keyUsage.entries()]
      .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)[0][0];
    const usage = this.keyUsage.get(leastRecentKey);
    await new Promise(resolve => setTimeout(resolve, 2000 - (now - usage.lastUsed)));
    usage.lastUsed = Date.now();
    return leastRecentKey;
  }

  markKeyFailure(key) {
    const usage = this.keyUsage.get(key);
    usage.failureCount++;
    if (usage.failureCount >= 3) {
      console.log(`API key ${key.substring(0, 8)}... has been temporarily disabled due to failures`);
    }
  }

  resetKeyFailures(key) {
    const usage = this.keyUsage.get(key);
    usage.failureCount = 0;
  }

  get concurrentRequests() {
    return this.apiKeys.length;
  }
}

// Initialize API key manager globally
const apiKeyManager = new ApiKeyManager();

// Update fetchPrices function to use API key rotation
async function fetchPrices(transactions) {
  const prices = [];
  const batchSize = apiKeyManager.concurrentRequests;

  async function fetchPriceWithRetry(tx, attempt = 1, maxAttempts = 3) {
    const apiKey = await apiKeyManager.getAvailableApiKey();
    const proxy = await priceProxyManager.getAvailableProxy();
    
    try {
      const timestamp = tx.blockTime * 1000;
      
      console.log(`Fetching price for mint ${tx.mint} using API key ${apiKey.substring(0, 8)}... and proxy ${proxy.url.substring(0, 15)}... (Attempt ${attempt}/${maxAttempts})`);
      
      const response = await axios.get(
        `https://data.solanatracker.io/price/history/timestamp?token=${tx.mint}&timestamp=${timestamp}`,
        { 
          headers: { 'x-api-key': apiKey },
          timeout: 30000,
          validateStatus: (status) => true,
          httpsAgent: new HttpsProxyAgent(proxy.url)
        }
      );

      if (response.status === 429 || response.data?.error?.includes('rate limit')) {
        apiKeyManager.markKeyFailure(apiKey);
        priceProxyManager.markProxyFailure(proxy.url);
        
        if (attempt < maxAttempts) {
          console.log(`Rate limit hit for ${tx.mint}, retrying with different API key/proxy...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return fetchPriceWithRetry(tx, attempt + 1, maxAttempts);
        }
      } else {
        apiKeyManager.resetKeyFailures(apiKey);
        priceProxyManager.resetProxyState(proxy.url);
      }

      return {
        price: response.data?.price || null,
        timestamp: timestamp,
        pool: response.data?.pool,
        mint: tx.mint,
        queriedBlockTime: tx.blockTime,
        error: response.data?.error || null,
        timestamp_est: new Date(timestamp).toLocaleString('en-US', {
          timeZone: 'America/New_York'
        })
      };

    } catch (error) {
      apiKeyManager.markKeyFailure(apiKey);
      priceProxyManager.markProxyFailure(proxy.url);
      
      if (attempt < maxAttempts) {
        console.log(`Error for ${tx.mint}, retrying with different API key/proxy...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return fetchPriceWithRetry(tx, attempt + 1, maxAttempts);
      }
      
      return {
        price: null,
        timestamp: tx.blockTime * 1000,
        mint: tx.mint,
        queriedBlockTime: tx.blockTime,
        error: error.response?.data?.error || "Internal Server Error",
        timestamp_est: new Date(tx.blockTime * 1000).toLocaleString('en-US', {
          timeZone: 'America/New_York'
        })
      };
    }
  }

  // Process transactions in parallel based on available API keys
  for (let i = 0; i < transactions.length; i += batchSize) {
    const batch = transactions.slice(i, i + batchSize);
    const batchPromises = batch.map(tx => fetchPriceWithRetry(tx));
    const batchResults = await Promise.all(batchPromises);
    prices.push(...batchResults);
  }

  return prices;
}

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

  // Process wallets in parallel with controlled concurrency
  const walletLimiter = new Bottleneck({
    maxConcurrent: 5,
    minTime: 1000
  });

  async function processWallet(walletAddress) {
    console.log(`Processing wallet address: ${walletAddress}`);
    
    // Fetch signatures and transactions in parallel
    const signatures = await fetchSignatures(walletAddress);
    
    // Process signatures in batches
    const signatureBatches = [];
    const batchSize = 5;
    
    for (let i = 0; i < signatures.length; i += batchSize) {
      signatureBatches.push(signatures.slice(i, i + batchSize));
    }

    const enhancedResults = [];
    const rawTransactions = [];

    await Promise.all(signatureBatches.map(async (batch) => {
      const { results, rawTransactions: batchRaw } = await enhanceSignatures(batch);
      enhancedResults.push(...results);
      rawTransactions.push(...batchRaw);
    }));

    return { enhancedResults, rawTransactions };
  }

  // Process all wallets concurrently
  const walletResults = await Promise.all(
    walletAddresses.map(address => 
      walletLimiter.schedule(() => processWallet(address))
    )
  );

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

  filterPrices(prices);
  console.log('Done! Generated prices-valid.json and prices-null.json');
}

async function processSignaturesParallel(walletAddress) {
  const signatures = await fetchSignatures(walletAddress);
  const signatureTasks = [];
  const batchSize = 5;

  for (let i = 0; i < signatures.length; i += batchSize) {
    // Process each batch of signatures in parallel
    const batch = signatures.slice(i, i + batchSize);
    const task = Promise.all(batch.map(async (sig) => {
      const { results, rawTransactions } = await enhanceSignatures([sig]);
      // Immediately parse mint addresses and fetch prices
      const parsed = parseMintAddresses(results);
      const withTimestamps = convertTimestamps(parsed);
      const prices = await fetchPrices(withTimestamps);
      return { enhancements: results, txData: rawTransactions, prices };
    }));
    signatureTasks.push(task);
  }

  const batchResults = await Promise.all(signatureTasks);
  // Consolidate
  const enhancedResults = [];
  const rawTransactions = [];
  const allPrices = [];

  for (const batch of batchResults) {
    for (const item of batch) {
      enhancedResults.push(...item.enhancements);
      rawTransactions.push(...item.txData);
      allPrices.push(...item.prices);
    }
  }

  fs.writeFileSync('enhancedOutput.json', JSON.stringify(enhancedResults, null, 2));
  fs.writeFileSync('rawTransactions.json', JSON.stringify(rawTransactions, null, 2));
  return allPrices;
}

// Update singleRunFlow to run processSignaturesParallel immediately for each wallet
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

  const walletLimiter = new Bottleneck({
    maxConcurrent: 5,
    minTime: 1000
  });

  const walletsParallel = walletAddresses.map((addr) => 
    walletLimiter.schedule(() => processSignaturesParallel(addr))
  );
  const allResults = await Promise.all(walletsParallel);
  const combinedPrices = allResults.flat();

  // Filter final prices
  function filterPrices(prices) {
    const validPrices = prices.filter(price =>
      price.price !== null &&
      price.pool &&
      !price.error &&
      !isNaN(new Date(price.timestamp).getTime())
    );
    const nullPrices = prices.filter(price => !validPrices.find(v => v.mint === price.mint));
    writeJSONFile('prices-valid.json', validPrices);
    writeJSONFile('prices-null.json', nullPrices);
    console.log(`Found ${nullPrices.length} null prices and ${validPrices.length} valid prices`);
  }

  filterPrices(combinedPrices);
  console.log('Done! Generated prices-valid.json and prices-null.json');
}

singleRunFlow();