import { NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { week_start_date } = body;

    if (!week_start_date) {
      return NextResponse.json({ error: 'week_start_date is required' }, { status: 400 });
    }

    // 1. Fetch all people, places, and history
    const peopleRes = await client.query('SELECT * FROM person');
    const placesRes = await client.query('SELECT * FROM place');
    const historyRes = await client.query(
      `SELECT place_id, person_id, MAX(week_start_date) as last_scheduled_week
       FROM schedule
       WHERE person_id IS NOT NULL
       GROUP BY place_id, person_id`
    );

    const people = peopleRes.rows;
    const places = placesRes.rows;
    const history = historyRes.rows;

    // Create a history map: "place_id|person_id" -> last_scheduled_week (string)
    const historyMap = new Map<string, string>();
    for (const h of history) {
      const dateStr = h.last_scheduled_week instanceof Date 
        ? h.last_scheduled_week.toISOString().split('T')[0]
        : String(h.last_scheduled_week).split('T')[0];
      historyMap.set(`${h.place_id}|${h.person_id}`, dateStr);
    }

    // 2. Sort places to schedule the most constrained first
    // MALE type places have 14 possible candidates.
    // FEMALE type places have 22 possible candidates (MALE + FEMALE).
    // So schedule MALE type places first.
    // Within type, sort by place_id or day to ensure deterministic order.
    const sortedPlaces = [...places].sort((a, b) => {
      if (a.type === 'MALE' && b.type !== 'MALE') return -1;
      if (a.type !== 'MALE' && b.type === 'MALE') return 1;
      return Number(a.place_id) - Number(b.place_id);
    });

    // 3. Keep track of current week assignments to prevent double booking and balance workload
    // Double booking lock: "person_id|meeting_day|time_slot" -> true
    const bookedDays = new Set<string>();
    // Workload tracker: person_id -> count of assignments this week
    const workloads = new Map<number, number>();
    for (const p of people) {
      workloads.set(Number(p.person_id), 0);
    }

    const assignments: Array<{ place_id: number; person_id: number; scheduled_date: string }> = [];

    // Helper to calculate target scheduled date
    const dayOffsets: Record<string, number> = {
      MONDAY: 0,
      TUESDAY: 1,
      WEDNESDAY: 2,
      THURSDAY: 3,
      FRIDAY: 4,
      SATURDAY: 5,
      SUNDAY: 6,
    };

    const getScheduledDate = (baseDateStr: string, day: string): string => {
      const baseDate = new Date(baseDateStr);
      const offset = dayOffsets[day.toUpperCase()] || 0;
      baseDate.setDate(baseDate.getDate() + offset);
      return baseDate.toISOString().split('T')[0];
    };

    // 4. Run Greedy Allocation Algorithm
    for (const place of sortedPlaces) {
      const placeId = Number(place.place_id);
      
      // Filter candidates based on gender rules:
      // "male is allowed for both male and female but female is allowed for female only"
      const eligiblePeople = people.filter(p => {
        if (place.type === 'MALE') {
          return p.gender === 'MALE';
        }
        return true; // Female place: MALE and FEMALE both allowed
      });

      // Score and sort candidates
      const candidates = eligiblePeople.map(person => {
        const personId = Number(person.person_id);
        const lastWeek = historyMap.get(`${placeId}|${personId}`) || '1970-01-01'; // Default to epoch for "never scheduled"
        const workload = workloads.get(personId) || 0;
        return {
          person,
          personId,
          lastWeek,
          workload
        };
      });

      // Sort criteria:
      // 1. Workload (current week) ASC - distribute work evenly first
      // 2. Last scheduled week ASC (oldest first, i.e., cycle them)
      // 3. personId ASC (deterministic tie breaker)
      candidates.sort((a, b) => {
        if (a.workload !== b.workload) {
          return a.workload - b.workload;
        }
        if (a.lastWeek !== b.lastWeek) {
          return a.lastWeek.localeCompare(b.lastWeek);
        }
        return a.personId - b.personId;
      });

      // Find first candidate not double booked
      let assigned = false;
      for (const cand of candidates) {
        const lockKey = `${cand.personId}|${place.meeting_day}`;
        if (!bookedDays.has(lockKey)) {
          // Assign!
          assignments.push({
            place_id: placeId,
            person_id: cand.personId,
            scheduled_date: getScheduledDate(week_start_date, place.meeting_day)
          });

          // Lock day and increase workload
          bookedDays.add(lockKey);
          workloads.set(cand.personId, cand.workload + 1);
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        console.warn(`Could not auto-assign anyone to place "${place.name}" (ID: ${placeId}) due to double booking conflicts.`);
      }
    }

    // 5. Save generated schedule to database inside a transaction
    await client.query('BEGIN');
    await client.query('DELETE FROM schedule WHERE week_start_date = $1', [week_start_date]);

    for (const assign of assignments) {
      await client.query(
        `INSERT INTO schedule (week_start_date, place_id, person_id, scheduled_date)
         VALUES ($1, $2, $3, $4)`,
        [week_start_date, assign.place_id, assign.person_id, assign.scheduled_date]
      );
    }
    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: `Auto-scheduled ${assignments.length} out of ${places.length} places successfully.`,
      schedules: assignments
    });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error in auto-scheduling:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  } finally {
    client.release();
  }
}
