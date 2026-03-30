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

    const sql = neon(process.env.DATABASE_URL!);
    const lower = message.toLowerCase();

    // ==========================================
    // 👑 BOT OWNER SUMMARY
    // ==========================================
    if (telegram_id === process.env.BOT_OWNER_ID && (lower.includes("/summary") || lower.includes("ringkasan") || lower.includes("summary"))) {
      
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      const dateStr = startOfMonth.toISOString().split('T')[0];

      const stats = await sql`
        SELECT 
          room_name, 
          COUNT(*) as count
        FROM bookings
        WHERE booking_date >= ${dateStr}
        GROUP BY room_name
        ORDER BY count DESC
      `;

      const topTeacher = await sql`
        SELECT 
          teacher_name, 
          COUNT(*) as count
        FROM bookings
        WHERE booking_date >= ${dateStr}
        GROUP BY teacher_name
        ORDER BY count DESC
        LIMIT 1
      `;

      const total = stats.reduce((acc, curr) => acc + Number(curr.count), 0);

      let summary = `📊 *RINGKASAN TEMPAHAN BULAN INI*\n\n`;
      summary += `📈 *Jumlah Tempahan:* ${total}\n\n`;
      summary += `🏢 *Pecahan Bilik:*\n`;
      stats.forEach(s => {
        summary += `- ${s.room_name}: ${s.count}\n`;
      });
      
      if (topTeacher.length > 0) {
        summary += `\n🏆 *Guru Paling Aktif:* ${topTeacher[0].teacher_name} (${topTeacher[0].count} tempahan)`;
      }

      return res.json({ reply: summary });
    }

    // =========================
    // 🔥 INIT MEMORY
    // =========================
    if (!userMemory[telegram_id]) {
      userMemory[telegram_id] = {};
    }

    const memory = userMemory[telegram_id];

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

    // ==========================================
    // 🤖 LONGCAT AI FALLBACK (General Chat)
    // ==========================================
    if (!memory.room && !lower.includes("tempah") && !lower.includes("bilik")) {
      try {
        const response = await fetch("https://api.longcat.chat/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.LONGCAT_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "LongCat-Flash-Lite",
            messages: [
              { role: "system", content: `You are a helpful assistant for a room booking system. 
                Available rooms: ${allRooms.join(", ")}. 
                Available sessions: 8am - 4pm.
                Current bookings today: ${JSON.stringify(bookings)}.
                Reply in Bahasa Melayu only. Keep it short.` },
              { role: "user", content: message }
            ]
          })
        });
        const data = await response.json();
        if (data.choices && data.choices[0]) {
          return res.json({ reply: data.choices[0].message.content });
        }
      } catch (e) {
        console.error("LongCat AI error:", e);
      }
    }

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

    // 🔹 TELEGRAM LOGIC
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (token) {
      
      // 1. Register/Update current user
      if (telegram_id && telegram_id !== "default_user") {
        try {
          await sql`
            INSERT INTO telegram_users (telegram_id, user_name)
            VALUES (${telegram_id}, ${user_name})
            ON CONFLICT (telegram_id) 
            DO UPDATE SET 
              user_name = EXCLUDED.user_name,
              last_active = NOW()
          `;
        } catch (e) {
          console.error("User registration error (AI):", e);
        }
      }

      const timeSlot = `${memory.hour}:00 - ${memory.hour}:30`;
      
      const personalMsg = `✅ Tempahan berjaya (via AI)!

Bilik: ${memory.room}
Tarikh: ${date}
Masa: ${timeSlot}
Guru: ${teacher_name}
Kelas: ${kelas}`;

      const broadcastMsg = `🤖 *TEMPAHAN AI BARU*

👤 *Penempah:* ${user_name}
🏢 *Bilik:* ${memory.room.toUpperCase()}
📅 *Tarikh:* ${date}
⏰ *Masa:* ${timeSlot}
👨‍🏫 *Guru:* ${teacher_name}
🏫 *Kelas:* ${kelas}
📝 *Aktiviti:* Tempah melalui AI`;

      const sendAction = async (chatId, text, isMarkdown = false) => {
        try {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: text,
              parse_mode: isMarkdown ? "Markdown" : undefined
            })
          });
        } catch (e) {
          console.error(`Telegram AI broadcast error for ${chatId}:`, e);
        }
      };

      const tasks = [];
      
      // 2. Personal Confirmation
      if (telegram_id && telegram_id !== "default_user") {
        tasks.push(sendAction(telegram_id, personalMsg));
      }

      // 3. Broadcast to ALL
      try {
        const recipients = await sql`SELECT telegram_id FROM telegram_users`;
        recipients.forEach((u: any) => {
          if (u.telegram_id !== telegram_id) {
            tasks.push(sendAction(u.telegram_id, broadcastMsg, true));
          }
        });
      } catch (e) {
        console.error("Broadcast fetch error (AI):", e);
      }

      // 4. Send to Shared Group (New)
      const groupChatId = process.env.TELEGRAM_CHAT_ID;
      if (groupChatId) {
        tasks.push(sendAction(groupChatId, broadcastMsg, true));
      }

      await Promise.allSettled(tasks);
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
