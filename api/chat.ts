import Groq from "groq-sdk";
import { neon } from "@neondatabase/serverless";

// 🔥 MEMORY STORE (simple)
const userMemory = {};

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
      telegram_id = "default_user"
    } = req.body;

    const sql = neon(process.env.DATABASE_URL);

    // =========================
    // 🔥 INIT MEMORY
    // =========================
    if (!userMemory[telegram_id]) {
      userMemory[telegram_id] = {};
    }

    const memory = userMemory[telegram_id];

    const lower = message.toLowerCase();

    const allRooms = [
      "Perpustakaan",
      "Bilik Tayang",
      "Makmal Bahasa",
      "Bilik Mesyuarat 2"
    ];

    const allHours = [8,9,10,11,12,13,14,15];

    // =========================
    // 🔥 BM PARSER
    // =========================

    // ROOM
    if (lower.includes("tayang")) memory.room = "Bilik Tayang";
    else if (lower.includes("perpustakaan")) memory.room = "Perpustakaan";
    else if (lower.includes("bahasa")) memory.room = "Makmal Bahasa";
    else if (lower.includes("mesyuarat")) memory.room = "Bilik Mesyuarat 2";

    // HOUR
    const match = lower.match(/(\d{1,2})/);
    if (match) {
      let h = parseInt(match[1]);

      if (lower.includes("petang") && h < 12) h += 12;
      if (lower.includes("malam") && h < 12) h += 12;

      memory.hour = h;
    }

    // =========================
    // 🔥 GET BOOKINGS
    // =========================
    const bookings = await sql`
      SELECT room_name, booking_hour, user_name
      FROM bookings
      WHERE booking_date = ${date}
    `;

    const roomMap = {};

    bookings.forEach(b => {
      if (!roomMap[b.room_name]) roomMap[b.room_name] = [];
      roomMap[b.room_name].push(b.booking_hour);
    });

    const availableRooms = allRooms.filter(r => {
      const booked = roomMap[r] || [];
      return booked.length < allHours.length;
    });

    // =========================
    // 🔥 MULTI-TURN FLOW
    // =========================

    // STEP 1: no room
    if (!memory.room) {
      return res.json({
        reply: `Bilik yang tersedia: ${availableRooms.join(", ")}. Nak bilik mana?`
      });
    }

    // STEP 2: no hour
    if (!memory.hour) {
      return res.json({
        reply: `Pukul berapa untuk ${memory.room}?`
      });
    }

    const bookedHours = roomMap[memory.room] || [];

    // STEP 3: slot penuh
    if (bookedHours.includes(memory.hour)) {
      return res.json({
        reply: `❌ ${memory.room} pukul ${memory.hour}:00 sudah ditempah. Pilih masa lain.`
      });
    }

    // =========================
    // 🔥 AUTO BOOKING
    // =========================
    console.log("BOOKING DATA:", memory.room, memory.hour, date);
    
    const result = await sql`
      INSERT INTO bookings
      (room_name, booking_date, booking_hour, user_name, reason, teacher_name, kelas)
      VALUES
      (${memory.room}, ${date}, ${memory.hour}, ${user_name}, 'Tempah melalui AI', ${teacher_name}, ${kelas})
      RETURNING *
    `;
    
    console.log("INSERT RESULT:", result);
    
    if (!result || result.length === 0) {
      return res.status(500).json({
        reply: "❌ Gagal simpan ke database"
      });
    }

    // 🔹 CLEAR MEMORY selepas booking
    userMemory[telegram_id] = {};

    // 🔹 TELEGRAM CONFIRM
    if (telegram_id !== "default_user") {
      try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMsg,
            date: format(currentDate, 'yyyy-MM-dd'),
            telegram_id: userId
          })

Bilik: ${memory.room}
Tarikh: ${date}
Masa: ${memory.hour}:00
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

Bilik: ${memory.room}
Masa: ${memory.hour}:00`
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Server error"
    });

  }
}
