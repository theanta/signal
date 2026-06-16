import { Router } from 'express';
import { login, logout, refresh, me, register } from '../controllers/authController';
import { authenticate } from '../api/middleware/auth';

const router = Router();

router.post('/login', login);
router.post('/logout', logout);
router.post('/refresh', refresh);
router.get('/me', authenticate, me);
// register: open when no users exist (bootstrap), otherwise auth check is inside controller
router.post('/register', register);

export default router;
