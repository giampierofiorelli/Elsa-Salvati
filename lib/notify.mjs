// Who is told about a booking: only the professional concerned, at her notification email;
// the administrators only when she has none. The studio inbox gets contact requests with no chosen
// professional and organisation requests, never booking notifications.

export async function bookingTargets(store, professionalEmail) {
  if (professionalEmail) return [professionalEmail];
  const users = await store.listUsers();
  return [...new Set(users.filter((u) => u.role === 'admin' && u.active && u.enrolled_at).map((u) => u.email))];
}

/** Contact requests: the chosen professional (or the admins if she has no email), else the studio inbox. */
export async function requestTargets(store, site, pro) {
  if (pro) return bookingTargets(store, pro.notify_email);
  return site.notifyEmail ? [site.notifyEmail] : bookingTargets(store, null);
}
