import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "DELETE") {
    return res.status(405).end();
  }

  const { id } = req.query;
  const { user_name } = req.body;

  try {

    const sql = neon(process.env.DATABASE_URL);

    const booking = await sql`
      SELECT * FROM bookings
      WHERE id = ${id}
      LIMIT 1
    `;

    if (!booking.length) {
      return res.status(404).json({ error: "Tempahan tidak ditemui." });
    }

    if (booking[0].user_name !== user_name) {
      return res.status(403).json({ error: "Tidak dibenarkan." });
    }

    await sql`
      DELETE FROM bookings
      WHERE id = ${id}
    `;

    res.json({
      success: true
    });

  } catch (error) {

    res.status(500).json({ error: error.message });

  }

}
