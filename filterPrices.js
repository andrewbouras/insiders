const fs = require('fs');

// Read prices data
const prices = JSON.parse(fs.readFileSync('prices.json', 'utf-8'));

// Filter into two arrays
const nullPrices = prices.filter(item => item.price === null);
const validPrices = prices.filter(item => item.price !== null);

// Write to separate files
fs.writeFileSync('prices-null.json', JSON.stringify(nullPrices, null, 2));
fs.writeFileSync('prices-valid.json', JSON.stringify(validPrices, null, 2));

console.log(`Found ${nullPrices.length} null prices and ${validPrices.length} valid prices`);
console.log('Data has been written to prices-null.json and prices-valid.json');
