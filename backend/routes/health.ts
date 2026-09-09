/* eslint-disable no-restricted-imports -- health probes the database itself,
   before and independent of any tenant session. */
import { Router } from 'express';
import { supabaseAdmin } from '../services/supabaseAdmin';
import { healthCheck as signalEngineHealthCheck } from '../services/signalEngineService';

const router = Router();

router.get('/', async (_req, res) => {
  const [supabaseResult, signalResult] = await Promise.allSettled([
    (async () => {
      const { error } = await supabaseAdmin.from('organizations').select('id').limit(1);
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
