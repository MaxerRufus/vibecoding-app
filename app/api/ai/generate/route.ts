import { OpenAI } from "openai"; // Used for NVIDIA NIM
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Initialize Supabase Admin (to write to DB)
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function POST(req: Request) {
  const { projectId, userRole, prompt, currentFileTree, apiKey } = await req.json();

  // 1. The NVIDIA Architect Persona
  const systemPrompt = `
    You are the Lead Software Architect.
    User Role: ${userRole}
    Project Structure: ${JSON.stringify(currentFileTree)}
    
    YOUR JOB:
    1. Analyze the user's request.
    2. Determine which file(s) need to be created or modified.
    3. Ensure the code follows the Project Structure.
    4. Return a JSON object with the file updates.
    
    Response Format:
    {
      "files": [
        { "path": "src/components/Header.tsx", "content": "..." },
        { "path": "src/utils/api.ts", "content": "..." }
      ],
      "message": "I have updated the Header and API utils."
    }
  `;

  // 2. Call NVIDIA Llama 3.1
  const client = new OpenAI({
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKey: apiKey 
  });

  const completion = await client.chat.completions.create({
    model: "meta/llama-3.1-70b-instruct",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    temperature: 0.2,
    response_format: { type: "json_object" } // Force JSON
  });

  const architectDecision = JSON.parse(completion.choices[0].message.content || "{}");

  // 3. Commit to Database (The "Merge")
  for (const file of architectDecision.files) {
    // Check permissions (Mock logic: Frontend can't touch Backend files)
    if (userRole === "Frontend" && file.path.includes("server/")) {
        return NextResponse.json({ error: "Access Denied: Frontend cannot edit Server files." });
    }

    // Upsert the file into Supabase
    await supabase.from("files").upsert({
      project_id: projectId,
      path: file.path,
      content: file.content,
      language: "typescript" // simplify for demo
    }, { onConflict: "project_id, path" });
  }

  return NextResponse.json({ success: true, message: architectDecision.message });
}