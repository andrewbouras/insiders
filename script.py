import json
import requests

url = "https://api.mainnet-beta.solana.com"
wallet_address = "HuwdWCb8tHpTiv2U8W8SQebQYPc5BnNM3wori4ttsAJj"  # Your test wallet

all_signatures = []
before_sig = None
limit = 100  # pick an appropriate page size (could be 100, 500, 1000, etc.)

while True:
    params = [
        wallet_address,
        {"limit": limit}
    ]
    if before_sig:
        params[1]["before"] = before_sig
    
    payload_signatures = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getSignaturesForAddress",
        "params": params
    }
    
    r = requests.post(url, json=payload_signatures)
    d = r.json()
    batch = d.get("result", [])
    
    if not batch:
        break
    
    new_sigs = [entry["signature"] for entry in batch]
    all_signatures.extend(new_sigs)
    
    # Move 'before_sig' for the next page
    before_sig = batch[-1]["signature"]
    
    if len(batch) < limit:
        # No more pages left
        break

print(f"Total signatures found: {len(all_signatures)}")

mints = set()
transactions = []

for sig in all_signatures:
    payload_transaction = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [
            sig,
            {
                "encoding": "jsonParsed",  # <<-- The key difference
                "maxSupportedTransactionVersion": 0
            }
        ]
    }
    
    resp = requests.post(url, json=payload_transaction).json()
    result = resp.get("result")
    transactions.append(resp)  # store raw if you want
    
    if not result:
        continue  # might be pruned or invalid
    
    # 1) Mints from pre/post TokenBalances in meta
    meta = result.get("meta", {})
    for b in meta.get("preTokenBalances", []):
        if "mint" in b:
            mints.add(b["mint"])
    for b in meta.get("postTokenBalances", []):
        if "mint" in b:
            mints.add(b["mint"])
    
    # 2) Mints from parsed instructions
    tx_obj = result.get("transaction", {})
    message = tx_obj.get("message", {})

    # top-level instructions
    for ix in message.get("instructions", []):
        parsed = ix.get("parsed", {})
        if isinstance(parsed, dict):
            info = parsed.get("info", {})
            if "mint" in info:
                mints.add(info["mint"])
    
    # inner instructions
    for inner in message.get("innerInstructions", []):
        for ix in inner.get("instructions", []):
            parsed = ix.get("parsed", {})
            if isinstance(parsed, dict):
                info = parsed.get("info", {})
                if "mint" in info:
                    mints.add(info["mint"])

print(f"Total unique mints found: {len(mints)}")

# Optionally write the results
with open("signatures.json", "w") as f:
    json.dump({"signatures": all_signatures}, f, indent=2)

with open("transactions.json", "w") as f:
    json.dump(transactions, f, indent=2)

with open("mints.json", "w") as f:
    json.dump({"mints": list(mints)}, f, indent=2)
