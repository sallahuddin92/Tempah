import Groq from "groq-sdk";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }

  try {

    const {
      message,
      date,
      user_name = "Guest",
      teacher_name = "Unknown",
      kelas = "N/A",
      telegram_id
    } = req.body;

    const sql = neon(process.env.DATABASE_URL);

    const allRooms = [
      "Perpustakaan",
      "Bilik Tayang",
      "Makmal Bahasa",
      "Bilik Mesyuarat 2"
    ];

    const allHours = [8,9,10,11,12,13,14,15];

    // 🔹 GET BOOKINGS
    const bookings = await sql`
      SELECT room_name, booking_hour, user_name
      FROM bookings
      WHERE booking_date = ${date}
    `;

    // =========================
    // 🔥 BM PARSER (SMART)
    // =========================
    const lower = message.toLowerCase();

    // 🔹 ROOM DETECTION (fuzzy)
    let detectedRoom = null;

    if (lower.includes("tayang")) detectedRoom = "Bilik Tayang";
    else if (lower.includes("perpustakaan")) detectedRoom = "Perpustakaan";
    else if (lower.includes("bahasa")) detectedRoom = "Makmal Bahasa";
    else if (lower.includes("mesyuarat")) detectedRoom = "Bilik Mesyuarat 2";

    // 🔹 HOUR DETECTION (BM)
    let detectedHour = null;

    const hourMatch = lower.match(/(\d{1,2})/);
    if (hourMatch) {
      let h = parseInt(hourMatch[1]);

      if (lower.includes("petang") && h < 12) h += 12;
      if (lower.includes("malam") && h < 12) h += 12;

      detectedHour = h;
    }

    // =========================
    // 🔥 AUTO LOGIC
    // =========================

    // 🔹 GROUP bookings by room
    const roomMap = {};

    bookings.forEach(b => {
      if (!roomMap[b.room_name]) {
        roomMap[b.room_name] = [];
      }
      roomMap[b.room_name].push(b.booking_hour);
    });

    // 🔹 find available rooms
    const availableRooms = allRooms.filter(r => {
      const booked = roomMap[r] || [];
      return booked.length < allHours.length;
    });

    // =========================
    // 🔥 AUTO BOOKING FLOW
    // =========================

    if (lower.includes("tempah")) {

      // 🔹 kalau user tak bagi bilik → auto suggest
      if (!detectedRoom) {
        return res.json({
          reply: `Bilik yang tersedia: ${availableRooms.join(", ")}. Sila pilih bilik.`
        });
      }

      const bookedHours = roomMap[detectedRoom] || [];
      const freeHours = allHours.filter(h => !bookedHours.includes(h));

      // 🔹 kalau tak bagi masa → auto pilih terbaik
      if (detectedHour === null) {
        if (freeHours.length === 0) {
          return res.json({
            reply: `❌ ${detectedRoom} sudah penuh hari ini.`
          });
        }

        detectedHour = freeHours[0];
      }

      // 🔹 check slot
      if (bookedHours.includes(detectedHour)) {
        return res.json({
          reply: `❌ Slot ${detectedHour}:00 untuk ${detectedRoom} sudah ditempah.`
        });
      }

      // 🔹 INSERT
      await sql`
        INSERT INTO bookings
        (room_name, booking_date, booking_hour, user_name, reason, teacher_name, kelas)
        VALUES
        (${detectedRoom}, ${date}, ${detectedHour}, ${user_name}, 'Tempah melalui AI', ${teacher_name}, ${kelas})
      `;

      // 🔥 TELEGRAM CONFIRM
      if (telegram_id) {
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
      }

      return res.json({
        reply: `✅ Tempahan berjaya!

Bilik: ${detectedRoom}
Masa: ${detectedHour}:00`
      });
    }

    // =========================
    // 🔥 AI RESPONSE MODE
    // =========================

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

Data tempahan:
${bookingSummary}

Jawab dalam Bahasa Melayu.
`
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 0.3,
    });

    return res.json({
      reply: completion.choices[0]?.message?.content
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Server error"
    });

  }
}
