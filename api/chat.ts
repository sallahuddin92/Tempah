import Groq from "groq-sdk";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }

  try {

    const { message, date } = req.body;

    const sql = neon(process.env.DATABASE_URL);

    const bookings = await sql`
      SELECT * FROM bookings
      WHERE booking_date = ${date}
    `;

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    const completion = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content: `
Anda pembantu sistem tempahan bilik sekolah.

Tarikh: ${date}

Tempahan semasa:
${JSON.stringify(bookings)}

Jawab dalam Bahasa Melayu secara ringkas.
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
