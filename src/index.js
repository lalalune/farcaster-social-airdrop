import "dotenv/config";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { fetchCastsHandler, elizaOSAirdropHandler } from "./commands.js";

yargs(hideBin(process.argv))
  .version(false)
  .command({
    command: "fetch",
    describe: "Fetch Imgur URLs from Neynar API based on criteria",
    builder: {
      channelId: {
        default: "memes",
        describe: "Channel ID",
        type: "string",
      },
      likeThreshold: {
        default: 30,
        describe: "Like threshold",
        type: "number",
      },
      recastThreshold: {
        default: 15,
        describe: "Recast threshold",
        type: "number",
      },
      followerCountThreshold: {
        default: 20,
        describe: "Follower count threshold",
        type: "number",
      },
      limit: {
        default: 100,
        describe: "Fetch limit",
        type: "number",
        coerce: (limit) => Math.min(limit, 100),
      },
      urlDomainFilter: {
        default: "imgur.com",
        describe: "URL domain filter",
        type: "string",
      },
      maxResults: {
        describe: "Maximum number of results to fetch",
        type: "number",
      },
      maxQueries: {
        describe: "Maximum number of queries to make",
        type: "number",
      },
    },
    handler: fetchCastsHandler,
  })
  .command({
    command: "social-airdrop",
    describe: "Find users who posted about a token and check if they have it",
    builder: {
      ticker: {
        default: "elizaOS",
        describe: "Token ticker/symbol to search for (e.g., 'elizaOS', 'DEGEN', 'HIGHER')",
        type: "string",
      },
      searchText: {
        describe: "Custom search text (overrides ticker). Use for exact phrases.",
        type: "string",
      },
      tokenAddress: {
        default: "0xea17df5cf6d172224892b5477a16acb111182478",
        describe: "Token contract address on Base chain",
        type: "string",
      },
      output: {
        describe: "Output CSV filename (auto-generated if not specified)",
        type: "string",
      },
      noCache: {
        default: false,
        describe: "Disable caching and fetch fresh data",
        type: "boolean",
      },
    },
    handler: elizaOSAirdropHandler,
  })
  .demandCommand(1, "You must provide at least one command to execute")
  .help().argv;
