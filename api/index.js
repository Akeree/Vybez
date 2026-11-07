// Vercel Function: every /api/* request is rewritten here (see vercel.json).
import { handle } from '../server/api.js';

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
