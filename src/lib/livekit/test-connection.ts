import "server-only";

import { RoomServiceClient } from "livekit-server-sdk";

import type { DecryptedLivekitConfig } from "./account-config";

export async function testLivekitConnection(
  config: DecryptedLivekitConfig,
): Promise<void> {
  const client = new RoomServiceClient(
    config.livekitHttpUrl,
    config.apiKey,
    config.apiSecret,
  );
  await client.listRooms();
}
