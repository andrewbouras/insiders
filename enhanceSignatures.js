const fs = require('fs');
const axios = require('axios');
const Bottleneck = require('bottleneck'); // Add this line

const output = JSON.parse(fs.readFileSync('output.json', 'utf-8'));

const enhancedOutput = [];
const rawTransactions = []; // Add this line

const fetchTransaction = async (signature) => {
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    try {
      console.log(`Fetching transaction for signature: ${signature} (Attempt ${attempts + 1})`);
      const response = await axios.post('https://api.mainnet-beta.solana.com', {
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          {
            encoding: "json",
            maxSupportedTransactionVersion: 0
          }
        ]
      }, {
        headers: {
          "Content-Type": "application/json"
        }
      });

      const transaction = response.data.result;
      
      // Log presence of preTokenBalances and postTokenBalances
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

      rawTransactions.push(transaction); // Add this line

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
};

// Initialize Bottleneck with adjusted rate limits for single concurrency
const limiter = new Bottleneck({
  reservoir: 10, // Further reduce to 10 requests
  reservoirRefreshAmount: 10,
  reservoirRefreshInterval: 10 * 1000, // Refresh every 10 seconds
  maxConcurrent: 1, // Handle one request at a time
  minTime: 1000 // Minimum time between requests set to 1 second
});

// Wrap the fetchTransaction function with the limiter
const limitedFetchTransaction = limiter.wrap(fetchTransaction);

const results = [];
const queue = [...output];

const processQueue = async () => {
  console.log(`Starting to process ${queue.length} signatures with a concurrency limit of 1.`);
  while (queue.length > 0) {
    const signatureObj = queue.shift(); // Handle one signature at a time
    const signature = signatureObj.signature;
    console.log(`Processing signature: ${signature}`);
    const result = await limitedFetchTransaction(signature);
    results.push(result);
    console.log(`Batch processed. Total results collected: ${results.length}`);
  }
};

processQueue()
  .then(() => {
    fs.writeFileSync('enhancedOutput.json', JSON.stringify(results, null, 2));
    fs.writeFileSync('rawTransactions.json', JSON.stringify(rawTransactions, null, 2)); // Add this line
    console.log('All transactions have been processed and enhancedOutput.json & rawTransactions.json have been updated.');
  })
  .catch(error => {
    console.error('An unexpected error occurred while processing the queue:', error);
  });

