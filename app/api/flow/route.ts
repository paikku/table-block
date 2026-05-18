import { NextResponse } from 'next/server';
import { loadFlow, saveFlow } from '@/lib/storage';
import type { FlowDoc } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const doc = await loadFlow();
  return NextResponse.json(doc);
}

export async function POST(req: Request) {
  const doc = (await req.json()) as FlowDoc;
  await saveFlow(doc);
  return NextResponse.json({ ok: true });
}
