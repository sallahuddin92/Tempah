export default function handler(req, res) {

  const rooms = [
    { id: 1, name: "Bilik Tayang", capacity: 30, type: "hall" },
    { id: 2, name: "Perpustakaan", capacity: 50, type: "hall" },
    { id: 3, name: "Makmal Bahasa", capacity: 40, type: "meeting" }
  ];

  res.status(200).json(rooms);
}
