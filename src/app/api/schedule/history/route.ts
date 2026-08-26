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
      `SELECT s.place_id, s.person_id, MAX(s.scheduled_date) as last_scheduled_date
       FROM schedule s
       JOIN place pl ON pl.place_id = s.place_id
       WHERE s.person_id IS NOT NULL
         AND UPPER(TRIM(TO_CHAR(s.scheduled_date, 'FMDay'))) = pl.meeting_day
       GROUP BY s.place_id, s.person_id`
    );

    // Format scheduled_date properly (as ISO date YYYY-MM-DD)
    const history = res.rows.map(row => ({
      place_id: Number(row.place_id),
      person_id: Number(row.person_id),
      last_scheduled_date: formatLocalDate(row.last_scheduled_date)
    }));

    return NextResponse.json(history);
  } catch (error: any) {
    console.error('Error fetching schedule history:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
