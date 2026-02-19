import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  try {
    const { email, projectId, role, url } = await req.json();

    // 1. Find User ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "User not found. They must sign up for Vibecoding first." }, { status: 404 });
    }

    // 2. Add to Database (The Permission)
    const { error: dbError } = await supabase
      .from('project_members')
      .insert({
        project_id: projectId,
        user_id: profile.id,
        role: role
      });

    if (dbError) {
      // If already added, just continue to send email
      if (!dbError.message.includes("duplicate")) {
        return NextResponse.json({ error: dbError.message }, { status: 500 });
      }
    }

    // 3. Send the Actual Email (The Notification)
    const { data, error: emailError } = await resend.emails.send({
      from: 'Vibecoding <onboarding@resend.dev>', // Use this default for testing
      to: [email], // In free tier, you can only email yourself unless you verify domain
      subject: `You've been invited to code!`,
      html: `
        <h1>🚀 Project Invite</h1>
        <p>You have been invited to join a workspace as a <strong>${role}</strong>.</p>
        <p>Click below to join:</p>
        <a href="${url}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
          Join Workspace
        </a>
      `,
    });

    if (emailError) {
      return NextResponse.json({ error: "DB Success, but Email Failed: " + emailError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}