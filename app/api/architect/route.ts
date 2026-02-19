import { OpenAI } from "openai";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! 
);

// Map of all OpenAI-compatible endpoints
const PROVIDERS: Record<string, { url: string | undefined; model: string }> = {
  openai: { url: undefined, model: "gpt-4o" }, 
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-1.5-pro" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-70b-instruct" },
  groq:   { url: "https://api.groq.com/openai/v1", model: "llama3-70b-8192" }
};

export async function POST(req: Request) {
  try {
    const { projectId, prompt, currentFileTree, apiKey, provider, userId, activeFileId, mode } = await req.json();

    // Smart API Key handling: Use the one from the frontend, OR fallback to your .env file
    let finalApiKey = apiKey;
    if (!finalApiKey) {
      if (provider === "nvidia") finalApiKey = process.env.NVIDIA_API_KEY;
      else if (provider === "openai") finalApiKey = process.env.OPENAI_API_KEY;
      else if (provider === "groq") finalApiKey = process.env.GROQ_API_KEY;
    }

    if (!finalApiKey) {
      return new Response("Missing API Key. Add it in Settings or your .env file.", { status: 401 });
    }

    // 1. Permissions & Context Validation
    const [memberRes, projectRes, historyRes] = await Promise.all([
      supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).single(),
      supabase.from("projects").select("owner_id").eq("id", projectId).single(),
      supabase.from("chat_history").select("role, content").eq("project_id", projectId).order("created_at", { ascending: false }).limit(30)
    ]);

    let userRole = "Viewer"; 
    if (projectRes.data?.owner_id === userId) userRole = "Leader";
    else if (memberRes.data?.role) userRole = memberRes.data.role;

    if (userRole === "Viewer") return new Response("Viewers cannot edit code.", { status: 403 });

    const chatContext = (historyRes.data || []).reverse();
    const isGlobal = mode === "global" && userRole === "Leader";
    const activeFile = currentFileTree.find((f: any) => f.id === activeFileId);
    
    const focusContext = isGlobal 
      ? "SCOPE: GLOBAL REFACTOR. Modify ANY and ALL files." 
      : (activeFile ? `SCOPE: FOCUSED on "${activeFile.path}".` : "SCOPE: Project Overview.");

    const lockedFiles = currentFileTree
      .filter((f: any) => f.locked_by && f.locked_by !== userId)
      .map((f: any) => f.path);

    const systemPrompt = `
YOU ARE THE PROJECT ARCHITECT.

--- SECURITY ---
Role: ${userRole}. (Frontend: UI only. Backend: Logic/DB only. Leader: All).
Locked files (DO NOT EDIT unless Leader): ${JSON.stringify(lockedFiles)}

${focusContext}

--- CRITICAL: OUTPUT FORMAT ---
You MUST respond EXACTLY in this format so your response can be streamed real-time to the editor. Do not use Markdown code blocks. Use these exact XML tags:

<message>
Brief summary of the architecture and changes.
</message>

<file path="filename.ext">
[ENTIRE FILE CONTENT HERE]
</file>
`;

    // 2. Initialize universal OpenAI client with the selected provider's configuration
    const selectedProvider = PROVIDERS[provider] || PROVIDERS.openai;
    const client = new OpenAI({ 
      apiKey: finalApiKey, 
      baseURL: selectedProvider.url 
    });

    // 3. GENERATION WITH YOUR EXACT PYTHON SCRIPT PARAMETERS
    const completion = await client.chat.completions.create({
      model: selectedProvider.model,
      messages: [
        { role: "system", content: systemPrompt }, 
        ...chatContext.map(msg => ({ role: msg.role as "user"|"assistant", content: msg.content })), 
        { role: "user", content: prompt }
      ],
      temperature: 0.2,     // MATCHES YOUR SCRIPT
      top_p: 0.7,           // MATCHES YOUR SCRIPT
      max_tokens: 1024,     // MATCHES YOUR SCRIPT
      stream: true,         // MATCHES YOUR SCRIPT
    });

    // 4. Pipe Stream to Client & Save to DB in background
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = "";
        
        try {
          for await (const chunk of completion) {
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) {
              fullResponse += text;
              controller.enqueue(new TextEncoder().encode(text));
            }
          }
        } catch (streamError) {
          console.error("Streaming error:", streamError);
          controller.error(streamError);
          return;
        }
        
        // --- PARSE AND SAVE TO DB ---
        try {
          const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
          let match;
          
          while ((match = fileRegex.exec(fullResponse)) !== null) {
              const path = match[1];
              const content = match[2].replace(/^\n|\n$/g, ''); 

              const { data: fileCheck } = await supabase
                .from("files")
                .select("locked_by")
                .eq("project_id", projectId)
                .eq("path", path)
                .single();
                
              if (fileCheck?.locked_by && fileCheck.locked_by !== userId && userRole !== "Leader") {
                continue; 
              }

              await supabase.from("files").upsert({
                project_id: projectId, 
                path: path, 
                content: content,
                language: path.endsWith('py') ? 'python' : path.endsWith('html') ? 'html' : path.endsWith('css') ? 'css' : path.endsWith('js') ? 'javascript' : 'text'
              }, { onConflict: 'project_id, path' });
          }

          const msgMatch = /<message>([\s\S]*?)<\/message>/.exec(fullResponse);
          const msg = msgMatch ? msgMatch[1].trim() : "Code updated.";
          
          await supabase.from("chat_history").insert([
              { project_id: projectId, role: "user", content: prompt },
              { project_id: projectId, role: "assistant", content: msg }
          ]);
        } catch (dbError) {
          console.error("Database save error:", dbError);
        }

        controller.close();
      }
    });

    return new Response(stream, { 
      headers: { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      } 
    });

  } catch (error: any) {
    console.error("API Route Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}