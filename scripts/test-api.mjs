// End-to-end API check against the in-memory store: node scripts/test-api.mjs
process.env.VYBEZ_STORE = 'memory';
process.env.DJ_OPEN = '1'; // most checks cover Vybez DJ; the Social-first launch is checked at the end
const { handle } = await import('../server/api.js');
let failures = 0;
const jar = {};
async function call(who, method, path, body) {
  const headers = { 'content-type': 'application/json', host: 'localhost:3000' };
  const mine = jar[who] || (jar[who] = {});
  const cookie = Object.entries(mine).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookie) headers.cookie = cookie;
  const res = await handle(new Request(`http://localhost:3000/api/${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }));
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) { const [k, v] = c.split(';')[0].split('='); mine[k] = v || null; }
  return { status: res.status, data: await res.json(), set };
}
function check(name, cond, extra) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra)); }
}

let r = await call('dj', 'POST', 'auth/signup', { email: 'kemi@test.dev', password: 'short', name: 'Kemi' });
check('rejects short password', r.status === 400);
r = await call('dj', 'POST', 'auth/signup', { email: 'kemi@test.dev', password: 'longenough1', name: 'DJ Kemi', role: 'dj' });
check('signup', r.status === 200 && r.data.user.handle === 'dj-kemi', r.data);
r = await call('x', 'POST', 'auth/signup', { email: 'KEMI@test.dev', password: 'longenough1', name: 'Other' });
check('duplicate email blocked', r.status === 409);
r = await call('dj', 'GET', 'me');
check('me', r.data.user?.email === 'kemi@test.dev');
r = await call('dj', 'PATCH', 'me', { handle: 'kemi-lagos', city: 'Lagos', genres: ['Afrobeats'], onboarded: true });
check('update profile + handle', r.data.user?.handle === 'kemi-lagos', r.data);
r = await call('dj', 'POST', 'sets', { title: 'Rooftop Sunday', tracks: [{ a: 'Burna Boy', t: 'Last Last', bpm: 104 }, { a: 'Rema', t: 'Calm Down' }] });
check('create set', r.data.set?.tracks.length === 2, r.data);
const setId = r.data.set.id;
r = await call('anon', 'GET', `sets/${setId}`);
check('draft hidden from public', r.status === 404);
r = await call('dj', 'PATCH', `sets/${setId}`, { status: 'published' });
check('publish', r.data.set?.status === 'published');
r = await call('anon', 'GET', `sets/${setId}`);
check('public can view', r.status === 200 && r.data.dj.handle === 'kemi-lagos');
r = await call('anon', 'POST', `sets/${setId}/comments`, { name: 'Tolu', text: 'Crazy blend' });
check('guest comment', r.status === 200);
r = await call('anon', 'POST', `sets/${setId}/react`, { emoji: '🔥' });
check('react', r.data.count === 1);

r = await call('fan', 'POST', 'auth/signup', { email: 'fan@test.dev', password: 'longenough1', name: 'Ada Fan', product: 'dj' });
check('fan signup on Vybez DJ', r.status === 200 && r.data.user.product === 'dj');
check('signup sets the product hint cookie', jar.fan.vz_product === 'dj' && r.set.some((c) => /^vz_product=dj;.*SameSite=Lax/.test(c) && !/HttpOnly/i.test(c)), r.set);
r = await call('host', 'POST', 'auth/signup', { email: 'host@test.dev', password: 'longenough1', name: 'Tobi Host', product: 'social' });
check('host signup on Vybez Social', r.status === 200 && r.data.user.product === 'social');
r = await call('legacy', 'POST', 'auth/signup', { email: 'old@test.dev', password: 'longenough1', name: 'Old Client', role: 'listener' });
check('pre-split role "listener" maps to Social', r.data.user?.product === 'social');
r = await call('fan', 'POST', 'users/kemi-lagos/follow');
check('follow', r.data.following === true && r.data.followers === 1);
r = await call('fan', 'POST', `sets/${setId}/save`);
check('save set', r.data.saved === true);
r = await call('fan', 'GET', 'me/saved');
check('saved list', r.data.sets.length === 1 && r.data.following.length === 1);
r = await call('dj', 'GET', 'notifications');
check('notifications', r.data.items.length >= 3, r.data.items.map((i) => i.type));
r = await call('anon', 'GET', 'users/kemi-lagos');
check('profile', r.data.sets.length === 1 && r.data.followers === 1);
r = await call('anon', 'GET', 'explore');
check('explore lists dj + set', r.data.djs.length === 1 && r.data.sets.length === 1, r.data);

r = await call('dj', 'POST', 'live/start', { title: 'Rooftop live', setId });
check('go live', r.data.live?.on && r.data.live.queue.length === 2);
r = await call('dj', 'POST', 'live/now', { queueIndex: 0 });
check('now playing from queue', r.data.live.now.t === 'Last Last');
r = await call('dj', 'POST', 'live/now', { track: { a: 'Tyla', t: 'Water' } });
check('now playing by hand', r.data.live.played.length === 1);
r = await call('anon', 'POST', 'live/kemi-lagos/react', { emoji: '🙌' });
check('live react', r.data.count === 1);
r = await call('anon', 'POST', 'live/kemi-lagos/comment', { name: 'Seyi', text: 'Play Rush!', request: true });
check('live comment', r.status === 200);
r = await call('anon', 'GET', 'live/kemi-lagos?since=0');
check('live view', r.data.live.on && r.data.feed.length === 1 && r.data.reactions['🙌'] === 1 && r.data.live.queue.length === 0, r.data);
r = await call('anon', 'GET', 'explore');
check('explore shows live room', r.data.live.length === 1);
r = await call('dj', 'POST', 'live/end', { saveAsSet: true });
check('end live saves draft set', r.data.set?.tracks.length === 2, r.data);

r = await call('dj', 'POST', 'nights', { title: 'x', when: '2030-11-16T19:00', place: 'a', area: 'b' });
check('DJ account cannot create nights', r.status === 403 && r.data.product === 'dj', r.data);
r = await call('host', 'GET', 'sets');
check('Social account cannot list sets', r.status === 403);
r = await call('host', 'POST', 'users/kemi-lagos/follow');
check('Social account cannot follow DJs', r.status === 403);
r = await call('host', 'POST', 'live/start', { title: 'x' });
check('Social account cannot go live', r.status === 403);
r = await call('anon', 'GET', 'users/tobi-host');
check('Social accounts have no public profile', r.status === 404);
r = await call('host', 'POST', 'nights', { title: 'Tobi’s Birthday', when: '2030-11-16T19:00', place: '12 Admiralty Way', area: 'Lekki', cap: 2, approve: true, plusOnes: true });
check('create night', !!r.data.night?.code, r.data);
{
  const old = await call('host', 'POST', 'nights', { title: 'Old', when: '2020-01-01T19:00', place: 'a', area: 'b' });
  check('night in the past is refused', old.status === 400, old.data);
  const nl = await call('host', 'POST', 'nights', { title: 'Line\r\nBREAK:x', when: '2030-11-16T19:00', place: 'a\nb', area: 'c' });
  check('one-line night fields drop line breaks', nl.data.night?.title === 'Line BREAK:x' && nl.data.night?.place === 'a b', nl.data);
  if (nl.data.night) await call('host', 'DELETE', `nights/${nl.data.night.id}`);
}
const night = r.data.night;
{
  // Link previews: /i/:code is served with the night's title and picture, never the address.
  const res = await handle(new Request(`http://localhost:3000/api?route=page/invite/${night.code}`, { headers: { host: 'localhost:3000' } }));
  const html = await res.text();
  check('invite page preview names the night', res.status === 200 && /<title>Tobi’s Birthday · You’re invited<\/title>/.test(html) && /og:description" content="Tobi Host invited you: Sat 16 Nov, 7:00 pm · Lekki/.test(html), html.match(/<title>.*<\/title>|og:description" content="[^"]*"/g));
  check('invite page preview hides the address', !html.includes('Admiralty'));
}
{
  // The host's own cover photo: upload, serve, preview, guards, remove.
  const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]).toString('base64')}`;
  let p = await call('host', 'PUT', `nights/${night.id}/photo`, { image: jpeg });
  check('host uploads a cover photo', p.status === 200 && p.data.night.cover === 'photo' && /^\/photo\/[\w-]+\/\w+\.jpg$/.test(p.data.night.photoUrl), p.data);
  const url = p.data.night.photoUrl;
  const img = await handle(new Request(`http://localhost:3000/api?route=${url.slice(1)}`, { headers: { host: 'localhost:3000' } }));
  check('cover photo is served as a cacheable JPEG', img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && /immutable/.test(img.headers.get('cache-control')) && (await img.arrayBuffer()).byteLength === 2004);
  const stale = await handle(new Request(`http://localhost:3000/api?route=photo/${night.id}/oldversion.jpg`, { headers: { host: 'localhost:3000' } }));
  check('an old photo version is a 404', stale.status === 404);
  const html = await (await handle(new Request(`http://localhost:3000/api?route=page/invite/${night.code}`, { headers: { host: 'localhost:3000' } }))).text();
  check('WhatsApp preview uses the host’s photo', html.includes(`og:image" content="http://localhost:3000${url}"`), html.match(/og:image" content="[^"]*"/)?.[0]);
  const inv = await call('anon', 'GET', `invites/${night.code}`);
  check('guests see the host’s photo', inv.data.invite.cover === 'photo' && inv.data.invite.photo === url, inv.data.invite);
  check('a PNG or other file is refused', (await call('host', 'PUT', `nights/${night.id}/photo`, { image: 'data:image/png;base64,iVBORw0KGgo=' })).status === 400);
  check('a fake JPEG is refused', (await call('host', 'PUT', `nights/${night.id}/photo`, { image: `data:image/jpeg;base64,${Buffer.alloc(2000, 1).toString('base64')}` })).status === 400);
  check('a huge photo is refused', [413].includes((await call('host', 'PUT', `nights/${night.id}/photo`, { image: `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(640 * 1024)]).toString('base64')}` })).status));
  check('another account can’t change the photo', (await call('anon', 'PUT', `nights/${night.id}/photo`, { image: jpeg })).status >= 400);
  check('editing the night keeps the photo', (await call('host', 'PATCH', `nights/${night.id}`, { cover: 'photo', note: 'x' })).data.night.cover === 'photo');
  p = await call('host', 'DELETE', `nights/${night.id}/photo`);
  check('host removes the photo, cover goes back to default', p.status === 200 && p.data.night.cover === 'rings' && !p.data.night.photoUrl, p.data);
  const gone = await handle(new Request(`http://localhost:3000/api?route=${url.slice(1)}`, { headers: { host: 'localhost:3000' } }));
  check('removed photo is no longer served', gone.status === 404);
  check('cover can’t be set to photo without one', (await call('host', 'PATCH', `nights/${night.id}`, { cover: 'photo' })).data.night.cover === 'rings');
}
r = await call('anon', 'GET', `invites/${night.code}`);
check('invite hides address', r.status === 200 && !r.data.invite.place);
r = await call('anon', 'POST', `invites/${night.code}/rsvp`, { name: 'Bisi', plus: true });
check('rsvp asks', r.data.invite.guest.status === 'asking', r.data);
const guestToken = r.data.guest;
r = await call('host', 'GET', `nights/${night.id}`);
const gid = r.data.guests[0].id;
check('host sees guest', r.data.guests.length === 1 && !r.data.guests[0].token);
r = await call('host', 'PATCH', `nights/${night.id}/guests/${gid}`, { status: 'going' });
check('approve', r.data.guest?.status === 'going', r.data);
r = await call('anon', 'GET', `invites/${night.code}?guest=${guestToken}`);
check('approved guest sees address + pass', r.data.invite.place === '12 Admiralty Way' && r.data.invite.guest.pass, r.data);
const pass = r.data.invite.guest.pass;
r = await call('anon', 'POST', `invites/${night.code}/rsvp`, { name: 'Femi' });
r = await call('host', 'GET', `nights/${night.id}`);
const femi = r.data.guests.find((g) => g.name === 'Femi');
r = await call('host', 'PATCH', `nights/${night.id}/guests/${femi.id}`, { status: 'going' });
check('cap enforced', r.status === 409, r.data);
r = await call('anon', 'POST', `invites/${night.code}/song`, { guest: guestToken, track: { a: 'Ayra Starr', t: 'Rush' } });
check('add song', r.data.songs?.length === 1);
r = await call('host', 'POST', `nights/${night.id}/checkin`, { pass: pass.toLowerCase() });
check('door check-in', r.data.guest?.checkedIn && r.data.already === false, r.data);
r = await call('legacy', 'GET', `nights/${night.id}`);
check('other hosts cannot see guest list', r.status === 404);
r = await call('host', 'GET', 'notifications');
check('host sees RSVPs only', r.data.items.length >= 1 && r.data.items.every((i) => i.type === 'rsvp'), r.data.items);
r = await call('dj', 'GET', 'notifications');
check('DJ sees no RSVPs', r.data.items.every((i) => i.type !== 'rsvp'));
r = await call('host', 'GET', 'me/export');
check('host export has nights', r.data.nights.length === 1);

// The group: chat, rides (car hop) and moments, only for people on the list.
{
  const g0 = await call('host', 'POST', 'nights', { title: 'Car hop test', when: '2031-05-03T20:00', place: '4 Bourdillon Rd', area: 'Ikoyi', cap: 20, approve: false });
  const gn = g0.data.night;
  const rs = async (name) => (await call('anon', 'POST', `invites/${gn.code}/rsvp`, { name })).data.guest;
  const ada = await rs('Ada Okafor'); const tunde = await rs('Tunde Bakare'); const kola = await rs('Kola');
  const asker = (await call('anon', 'POST', `invites/${night.code}/rsvp`, { name: 'Waiting Wale' })).data.guest;
  let q = await call('anon', 'GET', `invites/${gn.code}/group`);
  check('group is closed without an RSVP', q.status === 403);
  q = await call('anon', 'GET', `invites/${night.code}/group?guest=${asker}`);
  check('group is closed while waiting for approval', q.status === 403 && /approves/.test(q.data.error), q.data);
  q = await call('anon', 'GET', `invites/${gn.code}/group?guest=${ada}`);
  check('approved guest opens the group', q.status === 200 && q.data.me.name === 'Ada O.' && q.data.people.length === 4, q.data);
  check('group never shows contacts or full names', !JSON.stringify(q.data).includes('Okafor') && !JSON.stringify(q.data).includes('Bourdillon'));
  q = await call('anon', 'POST', `invites/${gn.code}/chat/all`, { guest: ada, text: 'Who’s coming from the mainland?' });
  check('guest posts in the night chat', q.status === 200 && q.data.message.name === 'Ada O.');
  const firstAt = q.data.message.at;
  q = await call('host', 'POST', `invites/${gn.code}/chat/all`, { text: 'Gate code is 1234' });
  check('host posts as host', q.data.message.host === true);
  q = await call('anon', 'GET', `invites/${gn.code}/chat/all?guest=${tunde}`);
  check('others read the chat', q.data.messages.length === 2 && q.data.messages[0].text.startsWith('Who'), q.data);
  q = await call('anon', 'GET', `invites/${gn.code}/chat/all?guest=${tunde}&after=${firstAt}`);
  check('chat polls from a time, never older', q.data.messages.length >= 1 && q.data.messages.every((m) => m.at >= firstAt) && q.data.messages.some((m) => m.host), q.data);
  const hostMsg = q.data.messages.find((m) => m.host).id;
  check('guests can’t remove others’ messages', (await call('anon', 'DELETE', `invites/${gn.code}/chat/all/${hostMsg}`, { guest: tunde })).status === 403);
  // Rides
  q = await call('anon', 'POST', `invites/${gn.code}/rides`, { guest: tunde, dir: 'there', kind: 'driving', from: 'Yaba', time: '19:30', seats: 1, note: 'Can stop at Sabo' });
  check('guest offers a ride', q.status === 200 && q.data.ride.left === 1 && q.data.ride.joined, q.data);
  const rid = q.data.ride.id;
  check('one ride there per person', (await call('anon', 'POST', `invites/${gn.code}/rides`, { guest: tunde, dir: 'there', kind: 'cab', from: 'Yaba', time: '19:45' })).status === 409);
  check('ride needs a valid time', (await call('anon', 'POST', `invites/${gn.code}/rides`, { guest: ada, dir: 'home', from: 'Lekki', time: '25:00' })).status === 400);
  q = await call('anon', 'GET', `invites/${gn.code}/chat/all?guest=${ada}`);
  check('a new ride is announced in the night chat', q.data.messages.some((m) => m.kind === 'ride' && /driving from Yaba at 7:30 pm/.test(m.text)), q.data.messages);
  check('ride chat is closed until you join', (await call('anon', 'GET', `invites/${gn.code}/chat/${rid}?guest=${ada}`)).status === 403);
  q = await call('anon', 'POST', `invites/${gn.code}/rides/${rid}/join`, { guest: ada });
  check('guest joins a ride', q.data.ride?.joined && q.data.ride.left === 0, q.data);
  check('a full ride refuses more', (await call('anon', 'POST', `invites/${gn.code}/rides/${rid}/join`, { guest: kola })).status === 409);
  q = await call('anon', 'POST', `invites/${gn.code}/chat/${rid}`, { guest: ada, text: 'I’ll be at Tejuosho' });
  check('riders chat in the ride', q.status === 200);
  q = await call('host', 'GET', `invites/${gn.code}/chat/${rid}`);
  check('host can read ride chats', q.status === 200 && q.data.messages.some((m) => m.text === 'I’ll be at Tejuosho'));
  check('kola can’t read the ride chat', (await call('anon', 'GET', `invites/${gn.code}/chat/${rid}?guest=${kola}`)).status === 403);
  check('only the poster can change a ride', (await call('anon', 'PATCH', `invites/${gn.code}/rides/${rid}`, { guest: ada, seats: 4 })).status === 403);
  q = await call('anon', 'PATCH', `invites/${gn.code}/rides/${rid}`, { guest: tunde, time: '19:45', seats: 2 });
  check('poster updates time and seats', q.data.ride?.time === '19:45' && q.data.ride.left === 1, q.data);
  q = await call('anon', 'POST', `invites/${gn.code}/rides/${rid}/leave`, { guest: ada });
  q = await call('anon', 'GET', `invites/${gn.code}/group?guest=${kola}`);
  check('leaving frees the seat', q.data.rides[0].left === 2 && !q.data.rides[0].joined, q.data.rides);
  // Removing a guest closes the group to them and drops their rides.
  const hostView = await call('host', 'GET', `nights/${gn.id}`);
  const tid = hostView.data.guests.find((x) => x.name === 'Tunde Bakare').id;
  await call('host', 'PATCH', `nights/${gn.id}/guests/${tid}`, { status: 'declined' });
  check('removed guest loses the group', (await call('anon', 'GET', `invites/${gn.code}/group?guest=${tunde}`)).status === 403);
  q = await call('anon', 'GET', `invites/${gn.code}/group?guest=${kola}`);
  check('removed guest’s ride is hidden', q.data.rides.length === 0 && q.data.people.length === 3, q.data);
  // Moments
  const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1500, 7)]).toString('base64')}`;
  q = await call('anon', 'POST', `invites/${gn.code}/moments`, { guest: kola, image: jpeg, caption: 'First dance', w: 1080, h: 1350 });
  check('guest shares a moment', q.status === 200 && /^\/moment\/[\w-]+\/[\w-]{16,32}\.jpg$/.test(q.data.moment.url), q.data);
  const murl = q.data.moment.url; const mid = q.data.moment.id;
  const img = await handle(new Request(`http://localhost:3000/api?route=${murl.slice(1)}`, { headers: { host: 'localhost:3000' } }));
  check('moment photo is served privately', img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && /private/.test(img.headers.get('cache-control')));
  check('a PNG moment is refused', (await call('anon', 'POST', `invites/${gn.code}/moments`, { guest: kola, image: 'data:image/png;base64,iVBORw0KGgo=' })).status === 400);
  check('moments are closed to people off the list', (await call('anon', 'GET', `invites/${gn.code}/moments?guest=${tunde}`)).status === 403);
  check('guests can’t remove others’ moments', (await call('anon', 'DELETE', `invites/${gn.code}/moments/${mid}`, { guest: ada })).status === 403);
  check('host can’t report (they remove)', (await call('host', 'POST', `invites/${gn.code}/report`, { what: 'moment', id: mid })).status === 400);
  check('you can’t report your own photo', (await call('anon', 'POST', `invites/${gn.code}/report`, { guest: kola, what: 'moment', id: mid })).status === 400);
  q = await call('anon', 'POST', `invites/${gn.code}/report`, { guest: ada, what: 'moment', id: mid });
  check('a guest reports a photo to the host', q.data.ok && (await call('host', 'GET', 'notifications')).data.items.some((i) => /reported a photo/.test(i.text) && /#moments$/.test(i.link)));
  check('a guest reports a message', (await call('anon', 'POST', `invites/${gn.code}/report`, { guest: ada, what: 'message', room: 'all', id: hostMsg })).data.ok === true);
  q = await call('anon', 'GET', `invites/${gn.code}/moments?guest=${ada}`);
  check('the list sees moments', q.data.moments.length === 1 && q.data.moments[0].caption === 'First dance' && !q.data.moments[0].mine);
  // Check-ins: here, heading home (with an ETA), home safe; friends can check on you.
  check('check-in needs a state', (await call('anon', 'POST', `invites/${gn.code}/checkin`, { guest: ada, state: 'lost' })).status === 400);
  check('heading home needs a time', (await call('anon', 'POST', `invites/${gn.code}/checkin`, { guest: ada, state: 'leaving' })).status === 400);
  q = await call('anon', 'POST', `invites/${gn.code}/checkin`, { guest: ada, state: 'here' });
  check('guest checks in as here', q.status === 200 && q.data.checkin.state === 'here' && q.data.checkin.me, q.data);
  check('nobody can check on someone who isn’t heading home', (await call('anon', 'POST', `invites/${gn.code}/checkin/${q.data.checkin.id}/nudge`, { guest: kola })).status === 409);
  const before = Date.now();
  q = await call('anon', 'POST', `invites/${gn.code}/checkin`, { guest: ada, state: 'leaving', mins: 40 });
  const adaId = q.data.checkin.id;
  check('heading home sets when they expect to be home', q.data.checkin.state === 'leaving' && q.data.checkin.eta >= before + 40 * 60000 && q.data.checkin.eta < before + 41 * 60000, q.data);
  q = await call('anon', 'GET', `invites/${gn.code}/group?guest=${kola}`);
  const seen = q.data.checkins.find((c) => c.id === adaId);
  check('the group sees the check-in', seen?.state === 'leaving' && seen.name === 'Ada O.' && !seen.me && typeof q.data.now === 'number', q.data.checkins);
  q = await call('anon', 'GET', `invites/${gn.code}/chat/all?guest=${kola}`);
  check('check-ins show in the night chat', q.data.messages.some((m) => m.kind === 'checkin' && m.state === 'leaving' && /heading home and expects to be there by \d{1,2}:\d\d [ap]m/.test(m.text)), q.data.messages.filter((m) => m.kind === 'checkin'));
  check('you can’t check on yourself', (await call('anon', 'POST', `invites/${gn.code}/checkin/${adaId}/nudge`, { guest: ada })).status === 400);
  q = await call('anon', 'POST', `invites/${gn.code}/checkin/${adaId}/nudge`, { guest: kola });
  check('a friend checks on them', q.status === 200 && q.data.checkin.nudges.length === 1 && q.data.checkin.nudges[0].me, q.data);
  check('one nudge every few minutes', (await call('anon', 'POST', `invites/${gn.code}/checkin/${adaId}/nudge`, { guest: kola })).status === 429);
  q = await call('host', 'POST', `invites/${gn.code}/checkin/${adaId}/nudge`);
  check('the host can check on guests too', q.status === 200 && q.data.checkin.nudges.length === 2);
  q = await call('anon', 'GET', `invites/${gn.code}/group?guest=${ada}`);
  check('they see who checked on them', q.data.checkins.find((c) => c.me)?.nudges.map((x) => x.name).join(',') === 'Kola,Tobi H.', q.data.checkins);
  q = await call('anon', 'POST', `invites/${gn.code}/checkin`, { guest: ada, state: 'home' });
  check('home safe clears the countdown', q.data.checkin.state === 'home' && q.data.checkin.eta === null && q.data.checkin.nudges.length === 0, q.data);
  q = await call('anon', 'GET', `invites/${gn.code}/chat/all?guest=${kola}`);
  check('home safe is announced', q.data.messages.some((m) => m.kind === 'checkin' && m.text === 'Ada O. got home safe.') && q.data.messages.some((m) => m.kind === 'nudge' && m.to === adaId));
  check('no check-ins after a guest is removed', !(await call('anon', 'GET', `invites/${gn.code}/group?guest=${kola}`)).data.checkins.some((c) => c.name === 'Tunde B.'));
  // Cancelled nights are read-only; deleting the night removes everything.
  await call('host', 'PATCH', `nights/${gn.id}`, { status: 'cancelled' });
  check('cancelled night: chat is read-only', (await call('anon', 'POST', `invites/${gn.code}/chat/all`, { guest: ada, text: 'hi' })).status === 409);
  check('cancelled night: no check-ins', (await call('anon', 'POST', `invites/${gn.code}/checkin`, { guest: ada, state: 'here' })).status === 409);
  await call('anon', 'POST', `invites/${gn.code}/rides`, { guest: ada, dir: 'home', from: 'Lekki', time: '02:00' });
  q = await call('host', 'DELETE', `nights/${gn.id}`);
  const after = await handle(new Request(`http://localhost:3000/api?route=${murl.slice(1)}`, { headers: { host: 'localhost:3000' } }));
  check('deleting the night removes moments and chats', q.data.ok && after.status === 404);
}

r = await call('dj', 'POST', 'crates', { name: 'Warm-up' });
const crate = r.data.crate;
r = await call('dj', 'PATCH', `crates/${crate.id}`, { add: { a: 'Rema', t: 'Calm Down' } });
check('crate add', r.data.crate.tracks.length === 1);
r = await call('dj', 'GET', 'insights');
check('insights', r.data.sets === 2 && r.data.followers === 1 && r.data.topArtists.length > 0, r.data);
r = await call('dj', 'GET', 'me/export');
check('export', r.data.sets.length === 2 && !JSON.stringify(r.data).includes('"pw"'));

r = await call('dj', 'POST', 'auth/forgot', { email: 'kemi@test.dev' });
check('forgot ok', r.data.ok && !r.data.devLink);
r = await call('dj', 'POST', 'me/password', { current: 'longenough1', next: 'newpassword2' });
check('change password', r.data.ok);
r = await call('dj', 'POST', 'auth/signout');
check('sign out clears the product hint', jar.dj.vz_product === null && jar.dj.vz_session === null, jar.dj);
r = await call('dj', 'GET', 'me');
check('signed out', r.data.user === null);
r = await call('dj', 'POST', 'auth/signin', { email: 'kemi@test.dev', password: 'longenough1' });
check('old password rejected', r.status === 401);
r = await call('dj', 'POST', 'auth/signin', { email: 'kemi@test.dev', password: 'newpassword2' });
check('sign in', r.status === 200);
const csrf = await handle(new Request('http://localhost:3000/api/sets', { method: 'POST', headers: { 'content-type': 'text/plain', cookie: `vz_session=${jar.dj.vz_session}` }, body: '{}' }));
check('non-JSON POST blocked', csrf.status === 415);
const cross = await handle(new Request('http://localhost:3000/api/sets', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost:3000', cookie: `vz_session=${jar.dj.vz_session}` }, body: '{}' }));
check('cross-origin POST blocked', cross.status === 403);
const badOrigin = await handle(new Request('http://localhost:3000/api/sets', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'null', host: 'localhost:3000' }, body: '{}' }));
check('malformed Origin refused, not a 500', badOrigin.status === 403);
r = await call('anon', 'POST', 'auth/reset', { token: 'nope', password: 'x'.repeat(201) });
check('reset refuses an overlong password', r.status === 400 && /too long/.test(r.data.error), r.data);
r = await call('legacy', 'PATCH', 'me', { product: 'dj', onboarded: true });
check('switch product in settings', r.data.user?.product === 'dj');
check('switching product updates the hint cookie', jar.legacy.vz_product === 'dj');
jar.legacy.vz_product = 'social';
r = await call('legacy', 'GET', 'me');
check('a stale hint is corrected on the next /api/me', jar.legacy.vz_product === 'dj' && r.set.length === 1, r.set);
r = await call('legacy', 'GET', 'me');
check('no cookie is sent when the hint is already right', r.set.length === 0, r.set);
r = await call('legacy', 'GET', 'sets');
check('switched account can use DJ tools', r.status === 200);
r = await call('dj', 'DELETE', 'me', { password: 'newpassword2' });
check('delete account', r.data.ok);
r = await call('anon', 'GET', 'users/kemi-lagos');
check('profile gone', r.status === 404);

// Social-first launch: with DJ_OPEN unset, new accounts can't be Vybez DJ.
process.env.DJ_OPEN = '';
r = await call('anon', 'GET', 'health');
check('health reports DJ closed', r.data.djOpen === false, r.data);
r = await call('late', 'POST', 'auth/signup', { email: 'late@test.dev', password: 'longenough1', name: 'Late DJ', product: 'dj' });
check('DJ sign-up refused while DJ is closed', r.status === 403 && r.data.djOpen === false, r.data);
r = await call('late', 'POST', 'auth/signup', { email: 'late@test.dev', password: 'longenough1', name: 'Late Host' });
check('sign-up without a product becomes Social while DJ is closed', r.status === 200 && r.data.user.product === 'social', r.data);
r = await call('late', 'PATCH', 'me', { product: 'dj' });
check('Social account cannot switch to DJ while DJ is closed', r.status === 403, r.data);
r = await call('legacy', 'GET', 'sets');
check('existing DJ accounts keep working while DJ is closed', r.status === 200);

console.log(failures ? `\n${failures} failed` : '\nAll API checks passed');
process.exit(failures ? 1 : 0);
