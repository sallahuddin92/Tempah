import { GoogleGenAI } from "@google/genai";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

  try {

    const { message, date } = req.body;

    const sql = neon(process.env.DATABASE_URL);

    const bookings = await sql`
      SELECT * FROM bookings
      WHERE booking_date = ${date}
    `;

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: message,
      config: {
        systemInstruction: `
Anda pembantu sistem tempahan bilik.

Tarikh: ${date}

Tempahan semasa:
${JSON.stringify(bookings)}

Jawab ringkas dalam Bahasa Melayu.
`
      }
    });

    res.json({
      reply: response.text
    });

  } catch (error) {

    res.status(500).json({
      error: error.message
    });

  }

}
