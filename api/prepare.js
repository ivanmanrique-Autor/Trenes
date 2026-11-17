import { loadTodaySchedule } from './_shared.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'Falta configurar CRON_SECRET en Vercel.' });
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  try {
    const { schedule, cache } = await loadTodaySchedule();
    return res.status(200).json({
      ok: true,
      serviceDate: schedule.date,
      trainsPrepared: schedule.trips.length,
      cache
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'No se pudo preparar el horario de hoy.' });
  }
}
