import { NextResponse } from 'next/server';
import { query } from '@/app/lib/db';

export async function GET() {
  try {
    const res = await query('SELECT * FROM place ORDER BY place_id ASC');
    return NextResponse.json(res.rows);
  } catch (error: any) {
    console.error('Error fetching places:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
