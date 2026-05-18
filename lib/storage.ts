import { promises as fs } from 'fs';
import path from 'path';
import type { FlowDoc } from './types';
import { SAMPLE_FLOW } from './defaults';

const DATA_DIR = path.join(process.cwd(), 'data');
const FLOW_FILE = path.join(DATA_DIR, 'flow.json');

export async function loadFlow(): Promise<FlowDoc> {
  try {
    const raw = await fs.readFile(FLOW_FILE, 'utf-8');
    return JSON.parse(raw) as FlowDoc;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return SAMPLE_FLOW;
    throw e;
  }
}

export async function saveFlow(doc: FlowDoc): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FLOW_FILE, JSON.stringify(doc, null, 2), 'utf-8');
}
