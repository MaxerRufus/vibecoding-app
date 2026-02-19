"use client"; // <--- CRITICAL: This allows hooks like useState
import { RoomProvider } from "@/liveblocks.config";
import { ClientSideSuspense } from "@liveblocks/react";
import Workspace from "@/components/Workspace";
import { Loader2 } from "lucide-react";

export default function RoomWrapper({ roomId }: { roomId: string }) {
  return (
    <RoomProvider id={`room-${roomId}`} initialPresence={{ role: "Viewer" }}>
      <ClientSideSuspense fallback={
        <div className="h-screen bg-[#0d1117] flex items-center justify-center text-white">
          <Loader2 className="animate-spin" size={48}/>
        </div>
      }>
        {() => <Workspace roomId={roomId} />}
      </ClientSideSuspense>
    </RoomProvider>
  );
}