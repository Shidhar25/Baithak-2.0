import { NextResponse } from 'next/server';
import { query } from '@/app/lib/db';

function formatLocalDate(d: any): string {
  if (!d) return '';
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${date}`;
  }
  return String(d).split('T')[0];
}

export async function GET() {
  try {
    const res = await query(
      `SELECT place_id, person_id, MAX(week_start_date) as last_scheduled_week
       FROM schedule
       WHERE person_id IS NOT NULL
       GROUP BY place_id, person_id`
    );

    // Format week_start_date properly (as ISO date YYYY-MM-DD)
    const history = res.rows.map(row => ({
      place_id: Number(row.place_id),
      person_id: Number(row.person_id),
      last_scheduled_week: formatLocalDate(row.last_scheduled_week)
    }));

    return NextResponse.json(history);
  } catch (error: any) {
    console.error('Error fetching schedule history:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
