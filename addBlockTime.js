const fs = require('fs');

// Read both input files
const enhancedOutput = JSON.parse(fs.readFileSync('enhancedOutput.json', 'utf-8'));
const output = JSON.parse(fs.readFileSync('output.json', 'utf-8'));

// Create a map of signature to blockTime
const blockTimeMap = output.reduce((map, item) => {
    map[item.signature] = item.blockTime;
    return map;
}, {});

// Add blockTime to each entry in enhancedOutput
const updatedOutput = enhancedOutput.map(item => ({
    signature: item.signature,
    mint: item.mint,
    blockTime: blockTimeMap[item.signature]
}));

// Write the updated data back to enhancedOutput.json
fs.writeFileSync('enhancedOutput.json', JSON.stringify(updatedOutput, null, 2));
console.log('BlockTime values have been added to enhancedOutput.json');
