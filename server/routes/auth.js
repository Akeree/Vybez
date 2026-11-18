// Health and authentication.
import { store } from '../store.js';
import { route, fail, str, int, bool, now, EMAIL_RE, rateLimit } from '../lib/http.js';
import { hashPassword, checkPassword, makeSession, randomId, randomCode } from '../auth.js';
import { DEFAULT_PREFS, selfUser, getUser, saveUser, claimHandle, readProduct, syncDjIndex } from '../domain/users.js';
import { sendEmail } from '../domain/email.js';

route('GET', 'health', async () => ({
  ok: true,
  storage: store.kind,
  persistent: store.kind !== 'memory',
  email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  sessionSecret: !!process.env.SESSION_SECRET,
}));

// Auth
route('POST', 'auth/signup', async (ctx) => {
  const b = ctx.body;
  const email = str(b.email, { max: 120, name: 'Email', required: true }).toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');
  if (password.length > 200) fail(400, 'That password is too long.');
  const name = str(b.name, { max: 50, name: 'Name', required: true });
  // Which Vybez this account is for. 'role' is the pre-split field name, still accepted.
  const product = readProduct(b.product ?? b.role);
  await rateLimit(`signup:${ctx.ip}`, 10, 3600);
  const id = randomId();
  const taken = !(await store.cmd('SET', `email:${email}`, id, 'NX'));
  if (taken) fail(409, 'There’s already an account with that email. Sign in instead.');
  const handle = await claimHandle(b.handle || name, id);
  const user = {
    id, email, name, handle, product, bio: '', city: '', genres: [], links: {}, software: '',
    prefs: DEFAULT_PREFS, onboarded: false, createdAt: now(), sv: 1, pw: hashPassword(password),
  };
  await saveUser(user);
  await syncDjIndex(user);
  ctx.setCookie(makeSession(user));
  return { user: selfUser(user) };
});

route('POST', 'auth/signin', async (ctx) => {
  const email = str(ctx.body.email, { max: 120, name: 'Email', required: true }).toLowerCase();
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  await rateLimit(`signin:${ctx.ip}:${email}`, 10, 900);
  const id = await store.cmd('GET', `email:${email}`);
  const user = id && await getUser(id);
  if (!user || !checkPassword(password, user.pw)) fail(401, 'That email and password don’t match.');
  ctx.setCookie(makeSession(user));
  return { user: selfUser(user) };
});

route('POST', 'auth/signout', async (ctx) => { ctx.setCookie(''); return { ok: true }; });

route('POST', 'auth/forgot', async (ctx) => {
  const email = str(ctx.body.email, { max: 120, name: 'Email', required: true }).toLowerCase();
  await rateLimit(`forgot:${ctx.ip}`, 5, 900);
  const id = await store.cmd('GET', `email:${email}`);
  const out = { ok: true, emailSent: false };
  if (id) {
    const token = randomId(24);
    await store.cmd('SET', `reset:${token}`, id, 'EX', 3600);
    const link = `${ctx.origin}/reset?token=${token}`;
    out.emailSent = await sendEmail(email, 'Reset your Vybez password', `Someone asked to reset the password for your Vybez account.\n\nReset it here (the link works for 1 hour):\n${link}\n\nIf this wasn’t you, ignore this email.`);
    // Local development only: there is no email service, so hand the link back.
    if (store.kind === 'file') out.devLink = link;
  }
  out.emailConfigured = !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  return out;
});

route('POST', 'auth/reset', async (ctx) => {
  const token = str(ctx.body.token, { max: 64, required: true, name: 'Reset link' });
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (password.length < 8) fail(400, 'Use at least 8 characters for your password.');
  const id = await store.cmd('GET', `reset:${token}`);
  const user = id && await getUser(id);
  if (!user) fail(400, 'This reset link has expired. Ask for a new one.');
  user.pw = hashPassword(password);
  user.sv = (user.sv || 1) + 1;
  await saveUser(user);
  await store.cmd('DEL', `reset:${token}`);
  ctx.setCookie(makeSession(user));
  return { user: selfUser(user) };
});
