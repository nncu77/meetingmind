import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkQuota, recordUsage } from '@/lib/quota';
import { buildDigestBundle } from '@/lib/email/meeting-digest';

export const dynamic = 'force-dynamic';
// react-pdf uses Node.js APIs (path / fs) — must run on Node runtime, not Edge
export const runtime = 'nodejs';

type Format = 'pdf' | 'docx';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await params;
  const url = new URL(req.url);
  const formatParam = url.searchParams.get('format');
  if (formatParam !== 'pdf' && formatParam !== 'docx') {
    return NextResponse.json(
      { error: 'bad_format', message: 'format 必須是 pdf 或 docx' },
      { status: 400 },
    );
  }
  const format: Format = formatParam;

  // ----- auth + org check -----
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const { data: member } = await supabase
    .from('members')
    .select('id, org_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'no_org_membership' }, { status: 403 });

  // RLS verify
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, created_at, status, is_confidential, privacy_level')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: 'meeting_not_found_or_forbidden' }, { status: 404 });
  }
  if (meeting.status !== 'done') {
    return NextResponse.json(
      { error: 'meeting_not_ready', message: '會議尚未處理完成，無法匯出' },
      { status: 409 },
    );
  }

  // ----- Quota check -----
  const resource = format === 'pdf' ? 'pdf_export' : 'docx_export';
  const quota = await checkQuota(member.org_id, resource);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: 'QUOTA_EXCEEDED',
        reason: quota.reason,
        message:
          quota.reason === 'org_limit'
            ? `本月匯出額度已用完（${quota.orgUsed}/${quota.orgLimit}），下個月 1 號重置`
            : `平台本月匯出額度已用完，請聯絡管理員`,
      },
      { status: 429 },
    );
  }

  // ----- Build digest bundle (with service-role to bypass RLS on related tables) -----
  const admin = getSupabaseAdmin();
  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', member.org_id)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://meetingmind-xi.vercel.app';
  const bundle = await buildDigestBundle({
    client: admin,
    meetingId,
    appUrl,
    orgName: org?.name ?? 'MeetingMind',
  });
  if (!bundle) {
    return NextResponse.json({ error: 'meeting_data_missing' }, { status: 500 });
  }
  const confidential = !!meeting.is_confidential || meeting.privacy_level === 'strict';

  // ----- Render -----
  let buf: Buffer;
  let contentType: string;
  let ext: string;
  try {
    if (format === 'pdf') {
      const { renderToBuffer } = await import('@react-pdf/renderer');
      const pdfModule = await import('@/lib/exports/MeetingPDF');
      const MeetingPDF = pdfModule.default;
      // Force font registration before render. Module top-level call should
      // suffice in Next.js runtime, but make it explicit to survive any
      // module-loader quirks (esbuild/turbo workers).
      pdfModule.registerFonts();
      const React = await import('react');
      // MeetingPDF returns <Document> at root — react-pdf accepts it but its
      // .d.ts requires the param to be DocumentProps. Cast through unknown.
      const element = React.createElement(MeetingPDF, {
        ...bundle.props,
        confidential,
      }) as unknown as Parameters<typeof renderToBuffer>[0];
      buf = await renderToBuffer(element);
      contentType = 'application/pdf';
      ext = 'pdf';
    } else {
      const { renderMeetingDocx } = await import('@/lib/exports/MeetingDocx');
      buf = await renderMeetingDocx({ ...bundle.props, confidential });
      contentType =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      ext = 'docx';
    }
  } catch (e) {
    console.error(`[export] ${format} render failed:`, e);
    return NextResponse.json(
      {
        error: 'render_failed',
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // ----- Record usage (only after successful render) -----
  await recordUsage(member.org_id, resource);

  // ----- Filename (RFC 5987 for 中文) -----
  const dateStr = formatDateForFilename(meeting.created_at);
  const baseName = `${meeting.title}_${dateStr}`;
  const safeAsciiName = baseName.replace(/[^\x20-\x7e]/g, '_');
  const encodedUtf8Name = encodeURIComponent(baseName).replace(/['()*]/g, escape);
  const filename = `${baseName}.${ext}`;
  const dispositionValue =
    `attachment; filename="${safeAsciiName}.${ext}"; ` +
    `filename*=UTF-8''${encodedUtf8Name}.${ext}`;

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': dispositionValue,
      'content-length': String(buf.length),
      'cache-control': 'private, no-store',
      // 留個 ascii hint header 給前端讀（瀏覽器 content-disposition 已處理檔名）
      'x-meetingmind-filename': encodeURIComponent(filename),
    },
  });
}

function formatDateForFilename(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
