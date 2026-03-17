import Groq from "groq-sdk";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }

  try {

    const { message, date, user_name = "Guest", teacher_name = "Unknown", kelas = "N/A", telegram_id } = req.body;

    const sql = neon(process.env.DATABASE_URL);

    // 🔹 ALL ROOMS
    const allRooms = [
      "Perpustakaan",
      "Bilik Tayang",
      "Makmal Bahasa",
      "Bilik Mesyuarat 2"
    ];

    // 🔹 ALL HOURS (adjust ikut system kau)
    const allHours = [8,9,10,11,12,13,14,15];

    // 🔹 GET BOOKINGS
    const bookings = await sql`
      SELECT room_name, booking_hour, user_name
      FROM bookings
      WHERE booking_date = ${date}
    `;

    // 🔹 PARSE MESSAGE (simple intent detection)
    const lowerMsg = message.toLowerCase();

    let detectedRoom = allRooms.find(r => lowerMsg.includes(r.toLowerCase()));
    let detectedHour = allHours.find(h => lowerMsg.includes(h.toString()));

    // 🔹 FILTER ROOM BOOKINGS
    const roomBookings = detectedRoom
      ? bookings.filter(b => b.room_name === detectedRoom)
      : [];

    const bookedHours = roomBookings.map(b => b.booking_hour);
    const freeHours = allHours.filter(h => !bookedHours.includes(h));

    // 🔥 AUTO BOOKING LOGIC
    if (lowerMsg.includes("tempah") && detectedRoom && detectedHour !== undefined) {

      // check availability
      const exists = await sql`
        SELECT * FROM bookings
        WHERE room_name = ${detectedRoom}
        AND booking_date = ${date}
        AND booking_hour = ${detectedHour}
        LIMIT 1
      `;

      if (exists.length > 0) {
        return res.json({
          reply: `❌ Slot ${detectedHour}:00 untuk ${detectedRoom} sudah ditempah oleh ${exists[0].user_name}`
        });
      }

      // insert booking
      await sql`
        INSERT INTO bookings
        (room_name, booking_date, booking_hour, user_name, reason, teacher_name, kelas)
        VALUES
        (${detectedRoom}, ${date}, ${detectedHour}, ${user_name}, 'Tempah melalui AI', ${teacher_name}, ${kelas})
      `;

      // 🔹 OPTIONAL TELEGRAM
      if (telegram_id) {
        try {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegram_id,
              text: `✅ Tempahan berjaya

Bilik: ${detectedRoom}
Tarikh: ${date}
Masa: ${detectedHour}:00
Guru: ${teacher_name}
Kelas: ${kelas}`
            })
          });
        } catch (e) {
          console.log("Telegram error:", e);
        }
      }

      return res.json({
        reply: `✅ Tempahan berjaya!

Bilik: ${detectedRoom}
Masa: ${detectedHour}:00`
      });
    }

    // 🔥 NORMAL AI RESPONSE
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    const bookingSummary = bookings.map(b =>
      `- ${b.room_name} pukul ${b.booking_hour}:00 (${b.user_name})`
    ).join("\n");

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `
Anda pembantu sistem tempahan bilik.

Tarikh: ${date}

Senarai tempahan:
${bookingSummary}

Semua bilik:
${JSON.stringify(allRooms)}

Arahan:
- Jika user tanya bilik kosong → jawab berdasarkan data
- Jika tanya masa → gunakan booking_hour
- Jawab ringkas dalam Bahasa Melayu
`
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 0.3,
    });

    const reply = completion.choices[0]?.message?.content || "Tiada jawapan";

    return res.json({ reply });

  } catch (error) {

    console.error("AI ERROR:", error);

    return res.status(500).json({
      error: error.message || "Server error"
    });

  }
}
