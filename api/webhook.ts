import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.BOT_OWNER_ID;
  const longcatKey = process.env.LONGCAT_API_KEY;

  try {
    const update = req.body;
    
    // Check if it's a message
    if (!update.message || !update.message.text) {
      return res.status(200).send("OK");
    }

    const chatId = update.message.chat.id.toString();
    const userId = update.message.from.id.toString();
    const userText = update.message.text;
    const lowerText = userText.toLowerCase();

    const sql = neon(process.env.DATABASE_URL!);

    // ==========================================
    // 👑 BOT OWNER SUMMARY
    // ==========================================
    if (userId === ownerId && (lowerText.includes("/summary") || lowerText.includes("ringkasan") || lowerText.includes("summary"))) {
      
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

      await sendTelegramMessage(token, chatId, summary, true);
      return res.status(200).send("OK");
    }

    // ==========================================
    // 🤖 LONGCAT AI CHAT
    // ==========================================
    try {
      const aiResponse = await fetch("https://api.longcat.chat/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${longcatKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "LongCat-Flash-Lite",
          messages: [
            { role: "system", content: "You are a helpful assistant for a room booking system. Reply in Bahasa Melayu only. Keep it short." },
            { role: "user", content: userText }
          ]
        })
      });

      const data = await aiResponse.json();
      const reply = data.choices?.[0]?.message?.content || "Maaf, saya menghadapi ralat AI.";
      
      await sendTelegramMessage(token, chatId, reply);
    } catch (e) {
      console.error("Webhook AI error:", e);
      await sendTelegramMessage(token, chatId, "Maaf, sistem AI sedang sibuk.");
    }

    return res.status(200).send("OK");

  } catch (error: any) {
    console.error("Webhook error:", error);
    return res.status(200).send("OK"); // Always return 200 to Telegram
  }
}

async function sendTelegramMessage(token, chatId, text, isMarkdown = false) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: isMarkdown ? "Markdown" : undefined
    })
  });
}
