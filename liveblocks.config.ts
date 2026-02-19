"use client";
import { createClient } from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";

const client = createClient({
  publicApiKey: process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY!,
});

// 1. Define what "Presence" looks like (This fixes the 'role' error)
type Presence = {
  role?: string; // <--- We explicitly add this!
  cursor?: { x: number; y: number } | null;
};

// 2. Pass the type to the context
export const {
  RoomProvider,
  useMyPresence,
  useStorage,
  useMutation,
  useOthers,
  useSelf,
} = createRoomContext<Presence>(client); // <--- Note the <Presence> generic here