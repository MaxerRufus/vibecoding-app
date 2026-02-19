"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { Trash2, Plus, LogOut, Code2, FolderGit2, Loader2 } from "lucide-react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Dashboard() {
  const [projects, setProjects] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/"); // Kick back to login if no user
      } else {
        setUser(user);
        fetchProjects(user.id);
      }
    };
    checkUser();
  }, [router]);

  const fetchProjects = async (userId: string) => {
    try {
      // Get projects owned by me
      const { data: owned } = await supabase.from("projects").select("*").eq("owner_id", userId).order('created_at', { ascending: false });
      
      // Get projects shared with me
      const { data: shared } = await supabase.from("project_members").select("project:projects(*)");
      
      // Merge lists
      const sharedProjects = shared?.map((row: any) => row.project) || [];
      const allProjects = [...(owned || []), ...sharedProjects];
      
      // Remove duplicates (in case I am both owner and member)
      const uniqueProjects = Array.from(new Set(allProjects.map(p => p.id)))
        .map(id => allProjects.find(p => p.id === id));

      setProjects(uniqueProjects);
    } catch (error) {
      console.error("Error fetching projects:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newProjectName) return;
    
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: newProjectName, owner_id: user.id })
      .select()
      .single();

    if (error) {
      alert("Error creating project: " + error.message);
    } else if (data) {
      router.push(`/room/${data.id}`);
    }
  };

  const handleDelete = async (projectId: string) => {
    if (!confirm("Are you sure? This deletes all code forever.")) return;
    await supabase.from("projects").delete().eq("id", projectId);
    fetchProjects(user.id);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-white">
        <Loader2 className="animate-spin mr-2" /> Loading Dashboard...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-300 font-mono">
      {/* NAVBAR */}
      <nav className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-[#161b22]">
        <div className="flex items-center gap-2 text-xl font-bold text-white">
          <Code2 className="text-blue-500" /> Vibecoding_
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500 hidden sm:block">{user?.email}</span>
          <button onClick={handleSignOut} className="text-xs bg-gray-800 hover:bg-red-900/50 hover:text-red-400 px-3 py-2 rounded flex items-center gap-2 transition-all">
            <LogOut size={14}/> Sign Out
          </button>
        </div>
      </nav>

      {/* CONTENT */}
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Your Projects</h1>
            <p className="text-gray-500 text-sm">Manage your collaborative workspaces.</p>
          </div>
          <button 
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-blue-900/20"
          >
            <Plus size={18} /> New Project
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.length === 0 && (
            <div className="col-span-full text-center py-20 text-gray-600 border-2 border-dashed border-gray-800 rounded-xl bg-[#161b22]/50">
              <FolderGit2 className="mx-auto mb-4 opacity-50" size={48} />
              <p>No projects yet.</p>
              <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:underline mt-2">Create one to start vibing!</button>
            </div>
          )}

          {projects.map((p) => (
            <div key={p.id} className="bg-[#161b22] border border-gray-800 rounded-xl p-6 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-900/10 transition-all group relative flex flex-col justify-between h-40">
              <div 
                onClick={() => router.push(`/room/${p.id}`)}
                className="cursor-pointer flex-1"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="p-2 bg-blue-900/20 rounded-lg text-blue-400">
                    <FolderGit2 size={20} />
                  </div>
                </div>
                <h3 className="font-bold text-lg text-white mb-1 group-hover:text-blue-400 transition-colors truncate">{p.name}</h3>
                <p className="text-xs text-gray-500">
                  {p.owner_id === user.id ? "Owner" : "Collaborator"}
                </p>
              </div>

              {p.owner_id === user.id && (
                <div className="absolute top-4 right-4">
                   <button 
                     onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                     className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-[#161b22] rounded"
                     title="Delete Project"
                   >
                     <Trash2 size={16} />
                   </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#161b22] border border-gray-700 p-6 rounded-xl w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Initialize Project</h2>
            <input 
              autoFocus
              className="w-full bg-[#0d1117] border border-gray-700 rounded p-3 text-white focus:border-blue-500 outline-none mb-4"
              placeholder="Project Name..."
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-500 transition-colors">Launch</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}