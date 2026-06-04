import { Router } from 'express';
import { getConfig, saveConfig } from '../services/configService';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const config = await getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    console.error('[Config] GET error:', err);
    res.status(500).json({ success: false, error: 'Failed to load config' });
  }
});

router.put('/', async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ success: false, error: 'Invalid config body' });
    }
    const saved = await saveConfig(updates);
    res.json({ success: true, data: saved });
  } catch (err) {
    console.error('[Config] PUT error:', err);
    res.status(500).json({ success: false, error: 'Failed to save config' });
  }
});

export default router;
