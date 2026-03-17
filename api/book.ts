import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const sql = neon(process.env.DATABASE_URL);

    const { room_name, date, hour, user_name, reason, teacher_name } = req.body;

    // VALIDATION
    if (!room_name || !date || hour === undefined || !user_name || !reason || !teacher_name) {
      return res.status(400).json({ error: "Maklumat tidak lengkap." });
    }

    // CHECK IF SLOT ALREADY BOOKED
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

    // INSERT BOOKING
    await sql`
      INSERT INTO bookings
      (room_name, booking_date, booking_hour, user_name, reason, teacher_name)
      VALUES
      (${room_name}, ${date}, ${hour}, ${user_name}, ${reason}, ${teacher_name})
    `;

    return res.status(200).json({
      success: true
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Server error"
    });

  }
async function sendTelegramMessage(chatId, text) {

  const token = process.env.TELEGRAM_BOT_TOKEN;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });

}
