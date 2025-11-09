import { getClient } from "./client.js";
import { ethers } from "ethers";
import { createObjectCsvWriter } from "csv-writer";
import fs from "fs";
import path from "path";

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

// Search for casts containing specific text (helper function - not currently used)
async function searchCastsWithText({ apiKey, searchText, limit = 100 }) {
  const client = getClient(apiKey);
  
  try {
    const result = await client.searchCasts({
      q: searchText,
      limit: limit,
    });
    return result.casts || [];
  } catch (error) {
    console.error("Error searching casts:", error.message);
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
  
  const usersMap = new Map();
  let duplicateCasts = 0;
  
  for (const cast of casts) {
    if (cast.author && cast.author.username) {
      const fid = cast.author.fid;
      
      if (!usersMap.has(fid)) {
        usersMap.set(fid, {
          username: cast.author.username,
          fid: fid,
          displayName: cast.author.display_name || cast.author.username,
          verifiedAddresses: cast.author.verified_addresses || {},
          followerCount: cast.author.follower_count || 0,
          profileImage: cast.author.pfp_url || "",
        });
      } else {
        duplicateCasts++;
      }
    }
  }
  
  const users = Array.from(usersMap.values());
  console.log(`✓ Found ${users.length} unique users (removed ${duplicateCasts} duplicate casts)`);
  
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
