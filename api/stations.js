import { loadTodaySchedule } from './_shared.js';

export default async function handler(_req, res) {
  try {
    const { schedule } = await loadTodaySchedule();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ serviceDate: schedule.date, stations: schedule.stations });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'No se pudo cargar el horario de hoy.' });
  }
}
