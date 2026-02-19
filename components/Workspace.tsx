"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Editor from "@monaco-editor/react";
import { Tldraw, useEditor } from "tldraw";
import "tldraw/tldraw.css";
import { createClient } from "@supabase/supabase-js";
import { 
  Play, Loader2, Code, Eye, MonitorPlay, ArrowLeft, 
  Settings, UserPlus, ShieldAlert, Lock, Unlock, X, 
  FileText, Wand2, Wifi, RefreshCw, Terminal as TerminalIcon, 
  Download, Zap, Users, Eraser, Plus, MessageSquare, Sparkles
} from "lucide-react";
import { useRouter } from "next/navigation";
import { debounce } from "lodash";
import JSZip from "jszip"; 

// --- CONFIG ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const AI_PROVIDERS = [
  { id: "openai", name: "ChatGPT (GPT-4o)" },
  { id: "gemini", name: "Google Gemini 1.5" },
  { id: "nvidia", name: "NVIDIA NIM" },
  { id: "groq",   name: "Groq (Llama 3)" },
];

const PERMISSION_INFO: any = {
  "Leader": { can: ["Everything", "Manage Roles", "Unlock Files"], color: "text-yellow-400" },
  "Frontend": { can: ["HTML", "CSS", "React", "UI"], color: "text-blue-400" },
  "Backend": { can: ["Node", "SQL", "API", "Python", "C"], color: "text-purple-400" },
  "Viewer": { can: ["Read Only"], color: "text-gray-400" }
};

type File = { id: string; path: string; content: string; language: string; locked_by: string | null; };
type Member = { id: string; email: string; role: string; is_owner?: boolean; };

// --- REAL-TIME WHITEBOARD SYNC HELPER ---
function WhiteboardSync({ roomId }: { roomId: string }) {
  const editor = useEditor();
  const isRemoteUpdate = useRef(false);

  useEffect(() => {
    if (!editor) return;
    const cleanup = editor.store.listen((update) => {
      if (isRemoteUpdate.current) return;
      if (update.source === 'user') {
        supabase.channel(`room-${roomId}-board`).send({ type: 'broadcast', event: 'board-change', payload: update.changes });
      }
    }, { scope: 'document' });

    const channel = supabase.channel(`room-${roomId}-board`)
      .on('broadcast', { event: 'board-change' }, ({ payload }) => {
        isRemoteUpdate.current = true;
        editor.store.mergeRemoteChanges(() => {
          const { added, updated, removed } = payload;
          if (added) Object.values(added).forEach((r: any) => editor.store.put([r]));
          if (updated) Object.values(updated).forEach((r: any) => editor.store.put([r.to]));
          if (removed) Object.values(removed).forEach((r: any) => editor.store.remove([r.id]));
        });
        isRemoteUpdate.current = false;
      })
      .on('broadcast', { event: 'board-clear' }, () => {
        editor.selectAll().deleteShapes(editor.getSelectedShapeIds());
      })
      .subscribe();

    return () => { cleanup(); supabase.removeChannel(channel); };
  }, [editor, roomId]);

  return null;
}

export default function Workspace({ roomId }: { roomId: string }) {
  const router = useRouter();
  
  // --- STATE ---
  const [activeTab, setActiveTab] = useState<"code" | "board" | "ai">("code");
  const [showPreview, setShowPreview] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  
  const [files, setFiles] = useState<File[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [myRole, setMyRole] = useState("Viewer");
  
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiOutput, setAiOutput] = useState("AI Ready.");
  
  const [aiMessage, setAiMessage] = useState("Welcome to Vibecoding! Run the Architect to see AI summaries here.");
  const [globalMode, setGlobalMode] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");
  
  const [terminalLogs, setTerminalLogs] = useState<string[]>(["> System Ready..."]);
  const [previewUrl, setPreviewUrl] = useState<string>(""); 
  const [isRunning, setIsRunning] = useState(false);

  // --- REFS ---
  const isTypingRef = useRef(false);
  const pyodideRef = useRef<any>(null);
  const editorRef = useRef<any>(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUser(data.user);
      if (data.user) fetchProjectDetails(data.user.id);
    });
    
    const savedKey = localStorage.getItem("vibecoding_api_key");
    if (savedKey) setApiKey(savedKey);

    fetchFiles();
    loadPyodide();

    const channel = supabase.channel(`room-${roomId}-code`)
      .on('broadcast', { event: 'code-update' }, ({ payload }) => {
        if (activeFileId === payload.fileId && isTypingRef.current) return;
        setFiles(prev => prev.map(f => f.id === payload.fileId ? { ...f, content: payload.content } : f));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'files', filter: `project_id=eq.${roomId}` }, (payload) => {
        if (payload.eventType === "UPDATE") {
           setFiles(prev => prev.map(f => {
             if (f.id === payload.new.id) {
               const lockChanged = f.locked_by !== payload.new.locked_by;
               if (lockChanged || !isTypingRef.current) return { ...f, ...payload.new };
             }
             return f;
           }));
        } else { fetchFiles(); }
      })
      .subscribe((status) => setConnectionStatus(status === 'SUBSCRIBED' ? 'Live' : 'Offline'));

    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  const loadPyodide = async () => {
    try {
      // @ts-ignore
      if (!window.loadPyodide) {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js";
        script.onload = async () => {
           // @ts-ignore
           pyodideRef.current = await window.loadPyodide();
           await pyodideRef.current.loadPackage("micropip");
        };
        document.body.appendChild(script);
      }
    } catch (e) { console.error(e); }
  };

  const fetchProjectDetails = async (userId: string) => {
    const { data: project } = await supabase.from("projects").select("owner_id").eq("id", roomId).single();
    const isOwner = project?.owner_id === userId;
    
    if (isOwner) setMyRole("Leader");
    else {
      const { data: member } = await supabase.from("project_members").select("role").eq("project_id", roomId).eq("user_id", userId).single();
      setMyRole(member?.role || "Viewer");
    }

    const { data: membersData } = await supabase.from("project_members").select("role, user:profiles(id, email, full_name)").eq("project_id", roomId);
    const team: Member[] = [];
    if (isOwner) team.push({ id: userId, email: currentUser?.email || "Owner", role: "Leader", is_owner: true });
    
    if (membersData) {
      membersData.forEach((m: any) => { if (m.user) team.push({ id: m.user.id, email: m.user.email, role: m.role }); });
    }
    setMembers(team);
  };

  const fetchFiles = async () => {
    const { data } = await supabase.from("files").select("*").eq("project_id", roomId).order("path");
    if (data && data.length > 0) {
      setFiles(data);
      if (!activeFileId) setActiveFileId(data[0].id);
    } else {
      const defaults = [
        { project_id: roomId, path: "README.md", content: "# New Project\nWelcome to Vibecoding!", language: "markdown" },
        { project_id: roomId, path: "main.py", content: "print('Hello World')", language: "python" },
        { project_id: roomId, path: "index.html", content: "<h1>Hello World</h1>\n<script src='./script.js'></script>", language: "html" },
        { project_id: roomId, path: "script.js", content: "console.log('Ready');", language: "javascript" }
      ];
      if (data?.length === 0) { await supabase.from("files").insert(defaults); fetchFiles(); }
    }
  };

  // --- ACTIONS & FORMATTING ---
  const handleAddFile = async () => {
    if (myRole === "Viewer") return alert("Viewers cannot create files.");
    
    const fileName = window.prompt("Enter file name (e.g., script.js, README.md, data.csv):", "new_file.js");
    if (!fileName) return;
    
    if (files.some(f => f.path === fileName)) return alert("A file with this name already exists.");

    const ext = fileName.split('.').pop() || "";
    const langMap: any = { 'py': 'python', 'js': 'javascript', 'html': 'html', 'css': 'css', 'c': 'c', 'md': 'markdown' };
    
    const newFile = {
      project_id: roomId,
      path: fileName,
      content: fileName.endsWith('.md') ? `# ${fileName}` : "",
      language: langMap[ext] || "text"
    };

    const { data, error } = await supabase.from("files").insert([newFile]).select().single();
    if (!error && data) {
      setFiles([...files, data]);
      setActiveFileId(data.id);
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
  };

  const handleFormatCode = () => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
    }
  };

  const handleEditorChange = (newContent: string | undefined) => {
    if (newContent === undefined || !activeFileId) return;
    const file = files.find(f => f.id === activeFileId);
    if (file?.locked_by && file.locked_by !== currentUser?.id && myRole !== "Leader") return;

    isTypingRef.current = true;
    setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, content: newContent } : f));
    supabase.channel(`room-${roomId}-code`).send({ type: 'broadcast', event: 'code-update', payload: { fileId: activeFileId, content: newContent } });
    
    const save = debounce(async () => {
       await supabase.from("files").update({ content: newContent }).eq("id", activeFileId);
       isTypingRef.current = false;
    }, 1000);
    save();
  };

  const toggleLock = async (file: File) => {
    const isLocked = !!file.locked_by;
    if (isLocked && file.locked_by !== currentUser?.id && myRole !== "Leader") return alert("Unauthorized.");
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, locked_by: isLocked ? null : currentUser?.id } : f));
    await supabase.from("files").update({ locked_by: isLocked ? null : currentUser?.id }).eq("id", file.id);
  };

  const handleUpdateRole = async (memberId: string, newRole: string) => {
    if (myRole !== "Leader") return alert("Only Leader can change roles.");
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m));
    await supabase.from("project_members").update({ role: newRole }).eq("project_id", roomId).eq("user_id", memberId);
  };

  // --- PREVIEW (VIRTUAL SERVER) ---
  useEffect(() => {
    if (files.length === 0) return;
    const blobMap: Record<string, string> = {};
    files.forEach(file => {
      let mime = 'text/plain';
      if (file.path.endsWith('.html')) mime = 'text/html';
      if (file.path.endsWith('.css')) mime = 'text/css';
      if (file.path.endsWith('.js')) mime = 'application/javascript';
      blobMap[file.path] = URL.createObjectURL(new Blob([file.content], { type: mime }));
    });

    const indexFile = files.find(f => f.path === 'index.html');
    if (indexFile) {
      let html = indexFile.content;
      files.forEach(f => {
         const regex = new RegExp(`(src|href)=['"](\\./)?${f.path}['"]`, 'g');
         html = html.replace(regex, `$1="${blobMap[f.path]}"`);
      });
      setPreviewUrl(URL.createObjectURL(new Blob([html], { type: 'text/html' })));
    } else {
      setPreviewUrl("");
    }
  }, [files]);

  // --- RUNNER (PYTHON/C/JS) ---
  const runCode = async () => {
    const file = files.find(f => f.id === activeFileId);
    if (!file) return;
    setShowTerminal(true);
    setIsRunning(true);
    setTerminalLogs(prev => [...prev, `> Executing ${file.path}...`]);

    if (file.language === "python") {
      try {
        if (!pyodideRef.current) throw new Error("Pyodide loading... please wait.");
        pyodideRef.current.setStdout({ batched: (msg: string) => setTerminalLogs(prev => [...prev, msg]) });
        
        files.forEach(f => {
             pyodideRef.current.FS.writeFile(f.path, f.content);
        });

        const patchInput = `
import sys
def input(prompt=""):
    print(f"{prompt}[Input not supported in Web Terminal]")
    return ""
__builtins__.input = input
`;
        await pyodideRef.current.runPythonAsync(patchInput);
        
        const imports = file.content.match(/^(?:from|import)\s+([a-zA-Z0-9_]+)/gm);
        if (imports) {
           const uniquePkgs = new Set(imports.map(i => i.split(/\s+/)[1]));
           for (const pkg of Array.from(uniquePkgs)) {
             if (['numpy', 'pandas', 'scipy', 'matplotlib'].includes(pkg as string)) {
                setTerminalLogs(prev => [...prev, `> Installing ${pkg}...`]);
                await pyodideRef.current.loadPackage(pkg);
             }
           }
        }

        await pyodideRef.current.runPythonAsync(file.content);
        setTerminalLogs(prev => [...prev, "> Execution Finished."]);
      } catch (e: any) { 
        const cleanError = e.message.split("File \"<exec>\"").pop() || e.message;
        setTerminalLogs(prev => [...prev, `Error: ${cleanError}`]); 
      }
    } 
    else if (file.language === "c" || file.language === "cpp") {
      try {
        setTerminalLogs(prev => [...prev, "> Compiling C via Piston API..."]);
        const cFiles = files.filter(f => f.language === "c" || f.language === "cpp" || f.path.endsWith(".h"));
        
        const res = await fetch("https://emkc.org/api/v2/piston/execute", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: "c", version: "10.2.0", files: cFiles.map(f => ({ name: f.path, content: f.content })), main: file.path })
        });
        const data = await res.json();
        
        if (data.run) {
           if (data.run.stdout) setTerminalLogs(prev => [...prev, data.run.stdout]);
           if (data.run.stderr) setTerminalLogs(prev => [...prev, `Stderr: ${data.run.stderr}`]);
           setTerminalLogs(prev => [...prev, `> Exit Code: ${data.run.code}`]);
        }
      } catch (e: any) { setTerminalLogs(prev => [...prev, `API Error: ${e.message}`]); }
    }
    else if (file.language === "javascript") {
       try {
         const logs: string[] = [];
         const originalLog = console.log;
         console.log = (...args) => logs.push(args.join(" "));
         // eslint-disable-next-line no-eval
         eval(file.content);
         console.log = originalLog;
         setTerminalLogs(prev => [...prev, ...logs, "> Done."]);
       } catch (e: any) { setTerminalLogs(prev => [...prev, `Error: ${e.message}`]); }
    }
    else { setTerminalLogs(prev => [...prev, "> Language not supported for local execution."]); }
    
    setIsRunning(false);
  };

  // --- REAL-TIME AI STREAMING ---
  const handleAiGenerate = async () => {
    if (!apiKey) return alert("API Key Missing");
    setIsProcessing(true);
    setAiOutput("Connecting to AI...");
    
    setActiveTab("code"); 
    setAiMessage("Architect is thinking...");

    try {
      const res = await fetch("/api/architect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: roomId, userId: currentUser?.id, prompt, currentFileTree: files, activeFileId, mode: globalMode ? "global" : "focus", apiKey, provider })
      });

      if (!res.ok) throw new Error(await res.text());

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let streamText = "";
      setAiOutput("Generating real-time...");

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        
        streamText += decoder.decode(value, { stream: true });

        const msgMatch = streamText.match(/<message>([\s\S]*?)(?:<\/message>|$)/);
        if (msgMatch) setAiMessage(msgMatch[1].trim());

        const fileBlocks = streamText.split('<file path="');
        
        setFiles(prev => {
            let newFiles = [...prev];
            for (let i = 1; i < fileBlocks.length; i++) {
                const block = fileBlocks[i];
                const pathEnd = block.indexOf('">');
                if (pathEnd === -1) continue;
                
                const path = block.substring(0, pathEnd);
                let content = block.substring(pathEnd + 2);
                
                const endTag = content.indexOf('</file>');
                if (endTag !== -1) content = content.substring(0, endTag);
                
                content = content.replace(/^\n/, ''); 

                const fileIndex = newFiles.findIndex(f => f.path === path);
                if (fileIndex !== -1) {
                    newFiles[fileIndex] = { ...newFiles[fileIndex], content };
                }
            }
            return newFiles;
        });
      }

      setAiOutput("Done!");
      setPrompt("");
      setGlobalMode(false);
      
      // Auto-format after AI finishes
      setTimeout(() => {
        handleFormatCode();
        fetchFiles();
      }, 1500); 

    } catch (e: any) { 
      setAiOutput("Error"); 
      setAiMessage(`System Error: ${e.message}`);
    } finally { setIsProcessing(false); }
  };

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setIsInviting(true);
    try {
      await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail, projectId: roomId, role: "Viewer", url: window.location.href }) });
      alert("Invite Sent!"); setShowTeamModal(false); setInviteEmail("");
    } catch (e) { alert("Network Error"); }
    setIsInviting(false);
  };

  const activeFile = files.find(f => f.id === activeFileId);
  const isReadOnly = !!activeFile?.locked_by && activeFile?.locked_by !== currentUser?.id && myRole !== "Leader";

  return (
    <div className="h-screen flex bg-[#0d1117] text-gray-300 font-mono overflow-hidden">
      
      {/* SIDEBAR */}
      <div className="w-64 flex flex-col border-r border-gray-800 bg-[#161b22] shrink-0">
        <div className="h-14 border-b border-gray-800 flex items-center px-4 gap-3 bg-[#0d1117]">
          <button onClick={() => router.push("/dashboard")} className="text-gray-500 hover:text-white"><ArrowLeft size={18}/></button>
          <div>
            <span className="font-bold text-sm text-white block">Vibecoding</span>
            <span className={`text-[10px] ${connectionStatus==='Live'?'text-green-500':'text-red-500'}`}>{connectionStatus}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
           <div className="flex items-center justify-between px-2 mb-2 mt-2">
             <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Explorer</h3>
             <button onClick={handleAddFile} className="text-gray-400 hover:text-white" title="New File"><Plus size={14}/></button>
           </div>
           
           {files.map(file => (
             <div key={file.id} onClick={() => setActiveFileId(file.id)} className={`group flex items-center justify-between px-3 py-2 rounded-md mb-1 cursor-pointer transition-all ${activeFileId === file.id ? "bg-blue-900/30 text-white border border-blue-900/50" : "hover:bg-gray-800 text-gray-400"}`}>
               <div className="flex items-center gap-2 truncate">
                 <FileText size={14} className={file.path.endsWith('html') ? "text-orange-500" : file.path.endsWith('css') ? "text-blue-400" : file.path.endsWith('py') ? "text-yellow-400" : file.path.endsWith('md') ? "text-gray-300" : "text-gray-500"}/>
                 <span className="text-xs truncate">{file.path}</span>
               </div>
               <button onClick={(e) => { e.stopPropagation(); toggleLock(file); }} className={file.locked_by ? "text-red-500" : "text-gray-600 opacity-0 group-hover:opacity-100 hover:text-white"}>
                  {file.locked_by ? <Lock size={12}/> : <Unlock size={12}/>}
               </button>
             </div>
           ))}
        </div>

        <div className="p-3 border-t border-gray-800 space-y-2 bg-[#0d1117]">
           {myRole === "Leader" && (
             <button onClick={() => { setGlobalMode(!globalMode); setPrompt(globalMode ? "" : "Refactor entire project to..."); }} className={`w-full flex items-center justify-center gap-2 text-xs py-2 rounded font-bold border ${globalMode ? "bg-red-900/50 text-white border-red-500 animate-pulse" : "bg-gray-800 text-yellow-500 border-gray-700 hover:text-yellow-400"}`}>
               <Wand2 size={14}/> {globalMode ? "Global Mode" : "Refactor All"}
             </button>
           )}
           <button onClick={() => setShowTeamModal(true)} className="w-full flex items-center justify-center gap-2 text-xs bg-gray-800 hover:bg-gray-700 py-2 rounded text-blue-400 border border-gray-700 font-bold"><Users size={14}/> Team & Roles</button>
           <button onClick={() => setShowSettings(!showSettings)} className="w-full flex items-center justify-center gap-2 text-xs bg-gray-800 hover:bg-gray-700 py-2 rounded text-gray-400 border border-gray-700"><Settings size={14}/> Settings</button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col relative min-w-0">
        
        <div className="h-14 border-b border-gray-800 flex items-center justify-between px-4 bg-[#161b22]">
           <div className="flex bg-gray-800/50 rounded p-1 border border-gray-700/50">
              <button onClick={() => setActiveTab("code")} className={`px-4 py-1.5 rounded text-xs font-bold flex items-center gap-2 ${activeTab === "code" ? "bg-gray-700 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"}`}><Code size={14}/> Code</button>
              <button onClick={() => setActiveTab("board")} className={`px-4 py-1.5 rounded text-xs font-bold flex items-center gap-2 ${activeTab === "board" ? "bg-gray-700 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"}`}><Eye size={14}/> Board</button>
              <button onClick={() => setActiveTab("ai")} className={`px-4 py-1.5 rounded text-xs font-bold flex items-center gap-2 ${activeTab === "ai" ? "bg-indigo-900/80 text-indigo-300 shadow-sm border border-indigo-700/50" : "text-gray-500 hover:text-gray-300"}`}><MessageSquare size={14}/> AI Notes</button>
           </div>
           
           <div className="flex items-center gap-2">
             {activeTab === "code" && (
                <button onClick={handleFormatCode} className="p-1.5 rounded flex items-center gap-2 text-xs font-bold px-3 transition-colors text-gray-400 hover:bg-gray-800 hover:text-white" title="Format Code (Shift+Alt+F)"><Code size={14}/> Format</button>
             )}
             <button onClick={runCode} className="p-1.5 rounded flex items-center gap-2 text-xs font-bold px-3 bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-900"><Play size={14}/> Run</button>
             <button onClick={() => setShowTerminal(!showTerminal)} className={`p-1.5 rounded flex items-center gap-2 text-xs font-bold px-3 transition-colors ${showTerminal ? "bg-gray-700 text-white" : "text-gray-500 hover:bg-gray-800"}`}><TerminalIcon size={14}/> Term</button>
             {activeTab === "code" && (
                <button onClick={() => setShowPreview(!showPreview)} className={`flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded transition-colors ${showPreview ? "bg-blue-900/30 text-blue-400 border border-blue-900/50" : "text-gray-500 hover:bg-gray-800"}`}><MonitorPlay size={14}/> Web</button>
             )}
           </div>
        </div>

        {activeTab === "code" && (
           <div className={`flex-1 flex overflow-hidden relative`}>
             <div className={`relative flex-1 flex flex-col border-r border-gray-800 ${showPreview ? "w-1/2" : "w-full"}`}>
               {activeFile ? (
                 <Editor 
                    height="100%" 
                    theme="vs-dark" 
                    path={activeFile.path} 
                    value={activeFile.content} 
                    defaultLanguage={activeFile.language} 
                    onChange={handleEditorChange} 
                    onMount={handleEditorDidMount}
                    options={{ 
                      readOnly: isReadOnly, minimap: { enabled: false }, fontSize: 14, wordWrap: "on", padding: { top: 20 },
                      autoIndent: "full", formatOnType: true, formatOnPaste: true, tabSize: 4, detectIndentation: true, insertSpaces: true
                    }}
                 />
               ) : (<div className="flex-1 flex items-center justify-center text-gray-600 text-xs">Select a file...</div>)}
               {isReadOnly && <div className="absolute top-4 right-6 bg-red-900/90 text-white text-[10px] px-3 py-1 rounded-full flex items-center gap-2 shadow-xl backdrop-blur"><Lock size={10}/> Locked by Teammate</div>}
             </div>

             {showPreview && (
               <div className="w-1/2 bg-white relative">
                  {previewUrl ? (
                    <iframe src={previewUrl} title="Preview" className="w-full h-full border-none" sandbox="allow-scripts allow-modals allow-same-origin"/>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-500 text-xs">Loading preview...</div>
                  )}
               </div>
             )}
           </div>
        )}

        {activeTab === "board" && (
           <div className="absolute inset-0 z-10 bg-[#0d1117] top-14">
              <Tldraw persistenceKey={`room-${roomId}`}>
                <WhiteboardSync roomId={roomId} />
              </Tldraw>
              <button onClick={() => { if(confirm("Clear board for everyone?")) supabase.channel(`room-${roomId}-board`).send({ type: 'broadcast', event: 'board-clear', payload: {} }); }} className="absolute bottom-6 right-6 z-50 bg-red-600 hover:bg-red-500 text-white p-3 rounded-full shadow-xl flex items-center gap-2 text-xs font-bold">
                 <Eraser size={16}/> Clear
              </button>
           </div>
        )}

        {activeTab === "ai" && (
          <div className="flex-1 overflow-y-auto p-10 bg-[#0d1117] text-gray-300">
             <h2 className="text-2xl font-bold mb-6 text-white flex items-center gap-3"><Sparkles className="text-indigo-400"/> AI Architect Notes</h2>
             <div className="bg-[#161b22] border border-gray-800 p-8 rounded-xl shadow-2xl whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-300 max-w-4xl">
               {aiMessage}
             </div>
          </div>
        )}

        {showTerminal && (
          <div className="absolute bottom-40 right-4 w-[500px] h-64 bg-black/95 border border-gray-700 rounded-lg shadow-2xl z-50 flex flex-col backdrop-blur-md">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-900/50 rounded-t-lg">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-400"><TerminalIcon size={12}/> Console ({activeFile?.language})</div>
              <div className="flex gap-2">
                <button onClick={() => setTerminalLogs([])} className="text-gray-500 hover:text-white"><RefreshCw size={12}/></button>
                <button onClick={() => setShowTerminal(false)} className="text-gray-500 hover:text-white"><X size={12}/></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1 text-gray-300 scrollbar-thin scrollbar-thumb-gray-700">
              {terminalLogs.map((log, i) => <div key={i} className="break-all border-b border-gray-800/30 pb-0.5">{log}</div>)}
              {isRunning && <div className="text-green-500 animate-pulse">Running...</div>}
            </div>
          </div>
        )}

        {(activeTab === "code" || activeTab === "ai") && (
          <div className={`h-auto min-h-[140px] border-t border-gray-800 bg-[#161b22] p-4 flex gap-4 z-20 ${globalMode ? "border-t-2 border-red-900/50" : ""}`}>
             <div className="flex-1 relative">
               <textarea className={`w-full h-full bg-black/40 border rounded-lg p-3 text-sm outline-none resize-none font-mono ${globalMode ? "border-red-800 text-red-200" : "border-gray-700 text-green-300"}`} placeholder={globalMode ? "GLOBAL MODE: 'Change all buttons to neon'..." : activeFile ? `Ask AI to edit ${activeFile.path}...` : "Select a file..."} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAiGenerate())}/>
             </div>
             <div className="w-64 flex flex-col gap-2">
               <button onClick={handleAiGenerate} disabled={isProcessing} className={`h-10 font-bold rounded flex items-center justify-center gap-2 ${globalMode ? "bg-red-700 hover:bg-red-600 text-white" : "bg-green-700 hover:bg-green-600 text-white"}`}>{isProcessing ? <Loader2 className="animate-spin" size={16}/> : globalMode ? <Wand2 size={16}/> : <Zap size={16}/>} {globalMode ? "Refactor All" : "Generate"}</button>
               <div className="flex-1 bg-black/50 rounded border border-gray-800 p-2 text-[10px] text-gray-400 font-mono overflow-y-auto">{aiOutput}</div>
             </div>
          </div>
        )}
      </div>

      {showTeamModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
           <div className="bg-[#161b22] border border-gray-700 p-6 rounded-xl w-[500px] shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2"><Users size={20}/> Manage Team</h2>
                <button onClick={() => setShowTeamModal(false)}><X size={20} className="text-gray-500 hover:text-white"/></button>
              </div>
              
              <div className="space-y-4 mb-6 max-h-60 overflow-y-auto">
                {members.map(member => (
                  <div key={member.id} className="flex items-center justify-between bg-gray-900 p-3 rounded border border-gray-800">
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                         {member.email} {member.is_owner && <span className="bg-yellow-900/50 text-yellow-500 text-[9px] px-1.5 rounded border border-yellow-800">OWNER</span>}
                      </div>
                      <div className="text-xs text-gray-500">ID: {member.id.substring(0,8)}...</div>
                    </div>
                    {myRole === "Leader" && !member.is_owner ? (
                      <select value={member.role} onChange={(e) => handleUpdateRole(member.id, e.target.value)} className={`bg-gray-800 text-xs px-2 py-1 rounded border border-gray-700 outline-none ${PERMISSION_INFO[member.role]?.color}`}>
                         {Object.keys(PERMISSION_INFO).map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (<span className={`text-xs px-2 py-1 rounded bg-gray-800 ${PERMISSION_INFO[member.role]?.color}`}>{member.role}</span>)}
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-700 pt-4">
                 <h3 className="text-xs font-bold text-gray-500 mb-2 uppercase">Invite New Member</h3>
                 <div className="flex gap-2">
                    <input className="flex-1 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white outline-none" placeholder="colleague@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                    <button onClick={handleInvite} disabled={isInviting} className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-4 rounded">{isInviting ? "..." : "Send Invite"}</button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {showSettings && (
        <div className="absolute bottom-20 left-4 z-50 bg-[#161b22] border border-gray-700 p-4 rounded-lg shadow-xl w-72">
          <div className="flex justify-between mb-3"><h3 className="font-bold text-xs text-white">Config</h3><button onClick={()=>setShowSettings(false)}><X size={12}/></button></div>
          <select value={provider} onChange={e => setProvider(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-white mb-3 outline-none">{AI_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input type="password" placeholder="API Key" value={apiKey} onChange={e => {setApiKey(e.target.value); localStorage.setItem("vibecoding_api_key", e.target.value)}} className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-white outline-none"/>
        </div>
      )}
    </div>
  );
}