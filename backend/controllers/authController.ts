import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabase } from '../services/supabaseService';
import type { AuthUser, JwtPayload, LoginRequest, RegisterRequest } from '../../shared/types';

const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY ?? '15m';
const REFRESH_EXPIRY_DAYS = 30;
const REFRESH_COOKIE = 'refreshToken';

// Pre-computed bcrypt $2a$12$ hash used as a dummy when the user doesn't exist.
// Ensures bcrypt always runs the full KDF so response time doesn't reveal
// whether an email is registered (timing-safe rejection).
const TIMING_SAFE_DUMMY_HASH =
  '$2a$12$LUPbHGEgNDNTfB3KsJsXX.ZtVGMBMGMBbKU8s8P2FT8G4VFPqHrym';

function generateAccessToken(user: AuthUser): string {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: ACCESS_EXPIRY } as jwt.SignOptions);
}

function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(64).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

const isProd = process.env.NODE_ENV === 'production';

// SameSite=None;Secure is required for cross-origin fetch with credentials:include.
// In production the frontend and backend are on different Render domains, so Lax
// blocks the cookie entirely (Lax only allows cookies on top-level navigations,
// not fetch/XHR). In dev both run on localhost so Lax works fine, and None
// requires Secure which isn't available on plain http.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
} as const;

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...COOKIE_OPTS,
    maxAge: REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTS);
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginRequest;

  if (!email || !password) {
    res.status(400).json({ success: false, error: 'Email and password required' });
    return;
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .eq('is_active', true)
    .single();

  // Always run bcrypt — even when the user doesn't exist — so response time
  // doesn't reveal whether the email is registered.
  const hashToCompare = (error || !user) ? TIMING_SAFE_DUMMY_HASH : user.password_hash;
  const valid = await bcrypt.compare(password, hashToCompare);

  if (error || !user || !valid) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }

  await supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', user.id);

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    last_login: user.last_login,
    created_at: user.created_at,
  };

  const accessToken = generateAccessToken(authUser);
  const { raw, hash } = generateRefreshToken();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);

  await supabase.from('refresh_tokens').insert({
    user_id: user.id,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  });

  // Purge this user's expired tokens so the table doesn't grow unbounded.
  // Fire-and-forget — a failure here doesn't affect the login response.
  supabase
    .from('refresh_tokens')
    .delete()
    .eq('user_id', user.id)
    .lt('expires_at', new Date().toISOString())
    .then(() => {});

  setRefreshCookie(res, raw);
  res.json({ success: true, data: { user: authUser, accessToken } });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const raw = req.cookies?.[REFRESH_COOKIE];

  if (raw) {
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    await supabase.from('refresh_tokens').delete().eq('token_hash', hash);
  }

  clearRefreshCookie(res);
  res.json({ success: true, message: 'Logged out' });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) {
    res.status(401).json({ success: false, error: 'No refresh token' });
    return;
  }

  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  const { data: tokenRow, error } = await supabase
    .from('refresh_tokens')
    .select('*, users(*)')
    .eq('token_hash', hash)
    .single();

  if (error || !tokenRow || new Date(tokenRow.expires_at) < new Date()) {
    clearRefreshCookie(res);
    res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    return;
  }

  if (!tokenRow.users?.is_active) {
    clearRefreshCookie(res);
    res.status(401).json({ success: false, error: 'Account deactivated' });
    return;
  }

  // Rotate: insert new token FIRST so the session is never left token-less
  // if the subsequent delete fails (e.g. transient Supabase error).
  const newRefresh = generateRefreshToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);

  const { error: insertError } = await supabase.from('refresh_tokens').insert({
    user_id: tokenRow.user_id,
    token_hash: newRefresh.hash,
    expires_at: expiresAt.toISOString(),
  });

  if (insertError) {
    res.status(500).json({ success: false, error: 'Failed to rotate session' });
    return;
  }

  // Delete old token after the new one is safely stored.
  await supabase.from('refresh_tokens').delete().eq('token_hash', hash);

  const authUser: AuthUser = {
    id: tokenRow.users.id,
    email: tokenRow.users.email,
    name: tokenRow.users.name,
    role: tokenRow.users.role,
    last_login: tokenRow.users.last_login,
    created_at: tokenRow.users.created_at,
  };

  const accessToken = generateAccessToken(authUser);
  setRefreshCookie(res, newRefresh.raw);
  res.json({ success: true, data: { accessToken, user: authUser } });
}

export async function me(req: Request, res: Response): Promise<void> {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, name, role, last_login, created_at')
    .eq('id', req.user!.sub)
    .single();

  if (error || !user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  res.json({ success: true, data: { user } });
}

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password, name, role = 'member' } = req.body as RegisterRequest;

  if (!email || !password || !name) {
    res.status(400).json({ success: false, error: 'Email, password, and name required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    return;
  }

  // Bootstrap: allow first user without auth; otherwise require admin token
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });

  const isBootstrap = count === 0;

  if (!isBootstrap) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
      if (payload.role !== 'admin') {
        res.status(403).json({ success: false, error: 'Admin access required to create users' });
        return;
      }
    } catch {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (existing) {
    res.status(409).json({ success: false, error: 'A user with that email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { data: newUser, error: insertError } = await supabase
    .from('users')
    .insert({
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      name: name.trim(),
      role: isBootstrap ? 'admin' : role,
    })
    .select('id, email, name, role, created_at')
    .single();

  if (insertError || !newUser) {
    res.status(500).json({ success: false, error: 'Failed to create user' });
    return;
  }

  res.status(201).json({ success: true, data: { user: newUser } });
}
