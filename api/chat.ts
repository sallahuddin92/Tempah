import Groq from "groq-sdk";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }

  try {

    const { message, date } = req.body;

    const sql = neon(process.env.DATABASE_URL);

    // 🔹 Get bookings for selected date
    const bookings = await sql`
      SELECT * FROM bookings
      WHERE booking_date = ${date}
    `;

    // 🔹 Define ALL rooms (IMPORTANT)
    const allRooms = [
      "Perpustakaan",
      "Bilik Tayang",
      "Makmal Bahasa",
      "Bilik Mesyuarat 2"
    ];

    // 🔹 Extract booked rooms
    const bookedRooms = bookings.map(b => b.room_name);

    // 🔹 Calculate available rooms
    const availableRooms = allRooms.filter(
      r => !bookedRooms.includes(r)
    );

    // 🔹 Init Groq
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // 🔹 AI Response
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `
Anda pembantu sistem tempahan bilik sekolah.

Tarikh: ${date}

Semua bilik:
${JSON.stringify(allRooms)}

Bilik yang telah ditempah:
${JSON.stringify(bookedRooms)}

Bilik yang masih kosong:
${JSON.stringify(availableRooms)}

Arahan:
- Jawab dalam Bahasa Melayu
- Jika ada bilik kosong → senaraikan
- Jika semua penuh → beritahu
- Jawab ringkas dan jelas
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

    return res.status(200).json({ reply });

  } catch (error) {

    console.error("AI ERROR:", error);

    return res.status(500).json({
      error: error.message || "AI error"
    });

  }
}
