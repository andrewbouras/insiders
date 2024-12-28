const fs = require('fs');

const blockTimeToUnixTimestamp = (blockTime) => {
    return blockTime * 1000; // Convert seconds to milliseconds
};

const enhancedOutput = JSON.parse(fs.readFileSync('enhancedOutput.json', 'utf-8'));

const updatedOutput = enhancedOutput.map(item => ({
    ...item,
    timestamp: blockTimeToUnixTimestamp(item.blockTime)
}));

fs.writeFileSync('enhancedOutput.json', JSON.stringify(updatedOutput, null, 2));
console.log('Timestamps have been added to enhancedOutput.json');
