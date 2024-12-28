
const fs = require('fs');
const axios = require('axios');

const input = JSON.parse(fs.readFileSync('input.json', 'utf-8'));
const walletAddress = input.walletAddress;

axios.post('https://api.mainnet-beta.solana.com', {
  jsonrpc: "2.0",
  id: 1,
  method: "getSignaturesForAddress",
  params: [
    walletAddress,
    { limit: 7 }
  ]
}, {
  headers: {
    "Content-Type": "application/json"
  }
})
.then(response => {
  const filtered = response.data.result.map(item => ({
    blockTime: item.blockTime,
    signature: item.signature
  }));
  fs.writeFileSync('output.json', JSON.stringify(filtered, null, 2));
})
.catch(error => {
  console.error(error);
});