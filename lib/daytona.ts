import { Daytona } from "@daytonaio/sdk";

let client: Daytona | null = null;

/**
 * Singleton Daytona client.
 * Explicitly passes config to avoid JWT/org-id detection issues.
 */
export function getDaytona(): Daytona {
  if (!client) {
    client = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
      apiUrl: process.env.DAYTONA_API_URL,
      target: process.env.DAYTONA_TARGET || "us",
    });
  }
  return client;
}
