npm run fetch
npm start
npm run parse-mint
npm run convert-timestamps
npm run fetch-prices
npm run filter-prices



git add .
git commit -m "
git push origin main









# Solana Transaction Price Tracker

This project tracks Solana transactions for a specified wallet, extracts relevant token mint information, fetches historical prices, and organizes the data for analysis.

## Table of Contents

- [Setup](#setup)
- [Command Sequence](#command-sequence)
- [File Structure](#file-structure)
- [Detailed Process Flow](#detailed-process-flow)
- [Rate Limiting Details](#rate-limiting-details)
- [Error Handling](#error-handling)
- [Troubleshooting](#troubleshooting)
- [Additional Notes](#additional-notes)

## Setup

1. **Clone the Repository**
    ```bash
    git clone https://github.com/andrewbouras/insiders.git
    cd insiders
    ```

2. **Install Dependencies**
    ```bash
    npm install
    ```

3. **Configure Environment Variables**
    - Create a `.env` file in the root directory:
      ```bash
      touch .env
      ```
    - Add your SolanaTracker API key to the `.env` file:
      ```
      SOLANA_TRACKER_API_KEY=your-api-key-here
      ```

4. **Prepare Input File**
    - Ensure `input.json` contains the wallet address you want to monitor:
      ```json
      {
        "walletAddress": "HuwdWCb8tHpTiv2U8W8SQebQYPc5BnNM3wori4ttsAJj"
      }
      ```

## Command Sequence

Execute the following commands in the specified order to process the data:

1. **Fetch Initial Transaction Signatures**
    ```bash
    npm run fetch
    ```
    - **Description**: Reads the wallet address from `input.json` and fetches the latest 7 transaction signatures.
    - **Output**: `output.json` containing signatures and their corresponding `blockTime`.

2. **Enhance Transactions with Mint Data**
    ```bash
    npm start
    ```
    - **Description**: Processes each signature from `output.json`, fetches detailed transaction data, and extracts mint addresses.
    - **Output**: 
        - `enhancedOutput.json` with `signature` and `mint`.
        - `rawTransactions.json` containing full transaction details.

3. **Parse Mint Addresses and Add Timestamps**
    ```bash
    npm run parse-mint
    ```
    - **Description**: Analyzes `rawTransactions.json` to extract mint addresses, converts `blockTime` to Unix timestamps, and updates `enhancedOutput.json`.
    - **Output**: Updated `enhancedOutput.json` with `signature`, `mint`, `blockTime`, and `timestamp`.

4. **Add Block Times to Transactions**
    ```bash
    npm run add-blocktime
    ```
    - **Description**: Maps `blockTime` from `output.json` to each transaction in `enhancedOutput.json`.
    - **Output**: `enhancedOutput.json` with `blockTime` added.

5. **Convert Block Times to Timestamps**
    ```bash
    npm run convert-timestamps
    ```
    - **Description**: Converts `blockTime` from seconds to Unix milliseconds and adds a `timestamp` field to each entry in `enhancedOutput.json`.
    - **Output**: `enhancedOutput.json` with `timestamp` added.

6. **Fetch Historical Prices**
    ```bash
    npm run fetch-prices
    ```
    - **Description**: Uses the SolanaTracker API to fetch historical prices for each `mint` at the specified `timestamp`.
    - **Output**: `prices.json` containing price data for each `mint`.

7. **Filter Prices into Valid and Null Sets**
    ```bash
    npm run filter-prices
    ```
    - **Description**: Separates `prices.json` into two files based on the availability of price data.
    - **Output**:
        - `prices-valid.json`: Entries with valid `price` values.
        - `prices-null.json`: Entries where `price` is `null`.

## File Structure

- **Configuration Files**
  - `input.json`: Contains the wallet address to monitor.
  - `.env`: Stores environment variables like the SolanaTracker API key.

- **Data Files**
  - `output.json`: Initial signatures and `blockTime`.
  - `rawTransactions.json`: Full transaction data fetched from Solana.
  - `enhancedOutput.json`: Processed data with `signature`, `mint`, `blockTime`, and `timestamp`.
  - `prices.json`: Historical price data fetched from SolanaTracker.
  - `prices-valid.json`: Filtered data with valid prices.
  - `prices-null.json`: Filtered data with `null` prices.

- **Scripts**
  - `fetchSignatures.js`: Fetches transaction signatures.
  - `enhanceSignatures.js`: Enhances signatures with transaction data.
  - `parseMint.js`: Parses mint addresses and adds timestamps.
  - `addBlockTime.js`: Adds `blockTime` to transactions.
  - `convertTimestamps.js`: Converts `blockTime` to Unix timestamps.
  - `fetchPrices.js`: Fetches historical prices.
  - `filterPrices.js`: Filters prices into separate files.

- **Configuration**
  - `package.json`: Manages project dependencies and scripts.

## Detailed Process Flow

1. **Initial Data Collection** (`fetchSignatures.js`)
   - **Function**: 
     - Reads the wallet address from `input.json`.
     - Fetches the latest 7 transaction signatures using Solana's RPC API.
     - Stores the signatures along with their `blockTime` in `output.json`.
   - **Purpose**: To identify recent transactions related to the specified wallet.

2. **Transaction Enhancement** (`enhanceSignatures.js`)
   - **Function**:
     - Processes each signature from `output.json`.
     - Fetches detailed transaction data from Solana's RPC API.
     - Extracts `mint` addresses from `preTokenBalances`, `postTokenBalances`, or transaction instructions.
     - Stores the `signature` and `mint` in `enhancedOutput.json`.
     - Saves full transaction details in `rawTransactions.json`.
   - **Purpose**: To enrich transaction data with relevant token mint information.

3. **Mint Processing** (`parseMint.js`)
   - **Function**:
     - Reads `rawTransactions.json`.
     - Extracts `mint` addresses, excluding the wrapped SOL mint (`So11111111111111111111111111111111111111112`).
     - Converts `blockTime` from seconds to Unix milliseconds.
     - Updates `enhancedOutput.json` with `blockTime` and `timestamp`.
   - **Purpose**: To prepare data for price fetching by associating each transaction with its timestamp.

4. **Adding Block Times** (`addBlockTime.js`)
   - **Function**:
     - Maps `blockTime` from `output.json` to each transaction in `enhancedOutput.json`.
     - Ensures each entry in `enhancedOutput.json` has the correct `blockTime`.
   - **Purpose**: To synchronize transaction data with their respective block times.

5. **Timestamp Conversion** (`convertTimestamps.js`)
   - **Function**:
     - Converts `blockTime` from seconds to Unix milliseconds.
     - Adds a `timestamp` field to each entry in `enhancedOutput.json`.
   - **Purpose**: To format timestamps for API requests and data consistency.

6. **Price Fetching** (`fetchPrices.js`)
   - **Function**:
     - Reads `enhancedOutput.json`.
     - For each `mint` and `timestamp`, makes a GET request to the SolanaTracker API to fetch historical prices.
     - Implements rate limiting (1 request per second) using the Bottleneck library.
     - Handles `429 Too Many Requests` errors with exponential backoff retries.
     - Stores the fetched price data in `prices.json`.
   - **Purpose**: To obtain historical price data for each token associated with the transactions.

7. **Price Filtering** (`filterPrices.js`)
   - **Function**:
     - Reads `prices.json`.
     - Filters the data into two separate files:
       - `prices-valid.json`: Entries where `price` is not `null`.
       - `prices-null.json`: Entries where `price` is `null`.
   - **Purpose**: To organize price data based on availability for further analysis or reporting.

## Rate Limiting Details

- **Solana RPC**:
  - Limit: 40 requests per 10 seconds.
  - Managed using Bottleneck with a reservoir of 40 and a reservoir refresh interval of 10 seconds.

- **SolanaTracker API**:
  - Limit: 1 request per second.
  - Managed using Bottleneck with a minimum time of 1000 milliseconds between requests.

**Tools Used**:
- **Bottleneck**: For implementing rate limiting and handling concurrent API requests.

## Error Handling

- **Rate Limiting (HTTP 429)**:
  - Implemented retry logic with exponential backoff.
  - Logs rate limit responses and waits before retrying.

- **Network Errors**:
  - Catches and logs network-related issues.
  - Continues processing remaining requests without terminating the entire script.

- **Data Validity**:
  - Filters out transactions with missing or null price data.
  - Ensures only valid and relevant data is processed and stored.

## Troubleshooting

1. **Rate Limiting Errors (429)**
    - **Cause**: Exceeded API request limits.
    - **Solution**:
      - Ensure rate limiting is correctly implemented.
      - Check the rate limit policies of the APIs.
      - If necessary, increase delays between requests.

2. **Missing or Incomplete Data**
    - **Cause**: API failures or incorrect data mapping.
    - **Solution**:
      - Verify API keys and permissions.
      - Check the integrity of input and output JSON files.
      - Review logs for specific error messages.

3. **Environment Variable Issues**
    - **Cause**: Missing or incorrect `.env` configurations.
    - **Solution**:
      - Ensure the `.env` file exists in the root directory.
      - Verify that `SOLANA_TRACKER_API_KEY` is correctly set.

4. **Script Failures**
    - **Cause**: Syntax errors or unexpected exceptions in scripts.
    - **Solution**:
      - Review error messages in the console.
      - Ensure all dependencies are installed correctly.
      - Validate the structure of JSON input files.

## Additional Notes

- **Timestamp Formats**:
  - `blockTime`: Seconds since Unix epoch.
  - `timestamp`: Milliseconds since Unix epoch (used for API requests).

- **Data Exclusions**:
  - Wrapped SOL transactions (`So11111111111111111111111111111111111111112`) are automatically excluded from processing.

- **API Keys Security**:
  - Ensure that the `.env` file is not committed to version control to protect sensitive API keys.
  - Use environment variables to manage and secure API credentials.

- **Extensibility**:
  - The project structure allows for easy addition of new features, such as monitoring multiple wallets or integrating additional data sources.

- **Logging**:
  - Scripts log their progress and any errors to the console for easy monitoring and debugging.

---