import { NextResponse } from 'next/server';
import { runFlow } from '@/lib/runFlow';
import type { FlowDoc } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const doc = (await req.json()) as FlowDoc;
  const result = await runFlow(doc);
  return NextResponse.json(result);
}
