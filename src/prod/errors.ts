// The database functions raise short error codes (for example 'ride_unavailable').
// Turn them, and common network/auth failures, into messages a person can act on.

const MESSAGES: Record<string, string> = {
  // requesting
  not_a_passenger: 'Only passenger accounts can request rides.',
  active_ride_exists: 'You already have a ride in progress.',
  same_location: 'Pickup and dropoff are too close together. Choose a different destination.',
  invalid_distance: 'We could not verify that route distance. Please try again.',
  route_not_verified: 'We could not confirm the distance of this trip. Check your connection and try again.',
  invalid_location: 'That location is not valid.',
  offer_out_of_range: 'Your offer is outside the allowed range for this trip. Try the suggested fare.',
  // driving
  driver_not_available: 'You need to be approved and online to accept rides.',
  driver_not_approved: 'Your driver account is waiting for approval.',
  not_a_driver: 'Only driver accounts can do that.',
  ride_unavailable: 'Another driver already took this ride, or it was cancelled.',
  too_far: 'This pickup is too far from where you are. Move closer or wait for a nearer request.',
  wrong_tier: 'This ride is for a different vehicle type.',
  driver_busy: 'Finish your current ride first.',
  not_your_ride: 'This ride is not assigned to you.',
  invalid_transition: 'That step is no longer available for this ride.',
  ride_in_progress: 'You cannot go offline during a ride.',
  // money
  wallet_disabled: 'Wallet payments are not available yet. Pay the driver in cash.',
  insufficient_funds: 'Your wallet balance is too low. Top up, or pay the driver in cash.',
  invalid_payment_method: 'That payment method is not available.',
  invalid_amount: 'That amount is not allowed.',
  debt_limit_reached: 'You owe OrbitRide too much in fees. Pay what you owe to get back online.',
  topup_not_found: 'That top-up could not be found.',
  topup_failed: 'That top-up failed. Start a new one.',
  too_many_requests: 'Too many requests. Please wait a while and try again.',
  balance_not_settled: 'Settle your wallet first: pay what you owe, or withdraw what is left, then try again.',
  invalid_device: 'This device could not be set up for notifications.',
  // cancelling, rating, admin
  not_allowed: 'You are not allowed to do that.',
  ride_not_found: 'That ride could not be found.',
  cannot_rate: 'This ride cannot be rated.',
  invalid_rating: 'Choose a rating from 1 to 5.',
  driver_not_found: 'That driver could not be found.',
  forbidden_field: 'That detail cannot be changed.',
};

// Supabase Auth messages worth translating
const AUTH_PATTERNS: [RegExp, string][] = [
  [/token has expired or is invalid|invalid.*(otp|token)|expired/i, 'That code is wrong or has expired. Request a new one.'],
  [/rate limit|too many/i, 'Too many attempts. Please wait a minute and try again.'],
  [/phone.*(invalid|not valid)|invalid.*phone/i, 'That phone number is not valid.'],
  [/sms|provider/i, 'We could not send the text message. Please try again shortly.'],
];

export function errorCode(err: unknown): string | null {
  const message = (err as { message?: string } | null)?.message;
  if (!message) return null;
  const code = message.trim();
  return code in MESSAGES ? code : null;
}

export function errorMessage(err: unknown): string {
  const code = errorCode(err);
  if (code) return MESSAGES[code];

  const message = String((err as { message?: string } | null)?.message ?? err ?? '');
  for (const [pattern, text] of AUTH_PATTERNS) {
    if (pattern.test(message)) return text;
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return 'We could not reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}

// Normalise a typed phone number to E.164. Local numbers (leading 0) are assumed to be Namibian.
export function normalizePhone(input: string, defaultCountry = '+264'): string | null {
  const cleaned = input.replace(/[\s()-]/g, '');
  let phone = cleaned;
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  else if (phone.startsWith('0')) phone = defaultCountry + phone.slice(1);
  else if (!phone.startsWith('+')) phone = defaultCountry + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
