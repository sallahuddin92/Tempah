import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  const { date, room_name } = req.query;

  if (!date || !room_name) {
    return res.status(400).json({ error: "Tarikh atau bilik tidak diberikan." });
  }

  try {

    const sql = neon(process.env.DATABASE_URL);

    const bookings = await sql`
      SELECT * FROM bookings
      WHERE booking_date = ${date}
      AND room_name = ${room_name}
    `;

    const slots = [];

    const start = 450; // 7:30
    const end = 960; // 16:00

    for (let m = start; m <= end; m += 30) {

      const booking = bookings.find(b => b.booking_hour === m);

      slots.push({
        hour: m,
        isBooked: !!booking,
        booking: booking || null
      });

    }

    res.status(200).json(slots);

  } catch (error) {

    res.status(500).json({ error: error.message });

  }

}
