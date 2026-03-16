import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL || "";

let sql: any = null;
try {
  if (databaseUrl) {
    sql = neon(databaseUrl);
  }
} catch (e) {
  console.error("Invalid Database URL provided. Neon integration will be disabled.");
}

const hardcodedRooms = [
  { id: 1, name: "Bilik Tayang", capacity: 30, type: "hall" },
  { id: 2, name: "Perpustakaan", capacity: 50, type: "hall" },
  { id: 3, name: "Makmal Bahasa", capacity: 40, type: "meeting" }
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/test-db", async (req, res) => {
    if (!sql) {
      return res.status(500).json({ status: "error", message: "Database URL tidak dikonfigurasi." });
    }
    try {
      const result = await sql`SELECT NOW() as time, version() as version`;
      res.json({ status: "success", data: result[0] });
    } catch (error: any) {
      console.error("DB Test Error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/api/rooms", (req, res) => {
    res.json(hardcodedRooms);
  });

  app.get("/api/availability", async (req, res) => {
    const { date, room_name } = req.query;
    
    if (!date || !room_name) {
      return res.status(400).json({ error: "Sila berikan tarikh dan nama bilik." });
    }

    try {
      let bookings: any[] = [];
      
      if (sql) {
        bookings = await sql`
          SELECT * FROM bookings 
          WHERE booking_date = ${date} 
          AND room_name = ${room_name}
        `;
      }
      
      const slots = [];
      const startMins = 7 * 60 + 30; // 7:30 AM
      const endMins = 16 * 60; // 4:00 PM (so the last slot is 4:00 - 4:30 PM)
      
      for (let mins = startMins; mins <= endMins; mins += 30) {
        const booking = bookings?.find(b => b.booking_hour === mins);
        slots.push({
          hour: mins,
          isBooked: !!booking,
          booking: booking ? {
            id: booking.id,
            room_name: booking.room_name,
            date: booking.booking_date,
            hour: booking.booking_hour,
            user_name: booking.user_name,
            reason: booking.reason,
            created_at: booking.created_at
          } : null
        });
      }

      res.json(slots);
    } catch (error) {
      console.error("Supabase error:", error);
      res.status(500).json({ error: "Gagal mendapatkan ketersediaan." });
    }
  });

  app.post("/api/book", async (req, res) => {
    const { room_name, date, hour, user_name, reason } = req.body;
    
    if (!room_name || !date || hour === undefined || !user_name || !reason) {
      return res.status(400).json({ error: "Maklumat tidak lengkap." });
    }

    if (!sql) {
      return res.status(500).json({ error: "Database tidak dikonfigurasi." });
    }

    try {
      // Check for overlapping bookings
      const overlaps = await sql`
        SELECT * FROM bookings 
        WHERE room_name = ${room_name} 
        AND booking_date = ${date} 
        AND booking_hour = ${hour} 
        LIMIT 1
      `;

      if (overlaps.length > 0) {
        return res.status(409).json({ error: `Slot ini telah ditempah oleh ${overlaps[0].user_name}` });
      }

      // Insert booking
      await sql`
        INSERT INTO bookings (room_name, booking_date, booking_hour, user_name, reason)
        VALUES (${room_name}, ${date}, ${hour}, ${user_name}, ${reason})
      `;

      res.json({ success: true, message: "Tempahan berjaya!" });
    } catch (error: any) {
      console.error("Database error detail:", error);
      res.status(500).json({ error: error.message || "Gagal membuat tempahan." });
    }
  });

  app.delete("/api/book/:id", async (req, res) => {
    const { id } = req.params;
    const { user_name } = req.body;

    if (!sql) {
      return res.status(500).json({ error: "Database tidak dikonfigurasi." });
    }

    try {
      // Get the booking
      const bookings = await sql`SELECT * FROM bookings WHERE id = ${id} LIMIT 1`;
      const booking = bookings[0];
      
      if (!booking) {
        return res.status(404).json({ error: "Tempahan tidak dijumpai." });
      }

      if (booking.user_name !== user_name) {
        return res.status(403).json({ error: "Anda hanya boleh membatalkan tempahan anda sendiri." });
      }

      // Check if it's at least 15 minutes before the booking time
      const h = Math.floor(booking.booking_hour / 60);
      const m = booking.booking_hour % 60;
      // Format date properly for Date constructor
      const dateStr = booking.booking_date instanceof Date 
        ? booking.booking_date.toISOString().split('T')[0] 
        : booking.booking_date;
      const bookingDateTime = new Date(`${dateStr}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`);
      const now = new Date();
      
      // Calculate difference in minutes
      const diffMs = bookingDateTime.getTime() - now.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 15) {
        return res.status(400).json({ error: "Tempahan hanya boleh dibatalkan 15 minit sebelum masa bermula." });
      }

      // Delete the booking
      await sql`DELETE FROM bookings WHERE id = ${id}`;

      res.json({ success: true, message: "Tempahan berjaya dibatalkan." });
    } catch (error: any) {
      console.error("Database delete error:", error);
      res.status(500).json({ error: error.message || "Gagal membatalkan tempahan." });
    }
  });

  // AI Assistant Route
  app.post("/api/chat", async (req, res) => {
    const { message, date } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key not configured" });
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let bookings: any[] = [];
      if (sql) {
        const queryDate = date || new Date().toISOString().split('T')[0];
        bookings = await sql`SELECT * FROM bookings WHERE booking_date = ${queryDate}`;
      }
      
      const systemInstruction = `You are a helpful assistant for a room and hall booking system.
Current date context: ${date || new Date().toISOString().split('T')[0]}
Available rooms: ${JSON.stringify(hardcodedRooms)}
Current bookings for the day: ${JSON.stringify(bookings || [])}

Help the user find available slots, understand room capacities, or answer questions about existing bookings.
Keep your answers concise and friendly, suitable for a Telegram Mini App interface.
Please reply in Bahasa Melayu.
Do not make up bookings or rooms that don't exist in the context provided.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: message,
        config: {
          systemInstruction,
          temperature: 0.3,
        }
      });

      res.json({ reply: response.text });
    } catch (error) {
      console.error("AI Error:", error);
      res.status(500).json({ error: "Gagal mendapatkan respons AI." });
    }
  });

  // Catch-all for API routes to prevent Vite from serving index.html for API errors
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
