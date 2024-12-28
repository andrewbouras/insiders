const fs = require('fs');

const rawData = JSON.parse(fs.readFileSync('rawTransactions.json', 'utf-8'));
const enhancedOutput = [];

// Wrapped SOL token mint address to exclude
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

// Helper function to convert blockTime to Unix timestamp
const blockTimeToUnixTimestamp = (blockTime) => {
    return blockTime * 1000; // Convert seconds to milliseconds
};

rawData.forEach(transaction => {
  const signature = transaction.transaction.signatures[0];
  let mint = null;

  if (transaction.meta.preTokenBalances && transaction.meta.preTokenBalances.length > 0) {
    mint = transaction.meta.preTokenBalances[0].mint;
  } else if (transaction.meta.postTokenBalances && transaction.meta.postTokenBalances.length > 0) {
    mint = transaction.meta.postTokenBalances[0].mint;
  }

  // Only add to output if mint exists and is not wrapped SOL
  if (mint && mint !== WRAPPED_SOL_MINT) {
    enhancedOutput.push({
        signature,
        mint,
        blockTime: transaction.blockTime,
        timestamp: blockTimeToUnixTimestamp(transaction.blockTime)
    });
  }
});

fs.writeFileSync('enhancedOutput.json', JSON.stringify(enhancedOutput, null, 2));
console.log('Mint values and timestamps have been extracted and enhancedOutput.json has been updated.');