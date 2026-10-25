/* eslint-disable no-restricted-imports -- authentication necessarily runs
   before a tenant context exists: it is what produces one. */
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabaseAdmin } from '../services/supabaseAdmin';
import type { AuthUser, JwtPayload, LoginRequest, RegisterRequest } from '../../shared/types';
import {
  AccountError, changePassword as changeUserPassword, describeLink, setPasswordWithLink,
} from '../services/accountService';

const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY ?? '15m';
const REFRESH_EXPIRY_DAYS = 30;
const REFRESH_COOKIE = 'refreshToken';
// How long a rotated-out refresh token keeps working (see refresh()).
const ROTATION_GRACE_MS = 60_000;

// Pre-computed bcrypt $2a$12$ hash used as a dummy when the user doesn't exist.
// Ensures bcrypt always runs the full KDF so response time doesn't reveal
// whether an email is registered (timing-safe rejection).
const TIMING_SAFE_DUMMY_HASH =
  '$2a$12$LUPbHGEgNDNTfB3KsJsXX.ZtVGMBMGMBbKU8s8P2FT8G4VFPqHrym';

function generateAccessToken(user: AuthUser): string {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    org_id: user.org_id,
    email: user.email,
    name: user.name,
    role: user.role,
    ...(user.must_change_password ? { must_change_password: true } : {}),
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

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('*, organizations(status)')
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

  if (user.organizations?.status === 'suspended') {
    res.status(403).json({ success: false, error: 'Your organization is suspended. Contact the Signal team.' });
    return;
  }

  await startSession(res, user);
}

/** Row shape of a users select, as login and set-password read it. */
interface UserRow {
  id: string; org_id: string; email: string; name: string; role: AuthUser['role'];
  is_platform_admin?: boolean; must_change_password?: boolean; last_login?: string; created_at: string;
}

function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    org_id: user.org_id,
    email: user.email,
    name: user.name,
    role: user.role,
    is_platform_admin: Boolean(user.is_platform_admin),
    must_change_password: Boolean(user.must_change_password),
    last_login: user.last_login,
    created_at: user.created_at,
  };
}

/** Sign the user in: last_login, a fresh refresh token cookie, an access token. */
async function startSession(res: Response, user: UserRow): Promise<void> {
  await supabaseAdmin
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', user.id);

  const authUser = toAuthUser(user);
  const accessToken = generateAccessToken(authUser);
  const { raw, hash } = generateRefreshToken();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);

  await supabaseAdmin.from('refresh_tokens').insert({
    user_id: user.id,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  });

  // Purge this user's expired tokens so the table doesn't grow unbounded.
  // Fire-and-forget — a failure here doesn't affect the response.
  supabaseAdmin
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
    await supabaseAdmin.from('refresh_tokens').delete().eq('token_hash', hash);
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

  const { data: tokenRow, error } = await supabaseAdmin
    .from('refresh_tokens')
    .select('*, users(*, organizations(status))')
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

  if (tokenRow.users.organizations?.status === 'suspended') {
    clearRefreshCookie(res);
    res.status(401).json({ success: false, error: 'Your organization is suspended' });
    return;
  }

  // Rotate: insert new token FIRST so the session is never left token-less
  // if the subsequent delete fails (e.g. transient Supabase error).
  const newRefresh = generateRefreshToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);

  const { error: insertError } = await supabaseAdmin.from('refresh_tokens').insert({
    user_id: tokenRow.user_id,
    token_hash: newRefresh.hash,
    expires_at: expiresAt.toISOString(),
  });

  if (insertError) {
    res.status(500).json({ success: false, error: 'Failed to rotate session' });
    return;
  }

  // Retire the old token after the new one is safely stored, but not at once:
  // it stays valid for a short grace window. A refresh whose response never
  // reached the browser (a navigation cancelled it, or two tabs refreshed at
  // the same moment) would otherwise leave the browser holding a dead token
  // and sign the user out. Shortening only, so a token already inside its
  // window is never extended.
  const graceEnd = new Date(Date.now() + ROTATION_GRACE_MS);
  if (new Date(tokenRow.expires_at) > graceEnd) {
    await supabaseAdmin.from('refresh_tokens').update({ expires_at: graceEnd.toISOString() }).eq('token_hash', hash);
  }

  const authUser = toAuthUser(tokenRow.users);


  const accessToken = generateAccessToken(authUser);
  setRefreshCookie(res, newRefresh.raw);
  res.json({ success: true, data: { accessToken, user: authUser } });
}

export async function me(req: Request, res: Response): Promise<void> {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, org_id, email, name, role, is_platform_admin, must_change_password, last_login, created_at')
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

  // Bootstrap: the very first user creates nothing here — the org must already
  // exist, created by scripts/create-org.ts. Otherwise the caller's own org is
  // the org the new user joins; there is no cross-org user creation.
  let orgId: string;

  const { count } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true });

  const isBootstrap = count === 0;

  if (isBootstrap) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (!org) {
      res.status(409).json({
        success: false,
        error: 'No organization exists. Run scripts/create-org.ts first.',
      });
      return;
    }
    orgId = org.id;
  } else {
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
      // The new user joins the ADMIN'S org, taken from the verified token —
      // never from the request body. There is no cross-org user creation.
      //
      // register() verifies its own token rather than running behind
      // `authenticate`, so it has to repeat that middleware's pre-cutover
      // check: an admin token minted before the cutover carries no org_id,
      // and creating a user with an undefined org is exactly the orphan row
      // the NOT NULL constraint exists to prevent.
      if (!payload.org_id) {
        res.status(401).json({ success: false, error: 'Session predates tenancy — please log in again' });
        return;
      }
      orgId = payload.org_id;
    } catch {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }
  }

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (existing) {
    res.status(409).json({ success: false, error: 'A user with that email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { data: newUser, error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      org_id: orgId,
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      name: name.trim(),
      role: isBootstrap ? 'admin' : role,
    })
    .select('id, org_id, email, name, role, created_at')
    .single();

  if (insertError || !newUser) {
    res.status(500).json({ success: false, error: 'Failed to create user' });
    return;
  }

  res.status(201).json({ success: true, data: { user: newUser } });
}

// ---- passwords ----

function accountFail(res: Response, err: unknown): void {
  const status = err instanceof AccountError ? err.status : 500;
  res.status(status).json({ success: false, error: (err as Error).message });
}

/** The signed-in user changes their password; other sessions end, this one restarts. */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const { current_password, new_password } = req.body as { current_password?: string; new_password?: string };
  if (!current_password || !new_password) {
    res.status(400).json({ success: false, error: 'Current and new password required' });
    return;
  }
  try {
    await changeUserPassword(req.user!.sub, current_password, new_password);
    const { data: user } = await supabaseAdmin.from('users').select('*').eq('id', req.user!.sub).single();
    await startSession(res, user as UserRow);
  } catch (err) {
    accountFail(res, err);
  }
}

/** What the set-password page shows for an invite link. */
export async function getInvite(req: Request, res: Response): Promise<void> {
  try {
    const invite = await describeLink(req.params.token);
    if (!invite) {
      res.status(404).json({ success: false, error: 'This link is invalid or has expired. Ask your admin for a new invite.' });
      return;
    }
    res.json({ success: true, data: invite });
  } catch (err) {
    accountFail(res, err);
  }
}

/** Use an invite link: set the password and sign in. */
export async function setPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) {
    res.status(400).json({ success: false, error: 'Token and password required' });
    return;
  }
  try {
    const userId = await setPasswordWithLink(token, password);
    const { data: user } = await supabaseAdmin.from('users').select('*').eq('id', userId).single();
    await startSession(res, user as UserRow);
  } catch (err) {
    accountFail(res, err);
  }
}
