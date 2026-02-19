import RoomWrapper from "@/components/RoomWrapper";

// This is a Server Component. It handles the URL parameters safely.
export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;

  return <RoomWrapper roomId={roomId} />;
}