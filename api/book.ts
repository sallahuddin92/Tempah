import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { room_name, date, hour, user_name, reason } = req.body;

  if (!room_name || !date || hour === undefined || !user_name || !reason) {
    return res.status(400).json({ error: "Maklumat tidak lengkap." });
  }

  try {

    const sql = neon(process.env.DATABASE_URL);

    const existing = await sql`
      SELECT * FROM bookings
      WHERE room_name = ${room_name}
      AND booking_date = ${date}
      AND booking_hour = ${hour}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return res.status(409).json({
        error: `Slot telah ditempah oleh ${existing[0].user_name}`
      });
    }

    await sql`
      INSERT INTO bookings
      (room_name, booking_date, booking_hour, user_name, reason)
      VALUES
      (${room_name}, ${date}, ${hour}, ${user_name}, ${reason})
    `;

    res.status(200).json({
      success: true
    });

  } catch (error) {

    res.status(500).json({ error: error.message });

  }

}
