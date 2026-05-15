'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const Credentials = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(72),
  next: z.string().optional(),
});

export async function signInAction(formData: FormData) {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  });
  if (!parsed.success) {
    redirect('/login?error=' + encodeURIComponent('Email or password invalid'));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    redirect('/login?error=' + encodeURIComponent(error.message));
  }

  revalidatePath('/', 'layout');
  redirect(parsed.data.next || '/meetings');
}
