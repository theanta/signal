import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { healthCheck as signalEngineHealthCheck } from '../services/signalEngineService';

const router = Router();

router.get('/', async (_req, res) => {
  const [supabaseResult, signalResult] = await Promise.allSettled([
    (async () => {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error('Missing SUPABASE env vars');
      const client = createClient(url, key);
      const { error } = await client.from('leads').select('id').limit(1);
      if (error) throw error;
    })(),
    signalEngineHealthCheck(),
  ]);

  res.json({
    supabase: supabaseResult.status === 'fulfilled' ? 'ok' : 'error',
    groq: process.env.GROQ_API_KEY ? 'ok' : 'error',
    signal_engine:
      signalResult.status === 'fulfilled' && signalResult.value ? 'ok' : 'error',
  });
});

export default router;
