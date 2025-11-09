import { NeynarAPIClient, Configuration } from "@neynar/nodejs-sdk";

export const getClient = (apiKey) => {
  const config = new Configuration({
    apiKey: apiKey,
    baseOptions: {
      headers: {
        "api_key": apiKey,
        "x-neynar-experimental": "true",
      },
    },
  });
  return new NeynarAPIClient(config);
};
