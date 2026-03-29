import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const sql = neon(process.env.DATABASE_URL);

    const { room_name, date, hour, user_name, reason, teacher_name, kelas, telegram_id } = req.body;

    // VALIDATION
    if (!room_name || !date || hour === undefined || !user_name || !reason || !teacher_name || !kelas) {
      return res.status(400).json({ error: "Maklumat tidak lengkap." });
    }

    // CHECK SLOT
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
      (room_name, booking_date, booking_hour, user_name, reason, teacher_name, kelas)
      VALUES
      (${room_name}, ${date}, ${hour}, ${user_name}, ${reason}, ${teacher_name}, ${kelas})
    `;

    // FORMAT TIME
    const startH = Math.floor(hour / 60);
    const startM = hour % 60;
    const endH = Math.floor((hour + 30) / 60);
    const endM = (hour + 30) % 60;

    const timeSlot = `${startH}:${startM.toString().padStart(2,"0")} - ${endH}:${endM.toString().padStart(2,"0")}`;

    // TELEGRAM LOGIC
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (token) {
      
      // 1. Register/Update Current User in 'telegram_users'
      if (telegram_id) {
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
          console.error("User registration error:", e);
        }
      }

      // 2. Prepare Messages
      const personalMsg = `Hi ${user_name}~
  
Tempahan berjaya dibuat

Bilik Tempahan: ${room_name.toUpperCase()}
Tarikh Tempahan: ${date}
Sesi Tempahan: ${timeSlot}
Guru: ${teacher_name}
Kelas: ${kelas}
Aktiviti: ${reason}
`;

      const broadcastMsg = `🔔 *TEMPAHAN BARU*

👤 *Pempah:* ${user_name}
🏢 *Bilik:* ${room_name.toUpperCase()}
📅 *Tarikh:* ${date}
⏰ *Masa:* ${timeSlot}
👨‍🏫 *Guru:* ${teacher_name}
🏫 *Kelas:* ${kelas}
📝 *Aktiviti:* ${reason}
`;

      // Helper for async Telegram calls
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
        } catch (err) {
          console.error(`Telegram failed for ${chatId}:`, err);
        }
      };

      const tasks = [];
      
      // 3. Send Personal Confirmation
      if (telegram_id) {
        tasks.push(sendAction(telegram_id, personalMsg));
      }

      // 4. Broadcast to ALL Registered Users
      try {
        const recipients = await sql`SELECT telegram_id FROM telegram_users`;
        
        recipients.forEach((u: any) => {
          // Send broadcast to all users except perhaps the booker? 
          // Actually, let's just send to everyone so they see the notification.
          // But to avoid duplicate pings for the booker, we can skip them if we want.
          if (u.telegram_id !== telegram_id) {
            tasks.push(sendAction(u.telegram_id, broadcastMsg, true));
          }
        });
      } catch (e) {
        console.error("Broadcast fetch error:", e);
      }

      // Run all notifications independently
      await Promise.allSettled(tasks);
    }

    return res.status(200).json({
      success: true
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Server error"
    });

  }
}
