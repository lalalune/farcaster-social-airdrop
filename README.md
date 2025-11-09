# Farcaster Social Airdrop Finder

## Overview

A general-purpose tool to find Farcaster users who posted about a token but haven't received or bought it yet. Perfect for identifying potential airdrop recipients for any Base chain token.

## Prerequisites

1. **Neynar API Key**: You need a Neynar API key to access Farcaster data
   - Get one at: https://neynar.com/
   - Add it to your `.env` file: `NEYNAR_API_KEY=your_key_here`

2. **Token Contract Address**: Find your token's contract address on Base chain
   - **Base Explorer**: https://basescan.org/
   - **DexScreener**: https://dexscreener.com/base

## How to Use

### Basic Usage (elizaOS - Default)

```bash
# Uses default elizaOS settings
node src/index.js social-airdrop
```

### Search for Any Token

```bash
# Search for DEGEN token
node src/index.js social-airdrop \
  --ticker="DEGEN" \
  --tokenAddress="0xDEGENTokenAddressHere"

# Search for HIGHER token
node src/index.js social-airdrop \
  --ticker="HIGHER" \
  --tokenAddress="0xHIGHERTokenAddressHere"
```

### Advanced Usage

```bash
# Custom search text (instead of ticker-based)
node src/index.js social-airdrop \
  --ticker="MYTOKEN" \
  --searchText="\"My Token\" | token" \
  --tokenAddress="0x..." \
  --output="custom_results.csv"
```

### Parameters

- **`--ticker`** (default: "elizaOS"): Token ticker/symbol - automatically searches for "$ticker"
- **`--searchText`**: Custom search text (overrides automatic "$ticker" format)
- **`--tokenAddress`** (default: elizaOS address): Token contract address on Base chain
- **`--output`**: Output CSV filename (auto-generated as `{ticker}_airdrop_eligible.csv` if not specified)
- **`--noCache`**: Disable caching and fetch fresh data

## What the Script Does

1. **Searches Farcaster**: Uses global searchCasts API to find ALL casts with your search term
2. **Deduplicates**: Keeps only one cast per user (removes duplicate posts)
3. **Extracts Users**: Gets unique users and their verified Ethereum addresses
4. **Checks Balances**: Queries Base blockchain using multiple RPC providers for reliability
5. **Generates CSV**: Creates a CSV with users who DON'T have the token yet

## Features

- ✅ **Global Search**: Finds EVERY cast across all of Farcaster
- ✅ **Smart Caching**: 40x faster on subsequent runs
- ✅ **Resume Capability**: Can pause and restart anytime
- ✅ **Multi-RPC**: Rotates through 5 RPC providers with exponential backoff
- ✅ **User Deduplication**: One result per user (no duplicates)
- ✅ **General Purpose**: Works for any token, not just elizaOS

## Example Use Cases

```bash
# Find DEGEN supporters without the token
node src/index.js social-airdrop --ticker="DEGEN" --tokenAddress="0x..."

# Find HIGHER community members
node src/index.js social-airdrop --ticker="HIGHER" --tokenAddress="0x..."

# Find ai16z mentions
node src/index.js social-airdrop --ticker="ai16z" --tokenAddress="0x..."

# Custom search with multiple terms
node src/index.js social-airdrop \
  --searchText="(MYTOKEN | \$MYTOKEN | #MYTOKEN)" \
  --tokenAddress="0x..."
```

## Output CSV Format

The generated CSV will have these columns:

| Column | Description |
|--------|-------------|
| Username | Farcaster username |
| Display Name | User's display name |
| FID | Farcaster ID (unique identifier) |
| Wallet Address | Verified Ethereum address or "NO_VERIFIED_ADDRESS" |
| Reason | Why eligible: "NO_TOKEN" or "NO_ADDRESS" |
| Follower Count | User's follower count (for prioritization) |

## Example Output

```csv
Username,Display Name,FID,Wallet Address,Reason,Follower Count
alice,Alice Smith,12345,0x1234...,NO_TOKEN,523
bob,Bob Jones,67890,NO_VERIFIED_ADDRESS,NO_ADDRESS,142
charlie,Charlie Brown,11111,0x5678...,NO_TOKEN,891
```

## Performance & Reliability

### Built-in Protections
- **Rate limiting**: 1 second between API calls
- **Exponential backoff**: Automatic retry with increasing delays
- **Multi-RPC rotation**: Switches between 5 Base RPC providers
- **Auto-save**: Progress saved every 10 pages (casts) and 25 users (balances)
- **Resume capability**: Interrupt and restart anytime

### Speed
- **First run**: 10-30 minutes (finds all users + checks balances)
- **Subsequent runs**: 15-30 seconds (uses cached data)
- **Speedup**: 40x faster with caching

## Real-World Examples

### Find DEGEN Community Members
```bash
node src/index.js social-airdrop \
  --ticker="DEGEN" \
  --tokenAddress="0x4ed4e862860bed51a9570b96d89af5e1b0efefed"
```

### Find HIGHER Supporters
```bash
node src/index.js social-airdrop \
  --ticker="HIGHER" \
  --tokenAddress="0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe"
```

### Find ai16z Mentions
```bash
node src/index.js social-airdrop \
  --ticker="ai16z" \
  --tokenAddress="0xYourTokenAddress"
```

### Multiple Variations
```bash
# Search for any mention of the token
node src/index.js social-airdrop \
  --ticker="MYTOKEN" \
  --searchText="MYTOKEN | \$MYTOKEN | #MYTOKEN | mytoken" \
  --tokenAddress="0x..."
```

## Troubleshooting

### "No casts found"
- The ticker might not be used on Farcaster
- Try different search terms
- Verify the ticker is spelled correctly

### Balance check errors
- The script automatically retries with 5 different RPCs
- If all fail, those users are marked as eligible (can't verify)
- Most checks should succeed

### Script seems stuck
- Check progress with: `tail -f FINAL_RUN.log`
- Checking 1000+ wallets takes 20-30 minutes (normal)
- Each wallet check: ~1 second with retries

## Tips for Best Results

1. **Use ticker parameter**: Easiest way - searches for "$ticker" automatically
2. **Custom search for comprehensive results**: Use OR operators for variations
3. **Verify token address**: Double-check on BaseScan before running
4. **Let it complete**: First run takes time but subsequent runs are instant
5. **Use follower count**: CSV includes followers - prioritize high-influence users

## Privacy & Ethics

⚠️ **Important Considerations:**

- Only wallet addresses that users have verified on Farcaster are collected
- This data is publicly available through the Farcaster protocol
- Use this tool responsibly and respect user privacy
- Don't spam or harass users identified through this tool
- Consider the ethical implications of airdrops and token distribution

## Need Help?

For more information about available commands:
```bash
node src/index.js --help
node src/index.js social-airdrop --help
```

Happy hunting! 🎯

