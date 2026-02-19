"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { useRouter } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage() {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    // 1. Check if already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push("/dashboard"); // Redirect to Dashboard
      }
    });

    // 2. Listen for login events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.push("/dashboard"); // Redirect to Dashboard
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0d1117] text-white p-4">
      <div className="w-full max-w-md bg-[#161b22] p-8 rounded-xl border border-gray-800 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-2">
            Vibecoding_
          </h1>
          <p className="text-gray-400 text-sm">
            The AI-Orchestrated Collaborative Workspace
          </p>
        </div>
        
        <Auth 
          supabaseClient={supabase} 
          appearance={{ 
            theme: ThemeSupa, 
            variables: { 
              default: { 
                colors: { 
                  brand: '#2563eb', 
                  brandAccent: '#1d4ed8',
                  inputText: 'white',
                  inputBackground: '#0d1117',
                  inputBorder: '#30363d'
                } 
              } 
            } 
          }}
          providers={["google"]}
          theme="dark"
        />
      </div>
    </div>
  );
}