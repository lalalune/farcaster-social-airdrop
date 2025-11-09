import { getClient } from "./client.js";
import { ethers } from "ethers";
import { createObjectCsvWriter } from "csv-writer";
import fs from "fs";
import path from "path";
import readline from "readline";

// Note: The old fetch command is deprecated
export async function fetchCastsHandler(argv) {
  console.error("\n⚠️  The 'fetch' command is deprecated.");
  console.error("   Please use the 'social-airdrop' command instead.");
  console.error("   Run: node src/index.js social-airdrop --help\n");
}

// ERC20 ABI for checking token balance
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// Base chain RPC URLs - multiple providers for reliability
const BASE_RPC_URLS = [
  "https://base.llamarpc.com",
  "https://mainnet.base.org",
  "https://base.meowrpc.com",
  "https://base-mainnet.public.blastapi.io",
  "https://base.gateway.tenderly.co",
];

let currentRpcIndex = 0;

// Check if a wallet has any elizaOS token balance with retry logic and RPC rotation
async function hasElizaOSToken(walletAddress, tokenAddress) {
  const maxRetries = BASE_RPC_URLS.length * 2; // Try each RPC twice
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Round-robin through RPC providers
      const rpcUrl = BASE_RPC_URLS[currentRpcIndex % BASE_RPC_URLS.length];
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      const balance = await tokenContract.balanceOf(walletAddress);
      return balance > 0n;
    } catch (error) {
      // Switch to next RPC on failure
      currentRpcIndex++;
      
      if (attempt === maxRetries - 1) {
        console.error(`✗ Failed after ${maxRetries} attempts (all RPCs) for ${walletAddress.substring(0, 10)}...`);
        return false; // Assume no token if we can't check
      }
      
      // Exponential backoff: 500ms, 1s, 2s, 4s...
      const backoffMs = Math.min(500 * Math.pow(2, attempt), 10000);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  return false;
}

// Helper to ask user for confirmation
function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

// Send airdrop - actually transfer tokens to eligible wallets
export async function sendAirdropHandler(argv) {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║              Airdrop Token Sender (LIVE)                 ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`\n⚠️  WARNING: This will send REAL tokens using REAL funds!\n`);
  console.log(`📋 Configuration:`);
  console.log(`   Input CSV: ${argv.input}`);
  console.log(`   Token address: ${argv.tokenAddress}`);
  console.log(`   Dry run: ${argv.dryRun ? 'YES (safe)' : 'NO (LIVE TOKENS WILL BE SENT!)'}`);
  console.log(`   Started: ${new Date().toLocaleString()}\n`);
  
  try {
    // Check private key
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.error(`❌ PRIVATE_KEY not found in .env file!\n`);
      return;
    }
    
    // Read distribution CSV
    if (!fs.existsSync(argv.input)) {
      console.error(`❌ Input file not found: ${argv.input}\n`);
      return;
    }
    
    const csvContent = fs.readFileSync(argv.input, 'utf8');
    const lines = csvContent.split('\n');
    
    if (lines.length < 2) {
      console.error(`❌ Input CSV is empty!\n`);
      return;
    }
    
    // Parse CSV
    const distributions = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const columns = line.split(',');
      const holder = columns[0];
      const amount = columns[1];
      
      if (holder && holder.startsWith('0x') && amount) {
        distributions.push({
          address: holder,
          amount: amount,
        });
      }
    }
    
    console.log(`✓ Loaded ${distributions.length} addresses from CSV\n`);
    
    // Setup wallet and contract
    const rpcUrl = BASE_RPC_URLS[0]; // Use primary RPC
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`💼 Sender Wallet: ${wallet.address}`);
    
    // Get token contract
    const tokenContract = new ethers.Contract(
      argv.tokenAddress,
      [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
      ],
      wallet
    );
    
    // Get token info
    const [decimals, symbol, senderBalance] = await Promise.all([
      tokenContract.decimals(),
      tokenContract.symbol(),
      tokenContract.balanceOf(wallet.address),
    ]);
    
    console.log(`🪙  Token: ${symbol}`);
    console.log(`   Decimals: ${decimals}`);
    console.log(`   Your balance: ${ethers.formatUnits(senderBalance, decimals)} ${symbol}\n`);
    
    // Calculate total needed
    const amountPerWallet = ethers.parseUnits(distributions[0].amount, decimals);
    const totalNeeded = amountPerWallet * BigInt(distributions.length);
    
    console.log(`📊 Airdrop Summary:`);
    console.log(`   Recipients: ${distributions.length}`);
    console.log(`   Amount each: ${distributions[0].amount} ${symbol}`);
    console.log(`   Total needed: ${ethers.formatUnits(totalNeeded, decimals)} ${symbol}`);
    console.log(`   Your balance: ${ethers.formatUnits(senderBalance, decimals)} ${symbol}`);
    
    if (senderBalance < totalNeeded) {
      console.error(`\n❌ Insufficient balance!`);
      console.error(`   Need: ${ethers.formatUnits(totalNeeded, decimals)} ${symbol}`);
      console.error(`   Have: ${ethers.formatUnits(senderBalance, decimals)} ${symbol}`);
      console.error(`   Short: ${ethers.formatUnits(totalNeeded - senderBalance, decimals)} ${symbol}\n`);
      return;
    }
    
    console.log(`   ✓ Sufficient balance\n`);
    
    // Check for progress file
    const progressFile = `.cache/airdrop_progress_${argv.tokenAddress}.json`;
    let sentAddresses = new Set();
    
    if (fs.existsSync(progressFile)) {
      const progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      sentAddresses = new Set(progress.sent || []);
      console.log(`📦 Loaded progress: ${sentAddresses.size} already sent\n`);
    }
    
    const remaining = distributions.filter(d => !sentAddresses.has(d.address));
    
    if (remaining.length === 0) {
      console.log(`✓ All addresses have already been sent to!\n`);
      return;
    }
    
    console.log(`📤 Will send to ${remaining.length} addresses\n`);
    
    // DRY RUN MODE
    if (argv.dryRun) {
      console.log(`🔍 DRY RUN MODE - No tokens will be sent\n`);
      console.log(`First 5 transactions that WOULD be sent:`);
      remaining.slice(0, 5).forEach((dist, i) => {
        console.log(`  ${i + 1}. ${dist.address} → ${dist.amount} ${symbol}`);
      });
      if (remaining.length > 5) {
        console.log(`  ... and ${remaining.length - 5} more`);
      }
      console.log(`\n✓ Dry run complete. Use --no-dry-run to send for real.\n`);
      return;
    }
    
    // LIVE MODE - Ask for confirmation
    console.log(`⚠️  ⚠️  ⚠️  LIVE MODE - REAL TOKENS WILL BE SENT! ⚠️  ⚠️  ⚠️\n`);
    console.log(`This will:`);
    console.log(`  - Send ${distributions[0].amount} ${symbol} to ${remaining.length} addresses`);
    console.log(`  - Use ${ethers.formatUnits(totalNeeded, decimals)} ${symbol} from your wallet`);
    console.log(`  - Cost gas fees (estimated ~${remaining.length * 0.0001} ETH)\n`);
    
    const confirmed = await askConfirmation(`Type 'yes' to confirm and send tokens: `);
    
    if (!confirmed) {
      console.log(`\n❌ Cancelled. No tokens sent.\n`);
      return;
    }
    
    console.log(`\n🚀 Starting airdrop...\n`);
    
    // Send tokens
    let successCount = 0;
    let failCount = 0;
    const failures = [];
    
    for (let i = 0; i < remaining.length; i++) {
      const dist = remaining[i];
      let txSuccess = false;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[${i + 1}/${remaining.length}] Sending to ${dist.address}...`);
          
          const tx = await tokenContract.transfer(dist.address, amountPerWallet);
          console.log(`  ⏳ Transaction sent: ${tx.hash}`);
          
          // Mark as sent immediately to avoid double-sending on retry
          sentAddresses.add(dist.address);
          
          // Wait for confirmation with retry logic
          let receipt = null;
          for (let receiptAttempt = 1; receiptAttempt <= 5; receiptAttempt++) {
            try {
              receipt = await tx.wait(1); // Wait for 1 confirmation
              break;
            } catch (receiptError) {
              if (receiptAttempt === 5) {
                // Give up on confirmation but transaction was sent
                console.log(`  ⚠️  Could not confirm receipt after 5 attempts`);
                console.log(`  ℹ️  Transaction was sent (${tx.hash}) but couldn't verify`);
                console.log(`  ℹ️  Check on BaseScan: https://basescan.org/tx/${tx.hash}`);
                receipt = { blockNumber: 'unknown' }; // Placeholder
                break;
              }
              console.log(`  ⚠️  Receipt polling failed (attempt ${receiptAttempt}/5), retrying...`);
              await new Promise(resolve => setTimeout(resolve, 3000 * receiptAttempt));
            }
          }
          
          if (receipt.blockNumber !== 'unknown') {
            console.log(`  ✓ Confirmed in block ${receipt.blockNumber}`);
          }
          
          successCount++;
          txSuccess = true;
          
          // Save progress every 10 transactions
          if (successCount % 10 === 0) {
            fs.writeFileSync(
              progressFile,
              JSON.stringify({ sent: Array.from(sentAddresses), timestamp: new Date().toISOString() }),
              'utf8'
            );
            console.log(`  💾 Progress saved (${successCount} sent)\n`);
          }
          
          // Small delay between transactions
          await new Promise(resolve => setTimeout(resolve, 2000));
          break; // Success, exit retry loop
          
        } catch (error) {
          if (attempt === 3) {
            failCount++;
            console.error(`  ✗ Failed after 3 attempts: ${error.message}`);
            failures.push({ address: dist.address, error: error.message });
          } else {
            console.log(`  ⚠️  Attempt ${attempt} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
          }
        }
      }
    }
    
    // Save final progress
    fs.writeFileSync(
      progressFile,
      JSON.stringify({ 
        sent: Array.from(sentAddresses), 
        timestamp: new Date().toISOString(),
        complete: failCount === 0
      }),
      'utf8'
    );
    
    // Final summary
    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║                  AIRDROP COMPLETE                        ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝`);
    console.log(`\n📊 Results:`);
    console.log(`   ✓ Successful: ${successCount}`);
    console.log(`   ✗ Failed: ${failCount}`);
    console.log(`   Total sent: ${ethers.formatUnits(amountPerWallet * BigInt(successCount), decimals)} ${symbol}\n`);
    
    if (failures.length > 0) {
      console.log(`❌ Failed addresses:`);
      failures.forEach(f => console.log(`   ${f.address}: ${f.error}`));
      console.log(``);
    }
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    throw error;
  }
}

// Export airdrop list - convert CSV to holders/amounts format
export async function exportAirdropHandler(argv) {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║           Airdrop Distribution List Exporter             ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`\n📋 Configuration:`);
  console.log(`   Input CSV: ${argv.input}`);
  console.log(`   Output: ${argv.output}`);
  console.log(`   Amount per wallet: ${argv.amount}`);
  console.log(`   Started: ${new Date().toLocaleString()}\n`);
  
  try {
    // Read the input CSV
    if (!fs.existsSync(argv.input)) {
      console.error(`\n❌ Input file not found: ${argv.input}`);
      console.error(`   Make sure you've run social-airdrop first!\n`);
      return;
    }
    
    const csvContent = fs.readFileSync(argv.input, 'utf8');
    const lines = csvContent.split('\n');
    
    if (lines.length < 2) {
      console.error(`\n❌ Input CSV is empty or has no data!\n`);
      return;
    }
    
    // Parse CSV (skip header)
    const holders = [];
    let excludedNoAddress = 0;
    let excludedBots = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const columns = line.split(',');
      // Columns: 0=Username, 1=DisplayName, 2=FID, 3=WalletAddress, 4=Reason, 5=FollowerCount
      const fid = parseInt(columns[2]);
      const walletAddress = columns[3];
      const followerCount = parseInt(columns[5]) || 0;
      
      // Filter out likely bots/spam
      if (fid > 1000000 && followerCount < 5) {
        excludedBots++;
        continue;
      }
      
      // Only include wallets that have valid addresses
      if (walletAddress && 
          walletAddress !== 'NO_VERIFIED_ADDRESS' && 
          walletAddress.startsWith('0x') &&
          walletAddress.length === 42) {
        holders.push(walletAddress);
      } else {
        excludedNoAddress++;
      }
    }
    
    console.log(`✓ Parsed ${holders.length} valid wallet addresses from ${lines.length - 1} records`);
    console.log(`   Excluded: ${excludedNoAddress} (no address), ${excludedBots} (bots/spam - FID>1M & followers<5)\n`);
    
    if (holders.length === 0) {
      console.error(`\n❌ No valid wallet addresses found in input CSV!\n`);
      return;
    }
    
    // Generate airdrop CSV
    const airdropCsv = createObjectCsvWriter({
      path: argv.output,
      header: [
        { id: 'holder', title: 'holders' },
        { id: 'amount', title: 'amounts' },
      ],
    });
    
    const airdropData = holders.map(holder => ({
      holder: holder,
      amount: argv.amount,
    }));
    
    await airdropCsv.writeRecords(airdropData);
    
    console.log(`\n✓ Airdrop distribution list created!`);
    console.log(`   File: ${argv.output}`);
    console.log(`   Total wallets: ${holders.length}`);
    console.log(`   Amount per wallet: ${argv.amount}`);
    console.log(`   Total tokens needed: ${holders.length * argv.amount}\n`);
    
    // Show sample
    console.log(`📄 Sample (first 5 entries):`);
    console.log(`holders\tamounts`);
    airdropData.slice(0, 5).forEach(entry => {
      console.log(`${entry.holder}\t${entry.amount}`);
    });
    
    if (holders.length > 5) {
      console.log(`... and ${holders.length - 5} more`);
    }
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    throw error;
  }
}

// Cache utilities
const CACHE_DIR = ".cache";

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCachePath(filename) {
  return path.join(CACHE_DIR, filename);
}

function loadCache(filename) {
  try {
    const cachePath = getCachePath(filename);
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error loading cache ${filename}:`, error.message);
  }
  return null;
}

function saveCache(filename, data) {
  try {
    ensureCacheDir();
    const cachePath = getCachePath(filename);
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
    console.log(`✓ Cached to ${cachePath}`);
  } catch (error) {
    console.error(`Error saving cache ${filename}:`, error.message);
  }
}

// Stage 1: Search ALL casts globally using direct API call (bypassing SDK)
async function fetchAllCasts(apiKey, searchText, useCache = true) {
  const cacheFile = `casts_${searchText.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
  
  // Try to load from cache
  if (useCache) {
    const cached = loadCache(cacheFile);
    if (cached && cached.casts && cached.casts.length > 0) {
      console.log(`\n📦 Loaded ${cached.casts.length} casts from cache`);
      console.log(`   Cached at: ${cached.timestamp}`);
      console.log(`   Use --no-cache to fetch fresh data`);
      return cached.casts;
    }
  }
  
  console.log("\n🔍 Stage 1: Searching ALL casts globally from Farcaster...");
  console.log(`   Search term: "${searchText}"`);
  console.log(`   Method: Global searchCasts API (direct REST call)`);
  console.log(`   This will find EVERY single cast with your search term!\n`);
  
  let allCasts = [];
  let cursor = null;
  let pageCount = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;
  
  do {
    try {
      const baseUrl = 'https://api.neynar.com/v2/farcaster/cast/search/';
      const params = new URLSearchParams({
        q: searchText,
        limit: '100',
        mode: 'literal',
        sort_type: 'desc_chron'
      });
      
      if (cursor) {
        params.append('cursor', cursor);
      }
      
      const fetchResponse = await fetch(`${baseUrl}?${params}`, {
        method: 'GET',
        headers: {
          'api_key': apiKey,
          'accept': 'application/json'
        }
      });
      
      if (!fetchResponse.ok) {
        throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
      }
      
      const response = await fetchResponse.json();
      
      // Results are under response.result.casts, not response.casts!
      const casts = response.result?.casts || response.casts || [];
      
      if (casts.length > 0) {
        allCasts.push(...casts);
        pageCount++;
        console.log(`   Page ${pageCount}: +${casts.length} casts (Total: ${allCasts.length})`);
        
        cursor = response.result?.next?.cursor || response.next?.cursor;
        consecutiveErrors = 0;
        
        // Save progress every 10 pages
        if (pageCount % 10 === 0) {
          saveCache(cacheFile, {
            casts: allCasts,
            timestamp: new Date().toISOString(),
            searchText: searchText,
            pageCount: pageCount,
          });
          console.log(`   ✓ Progress saved (${pageCount} pages, ${allCasts.length} casts)`);
        }
      } else {
        console.log(`   No more results.`);
        break;
      }
      
      // Add delay to avoid rate limiting (1 second between requests)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      consecutiveErrors++;
      console.error(`   ⚠️  Error fetching page ${pageCount + 1}: ${error.message}`);
      if (error.response?.data) {
        console.error(`   Debug - Response:`, JSON.stringify(error.response.data).substring(0, 200));
      }
      
      // Special handling for common errors
      if (error.response) {
        if (error.response.status === 401) {
          console.error(`\n   ❌ Unauthorized (401): Check your NEYNAR_API_KEY in the .env file.\n`);
          break;
        } else if (error.response.status === 429) {
          console.error(`   ⚠️  Rate limit exceeded. Waiting 10 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
          consecutiveErrors--; // Don't count rate limits as errors
          continue;
        }
      }
      
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.log(`   ❌ Too many consecutive errors. Stopping.`);
        break;
      }
      
      // Wait after error
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } while (cursor);
  
  console.log(`\n✓ Found ${allCasts.length} total casts across ${pageCount} pages`);
  
  // Save final cache
  saveCache(cacheFile, {
    casts: allCasts,
    timestamp: new Date().toISOString(),
    searchText: searchText,
    pageCount: pageCount,
    complete: true,
  });
  
  return allCasts;
}

// Stage 2: Extract unique users (deduplicate casts by user - only one cast per user)
function extractUniqueUsers(casts) {
  console.log("\n👥 Stage 2: Extracting unique users...");
  console.log(`   Total casts: ${casts.length}`);
  console.log(`   Deduplicating by user (keeping one cast per user)...`);
  console.log(`   Filtering: FID > 1,000,000 or followers < 5 (likely bots/spam)`);
  
  const usersMap = new Map();
  let duplicateCasts = 0;
  let filteredBots = 0;
  
  for (const cast of casts) {
    if (cast.author && cast.author.username) {
      const fid = cast.author.fid;
      const followerCount = cast.author.follower_count || 0;
      
      // Filter out likely bots/spam accounts
      if (fid > 1000000 && followerCount < 5) {
        filteredBots++;
        continue;
      }
      
      if (!usersMap.has(fid)) {
        usersMap.set(fid, {
          username: cast.author.username,
          fid: fid,
          displayName: cast.author.display_name || cast.author.username,
          verifiedAddresses: cast.author.verified_addresses || {},
          followerCount: followerCount,
          profileImage: cast.author.pfp_url || "",
        });
      } else {
        duplicateCasts++;
      }
    }
  }
  
  const users = Array.from(usersMap.values());
  console.log(`✓ Found ${users.length} unique users`);
  console.log(`   Removed: ${duplicateCasts} duplicate casts, ${filteredBots} likely bots/spam`);
  
  return users;
}

// Stage 3: Check wallet balances with caching
async function checkWalletBalances(users, tokenAddress, useCache = true) {
  console.log("\n💰 Stage 3: Checking wallet token balances...");
  console.log(`   Token address: ${tokenAddress}`);
  
  const balanceCacheFile = `balances_${tokenAddress}.json`;
  let balanceCache = {};
  
  // Load existing balance cache
  if (useCache) {
    const cached = loadCache(balanceCacheFile);
    if (cached) {
      balanceCache = cached.balances || {};
      console.log(`   Loaded ${Object.keys(balanceCache).length} cached balance checks`);
    }
  }
  
  const results = [];
  let checkedCount = 0;
  let cacheHits = 0;
  let newChecks = 0;
  let eligibleCount = 0;
  
  for (const user of users) {
    checkedCount++;
    
    if (checkedCount % 25 === 0) {
      console.log(`   Progress: ${checkedCount}/${users.length} users (${Math.round(checkedCount/users.length*100)}%)`);
      // Save progress
      saveCache(balanceCacheFile, {
        balances: balanceCache,
        timestamp: new Date().toISOString(),
        tokenAddress: tokenAddress,
      });
    }
    
    const ethAddresses = user.verifiedAddresses.eth_addresses || [];
    
    if (ethAddresses.length === 0) {
      // No verified address
      results.push({
        ...user,
        walletAddress: "NO_VERIFIED_ADDRESS",
        hasToken: false,
        reason: "NO_ADDRESS",
      });
      eligibleCount++;
      continue;
    }
    
    // Check each verified address
    let hasToken = false;
    let checkedAddress = ethAddresses[0];
    
    for (const address of ethAddresses) {
      // Check cache first
      const cacheKey = `${address.toLowerCase()}_${tokenAddress.toLowerCase()}`;
      
      if (balanceCache[cacheKey] !== undefined) {
        hasToken = balanceCache[cacheKey];
        cacheHits++;
      } else {
        // Check on-chain
        const hasBalance = await hasElizaOSToken(address, tokenAddress);
        balanceCache[cacheKey] = hasBalance;
        hasToken = hasBalance;
        newChecks++;
        
        // Add longer delay to avoid rate limiting (1 second between checks)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (hasToken) {
        checkedAddress = address;
        break;
      }
    }
    
    if (!hasToken) {
      // User doesn't have the token - eligible for airdrop
      results.push({
        ...user,
        walletAddress: checkedAddress,
        hasToken: false,
        reason: "NO_TOKEN",
      });
      eligibleCount++;
    }
  }
  
  // Save final balance cache
  saveCache(balanceCacheFile, {
    balances: balanceCache,
    timestamp: new Date().toISOString(),
    tokenAddress: tokenAddress,
    totalChecks: Object.keys(balanceCache).length,
  });
  
  console.log(`\n✓ Balance check complete:`);
  console.log(`   - Total users checked: ${checkedCount}`);
  console.log(`   - Cache hits: ${cacheHits}`);
  console.log(`   - New checks: ${newChecks}`);
  console.log(`   - Eligible users (no token): ${eligibleCount}`);
  
  return results;
}

// Stage 4: Generate CSV
async function generateCSV(eligibleUsers, outputPath) {
  console.log("\n📄 Stage 4: Generating CSV...");
  
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "username", title: "Username" },
      { id: "displayName", title: "Display Name" },
      { id: "fid", title: "FID" },
      { id: "walletAddress", title: "Wallet Address" },
      { id: "reason", title: "Reason" },
      { id: "followerCount", title: "Follower Count" },
    ],
  });
  
  const csvData = eligibleUsers.map(user => ({
    username: user.username,
    displayName: user.displayName,
    fid: user.fid,
    walletAddress: user.walletAddress,
    reason: user.reason,
    followerCount: user.followerCount,
  }));
  
  await csvWriter.writeRecords(csvData);
  console.log(`✓ CSV file created: ${outputPath}`);
  console.log(`   Total records: ${csvData.length}`);
  
  return csvData.length;
}

// Main handler for social airdrop search with caching and stages
export async function elizaOSAirdropHandler(argv) {
  // Determine search text: use searchText if provided, otherwise use $ticker format
  const searchText = argv.searchText || `$${argv.ticker}`;
  
  // Auto-generate output filename if not specified
  const outputFile = argv.output || `${argv.ticker.toLowerCase()}_airdrop_eligible.csv`;
  
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║            Social Airdrop Eligibility Finder             ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`\n📋 Configuration:`);
  console.log(`   Ticker: "${argv.ticker}"`);
  console.log(`   Search text: "${searchText}"`);
  console.log(`   Token address: ${argv.tokenAddress}`);
  console.log(`   Output file: ${outputFile}`);
  console.log(`   Cache enabled: ${!argv.noCache}`);
  console.log(`   Started: ${new Date().toLocaleString()}`);
  
  try {
    const apiKey = process.env.NEYNAR_API_KEY;
    if (!apiKey) {
      console.error("\n❌ NEYNAR_API_KEY not found in environment variables!");
      console.error("   Make sure you have a .env file with NEYNAR_API_KEY=your_key\n");
      return;
    }
    
    console.log(`   API Key: ${apiKey.substring(0, 10)}... (${apiKey.length} chars)`);
    
    const client = getClient(apiKey);
    const useCache = !argv.noCache;
    
    // Stage 1: Fetch all casts (pass API key directly for REST calls)
    const allCasts = await fetchAllCasts(apiKey, searchText, useCache);
    
    if (allCasts.length === 0) {
      console.log("\n⚠️  No casts found. Try a different search term.");
      return;
    }
    
    // Stage 2: Extract unique users
    const uniqueUsers = extractUniqueUsers(allCasts);
    
    if (uniqueUsers.length === 0) {
      console.log("\n⚠️  No users found in casts.");
      return;
    }
    
    // Stage 3: Check wallet balances
    const eligibleUsers = await checkWalletBalances(uniqueUsers, argv.tokenAddress, useCache);
    
    if (eligibleUsers.length === 0) {
      console.log("\n⚠️  All users already have the token!");
      return;
    }
    
    // Stage 4: Generate CSV
    const recordCount = await generateCSV(eligibleUsers, outputFile);
    
    // Final summary
    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║                    ✓ COMPLETE                             ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log(`\n📊 Summary:`);
    console.log(`   - Total casts found: ${allCasts.length}`);
    console.log(`   - Unique users: ${uniqueUsers.length}`);
    console.log(`   - Eligible for airdrop: ${eligibleUsers.length}`);
    console.log(`   - CSV records: ${recordCount}`);
    console.log(`\n📁 Output: ${outputFile}`);
    console.log(`\n💡 Tip: Run again to use cached data and save time!`);
    console.log(`   Cache location: ${CACHE_DIR}/`);
    console.log(`\n🔧 To search for a different token:`);
    console.log(`   node src/index.js social-airdrop --ticker="DEGEN" --tokenAddress="0x..."`);
  
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error("\nStack trace:", error.stack);
    throw error;
  }
}
