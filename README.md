# Solana Wallet Monitor

This mini-project polls one or more Solana wallets at regular intervals (via cron or another scheduler).  
It does the following:

1. Reads a list of wallets from `input.json`.
2. Loads or creates a `monitor_state.json` file that tracks each wallet's **last processed signature**.
3. Fetches new transaction signatures for each wallet.
4. For each *new* signature, calls `getTransaction` to retrieve the transaction details.
5. Extracts unique token mints (from `meta` balances or parsed instructions).
6. Stores them in a growing set inside `mints.json`.

## Setup

1. Install Python 3.
2. Install dependencies:  
   ```bash
   pip install requests
