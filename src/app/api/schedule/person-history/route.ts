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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const personId = searchParams.get('person_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    if (!personId) {
      return NextResponse.json({ error: 'person_id parameter is required' }, { status: 400 });
    }

    let sql = `
      SELECT s.schedule_id, s.week_start_date, s.place_id, s.person_id, s.scheduled_date,
             p.name as person_name, p.gender as person_gender,
             pl.name as place_name, pl.type as place_type, pl.meeting_day, pl.time_slot
      FROM schedule s
      JOIN place pl ON s.place_id = pl.place_id
      JOIN person p ON s.person_id = p.person_id
      WHERE s.person_id = $1
    `;
    const params: any[] = [personId];

    if (startDate) {
      params.push(startDate);
      sql += ` AND s.scheduled_date >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      sql += ` AND s.scheduled_date <= $${params.length}`;
    }

    sql += ` ORDER BY s.scheduled_date DESC`;

    const res = await query(sql, params);

    // Format dates properly as strings YYYY-MM-DD
    const rows = res.rows.map(row => ({
      ...row,
      week_start_date: formatLocalDate(row.week_start_date),
      scheduled_date: formatLocalDate(row.scheduled_date)
    }));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error('Error fetching person history:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
