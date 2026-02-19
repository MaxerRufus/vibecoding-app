import React from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the RoomWrapper/Workspace so it NEVER runs on the server
const RoomWrapper = dynamic(() => import('@/components/RoomWrapper'), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0d1117] text-white font-mono">
      Loading Workspace...
    </div>
  )
});

export default async function RoomPage({ params }: { params: { roomId: string } }) {
  const { roomId } = await params;

  return <RoomWrapper roomId={roomId} />;
}