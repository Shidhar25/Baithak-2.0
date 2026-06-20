import { NextResponse } from 'next/server';
import pool, { query } from '@/app/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const weekStartDate = searchParams.get('week_start_date');

    if (!weekStartDate) {
      return NextResponse.json({ error: 'week_start_date parameter is required' }, { status: 400 });
    }

    const res = await query(
      `SELECT s.schedule_id, s.week_start_date, s.place_id, s.person_id, s.scheduled_date,
              p.name as person_name, p.gender as person_gender,
              pl.name as place_name, pl.type as place_type, pl.meeting_day, pl.time_slot
       FROM schedule s
       JOIN place pl ON s.place_id = pl.place_id
       LEFT JOIN person p ON s.person_id = p.person_id
       WHERE s.week_start_date = $1`,
      [weekStartDate]
    );

    return NextResponse.json(res.rows);
  } catch (error: any) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { week_start_date, schedules } = body;

    if (!week_start_date) {
      return NextResponse.json({ error: 'week_start_date is required' }, { status: 400 });
    }

    if (!Array.isArray(schedules)) {
      return NextResponse.json({ error: 'schedules must be an array' }, { status: 400 });
    }

    // 1. Fetch people and places to perform validation
    const peopleRes = await client.query('SELECT * FROM person');
    const placesRes = await client.query('SELECT * FROM place');
    const peopleMap = new Map(peopleRes.rows.map(p => [String(p.person_id), p]));
    const placesMap = new Map(placesRes.rows.map(pl => [String(pl.place_id), pl]));

    // 2. Perform validations on schedules
    const bookings = new Map<string, string>(); // key: "day|time_slot|person_id", value: place_id

    for (const item of schedules) {
      const { place_id, person_id } = item;
      if (!person_id) continue;

      const person = peopleMap.get(String(person_id));
      const place = placesMap.get(String(place_id));

      if (!person || !place) {
        return NextResponse.json({ error: `Invalid person_id (${person_id}) or place_id (${place_id})` }, { status: 400 });
      }

      // Gender Rule Check:
      // "male is allowed for both male and female but female is allowed for female only"
      if (place.type === 'MALE' && person.gender !== 'MALE') {
        return NextResponse.json({
          error: `Validation Error: Female (${person.name}) cannot be assigned to Male place (${place.name}).`
        }, { status: 400 });
      }

      // Double-Booking Check:
      // "one person should not schedule for different place at same time"
      const bookingKey = `${place.meeting_day}|${place.time_slot}|${person_id}`;
      if (bookings.has(bookingKey)) {
        const otherPlaceId = bookings.get(bookingKey);
        const otherPlace = placesMap.get(String(otherPlaceId));
        return NextResponse.json({
          error: `Validation Error: ${person.name} is double-booked on ${place.meeting_day} ${place.time_slot} at both "${place.name}" and "${otherPlace?.name}".`
        }, { status: 400 });
      }
      bookings.set(bookingKey, place_id);
    }

    // 3. Save schedules inside a transaction
    await client.query('BEGIN');

    // Delete existing schedules for this week
    await client.query('DELETE FROM schedule WHERE week_start_date = $1', [week_start_date]);

    // Insert new non-null schedules
    for (const item of schedules) {
      const { place_id, person_id, scheduled_date } = item;
      if (!person_id) continue;

      await client.query(
        `INSERT INTO schedule (week_start_date, place_id, person_id, scheduled_date)
         VALUES ($1, $2, $3, $4)`,
        [week_start_date, place_id, person_id, scheduled_date]
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({ success: true, message: 'Schedules saved successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error saving schedules:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  } finally {
    client.release();
  }
}
