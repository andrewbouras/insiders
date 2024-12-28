import json
import requests
import os

RPC_URL = "https://api.mainnet-beta.solana.com"
TX_MINTS_FILE = "transactions_mints.json"

def load_json_file(filepath, default):
    """Load JSON from `filepath`, or return `default` if not found."""
    if not os.path.exists(filepath):
        return default
    with open(filepath, "r") as f:
        return json.load(f)

def save_json_file(filepath, data):
    """Save JSON data to `filepath`."""
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)

def get_signatures_for_address(wallet_address, limit=50):
    """
    Calls `getSignaturesForAddress` on the Solana RPC.
    Returns a list of dicts:
      [
        {
          'signature': ...,
          'blockTime': ...,
          'slot': ...,
          'err': ...,
          ...
        },
        ...
      ]
    """
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getSignaturesForAddress",
        "params": [
            wallet_address,
            {
                "limit": limit
            }
        ]
    }
    resp = requests.post(RPC_URL, json=payload).json()
    return resp.get("result", [])

def get_transaction(signature):
    """
    Calls `getTransaction(signature)` to get the full transaction details.
    We'll use 'json' or 'jsonParsed' encoding. 
    """
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [
            signature,
            {
                "encoding": "jsonParsed",
                "maxSupportedTransactionVersion": 0
            }
        ]
    }
    return requests.post(RPC_URL, json=payload).json()

def extract_mints(tx_json):
    """
    Extracts SPL token mints from the transaction's preTokenBalances,
    postTokenBalances, and 'jsonParsed' instructions.
    Returns a set of mint addresses.
    """
    mints_found = set()
    result = tx_json.get("result")
    if not result:
        return mints_found  # Possibly pruned or invalid

    meta = result.get("meta", {})
    for b in meta.get("preTokenBalances", []):
        if "mint" in b:
            mints_found.add(b["mint"])
    for b in meta.get("postTokenBalances", []):
        if "mint" in b:
            mints_found.add(b["mint"])

    transaction_obj = result.get("transaction", {})
    message = transaction_obj.get("message", {})

    # top-level instructions
    for ix in message.get("instructions", []):
        parsed = ix.get("parsed", {})
        if isinstance(parsed, dict):
            info = parsed.get("info", {})
            if "mint" in info:
                mints_found.add(info["mint"])

    # inner instructions
    for inner in message.get("innerInstructions", []):
        for ix in inner.get("instructions", []):
            parsed = ix.get("parsed", {})
            if isinstance(parsed, dict):
                info = parsed.get("info", {})
                if "mint" in info:
                    mints_found.add(info["mint"])

    return mints_found

def main():
    # 1) Load the wallets from input.json
    with open("input.json", "r") as f:
        config = json.load(f)
    wallets = config.get("wallets", [])

    # 2) Load or init the data structure for transactions+mints
    # We'll keep a dict in memory of: { "transactions": { signature: { blockTime, mints } } }
    tx_mints_data = load_json_file(TX_MINTS_FILE, default={"transactions": {}})
    existing_transactions = tx_mints_data["transactions"]  # signature -> {blockTime, mints}

    for wallet in wallets:
        print(f"[*] Processing wallet: {wallet}")

        # 3) Fetch signatures (and blockTime from the summary)
        #    You can raise the limit if needed
        signature_summaries = get_signatures_for_address(wallet, limit=50)
        if not signature_summaries:
            print("  [!] No signatures found for this wallet.")
            continue

        # 4) Build a local map of `signature -> blockTime` from getSignaturesForAddress
        signature_to_blocktime = {}
        for item in signature_summaries:
            sig = item["signature"]
            # blockTime might be None if it's not stored, but usually it's present
            signature_to_blocktime[sig] = item.get("blockTime")

        # 5) Now get the transaction details for each signature we found
        #    We'll just do it for the ones not already in existing_transactions, or if you want to re-check, do all.
        for item in signature_summaries:
            sig = item["signature"]
            # If we already processed this signature, skip it (optional).
            # Or remove this check if you want to refresh data.
            if sig in existing_transactions:
                continue

            # Call getTransaction
            print(f"  [>] Fetching transaction for signature {sig}")
            tx_data = get_transaction(sig)

            # Extract minted tokens
            found_mints = extract_mints(tx_data)

            # Check if getTransaction gave us a blockTime
            result = tx_data.get("result", {})
            tx_block_time = result.get("blockTime")  # might be None if pruned

            # Fallback: if tx_block_time is None, use the one from signature summary
            if tx_block_time is None:
                tx_block_time = signature_to_blocktime[sig]

            # Save to the dictionary
            existing_transactions[sig] = {
                "blockTime": tx_block_time,
                "mints": list(found_mints)
            }

    # 6) Save all updated data back to transactions_mints.json
    tx_mints_data["transactions"] = existing_transactions
    save_json_file(TX_MINTS_FILE, tx_mints_data)

    print("\n[+] Done! Updated transactions_mints.json with new data.")

if __name__ == "__main__":
    main()
