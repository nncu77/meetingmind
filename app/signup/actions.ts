'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const SignupForm = z.object({
  email: z.string().email(),
  password: z.string().min(8, '密碼至少 8 碼').max(72),
  name: z.string().min(1).max(50),
});

export async function signUpAction(formData: FormData) {
  const parsed = SignupForm.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    name: formData.get('name'),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Invalid input';
    redirect('/signup?error=' + encodeURIComponent(first));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { name: parsed.data.name },
    },
  });

  if (error) {
    redirect('/signup?error=' + encodeURIComponent(error.message));
  }

  // Fallback: if the auth.users trigger isn't installed yet (migration not run),
  // ensure org + member rows exist for this new user. Idempotent — does nothing
  // if the trigger already did its job.
  if (data.user) {
    await ensureMembership({
      userId: data.user.id,
      email: parsed.data.email,
      name: parsed.data.name,
    });
  }

  // If Supabase project has email confirmation ON, session is null until verified.
  // Redirect to a "check your email" state. If confirmation is OFF (recommended
  // for demo), session is already set and we go to /meetings.
  if (!data.session) {
    redirect('/signup?check_email=1');
  }

  revalidatePath('/', 'layout');
  redirect('/meetings');
}

async function ensureMembership(opts: { userId: string; email: string; name: string }) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from('members')
    .select('id')
    .eq('user_id', opts.userId)
    .maybeSingle();
  if (existing) return;

  const local = opts.email.split('@')[0];
  const { data: org } = await admin
    .from('organizations')
    .insert({ name: `${local}'s org`, plan: 'free' })
    .select('id')
    .single();
  if (!org) return;

  await admin.from('members').insert({
    org_id: org.id,
    user_id: opts.userId,
    name: opts.name,
    email: opts.email,
    role: 'owner',
  });
}
