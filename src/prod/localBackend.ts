// A local stand-in for Supabase, for development and demos (VITE_BACKEND=local).
//
// It runs the REAL production migration in an in-browser Postgres (PGlite) and exposes the small part of the
// supabase-js API the apps use: auth (phone code), table queries, rpc() and change notifications.
// Because the security rules are the real ones, what works here works the same against a real project.
//
// Differences from real Supabase:
//   - the SMS code is always 123456
//   - data lives in this browser only (IndexedDB), so two tabs or two phones do not share rides
//   - "realtime" is a refetch signal after every change made through this client
//
// Never part of a production build (see src/prod/backend.ts).

import { PGlite } from '@electric-sql/pglite';
import { loadRoadRouter, type RoadRouter } from '../../supabase/functions/_shared/roadRouter.ts';
import { handleRoute } from '../../supabase/functions/_shared/routeService.ts';

export const LOCAL_DEV_CODE = '123456';
export const LOCAL_ADMIN_PHONE = '+264810000000';
// Stands in for the ROUTE_SIGNING_SECRET of a real project (test backend only)
export const LOCAL_ROUTE_SECRET = 'local-dev-route-secret-not-for-production';
const DB_NAME = 'orbitride-local';
const SESSION_KEY = 'orbitride-local-session';

// What Supabase provides before any migration runs: roles, the auth schema, and default grants
const SCAFFOLD = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    phone text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    banned_until timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

const IDENT = /^[a-z_][a-z0-9_]*$/i;
const ident = (name: string): string => {
  if (!IDENT.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return name;
};

// Functions that return several rows (the rest return one row or nothing)
const SET_RETURNING = new Set(['available_driver_counts', 'nearby_drivers']);

type Result<T = unknown> = { data: T | null; error: { message: string; code?: string } | null };

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

const toError = (err: unknown): { message: string; code?: string } => {
  const e = err as { message?: string; code?: string };
  return { message: String(e?.message ?? err), code: e?.code };
};

interface SessionData {
  access_token: string;
  user: { id: string; phone: string };
}

type AuthListener = (event: string, session: SessionData | null) => void;

export async function resetLocalBackend(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(`/pglite/${DB_NAME}`);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export async function createLocalClient(opts: {
  migrationSql: string;
  /** Keep data in IndexedDB (browser default) or in memory only (tests) */
  persist?: boolean;
  /** Where the road graph comes from for the stand-in `route` function (the browser fetches it; tests pass a router) */
  loadRouter?: () => Promise<RoadRouter | null>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}) {
  const persist = opts.persist ?? typeof indexedDB !== 'undefined';
  const memory = new Map<string, string>();
  const storage = opts.storage ?? (typeof localStorage !== 'undefined'
    ? localStorage
    : {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
        removeItem: (k: string) => void memory.delete(k),
      });

  if (persist && typeof location !== 'undefined' && new URLSearchParams(location.search).has('reset-local')) {
    await resetLocalBackend();
  }

  let db = new PGlite(persist ? `idb://${DB_NAME}` : undefined);
  await db.waitReady;

  let installed = (await db.query("select to_regclass('public.rides') as t")).rows[0] as { t: string | null };
  if (installed.t && persist) {
    // A database saved by an older version of the schema is throw-away test data: start again
    const current = (await db.query(
      "select count(*)::int as n from information_schema.columns where table_name = 'platform_settings' and column_name = 'require_signed_routes'"
    )).rows[0] as { n: number };
    if (!current.n) {
      await db.close();
      await resetLocalBackend();
      db = new PGlite(`idb://${DB_NAME}`);
      await db.waitReady;
      installed = { t: null };
    }
  }
  if (!installed.t) {
    await db.exec(SCAFFOLD);
    await db.exec(opts.migrationSql);
    // A ready-made admin so approvals can be tried straight away (sign in with LOCAL_ADMIN_PHONE)
    const { rows } = await db.query(
      'insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id',
      [LOCAL_ADMIN_PHONE, JSON.stringify({ role: 'passenger', full_name: 'Dev Admin' })]
    );
    await db.query("update public.profiles set role = 'admin' where id = $1", [(rows[0] as { id: string }).id]);
    // Demos can try wallet payments (the real project keeps this off until a payment gateway is connected)
    await db.exec('update public.platform_settings set wallet_enabled = true');
    // Server-signed routes on, like a real launch: the stand-in `route` function below signs with this secret
    await db.query("insert into public.server_secrets (name, value) values ('route_signing', $1)", [LOCAL_ROUTE_SECRET]);
    await db.exec('update public.platform_settings set require_signed_routes = true');
  }

  // ---- one connection, so run everything one at a time ----
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  // ---- session ----
  let session: SessionData | null = null;
  try {
    const saved = storage.getItem(SESSION_KEY);
    if (saved) session = JSON.parse(saved) as SessionData;
  } catch {
    session = null;
  }
  const authListeners = new Set<AuthListener>();
  const setSession = (next: SessionData | null, event: string) => {
    session = next;
    if (next) storage.setItem(SESSION_KEY, JSON.stringify(next));
    else storage.removeItem(SESSION_KEY);
    authListeners.forEach((cb) => cb(event, next));
  };

  // Run SQL as whoever is signed in, with row level security applied
  const runAsUser = <T>(fn: () => Promise<T>): Promise<T> =>
    exclusive(async () => {
      if (session) {
        await db.exec('set role authenticated');
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [session.user.id]);
      } else {
        await db.exec('set role anon');
      }
      try {
        return await fn();
      } finally {
        await db.exec('reset role');
        await db.query("select set_config('request.jwt.claim.sub', '', false)");
      }
    });

  // ---- change notifications ("realtime") ----
  const subscribers = new Set<() => void>();
  const notify = () => setTimeout(() => subscribers.forEach((cb) => cb()), 0);

  // ---- query builder (the supabase-js subset the apps use) ----
  type Filter = { col: string; op: 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'is'; val: unknown };

  class Query implements PromiseLike<Result> {
    private filters: Filter[] = [];
    private orders: { col: string; asc: boolean }[] = [];
    private max: number | null = null;
    private mode: 'many' | 'single' | 'maybe' = 'many';
    constructor(
      private table: string,
      private columns: string,
      private update: Record<string, unknown> | null = null
    ) {}

    eq(col: string, val: unknown) { this.filters.push({ col, op: 'eq', val }); return this; }
    neq(col: string, val: unknown) { this.filters.push({ col, op: 'neq', val }); return this; }
    in(col: string, val: unknown[]) { this.filters.push({ col, op: 'in', val }); return this; }
    gte(col: string, val: unknown) { this.filters.push({ col, op: 'gte', val }); return this; }
    lte(col: string, val: unknown) { this.filters.push({ col, op: 'lte', val }); return this; }
    is(col: string, val: null | boolean) { this.filters.push({ col, op: 'is', val }); return this; }
    order(col: string, o?: { ascending?: boolean }) { this.orders.push({ col, asc: o?.ascending !== false }); return this; }
    limit(n: number) { this.max = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    select() { return this; } // after update(): return the changed rows

    then<A = Result, B = never>(
      onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
      onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
    ): Promise<A | B> {
      return this.exec().then(onFulfilled, onRejected);
    }

    private async exec(): Promise<Result> {
      try {
        const params: unknown[] = [];
        const table = `public.${ident(this.table)}`;

        // update ... set: values first so their placeholders are $1..$n
        const setSql = this.update
          ? Object.entries(this.update).map(([k, v]) => {
              params.push(v);
              return `${ident(k)} = $${params.length}`;
            }).join(', ')
          : '';

        const where = this.filters.map((f) => {
          const col = ident(f.col);
          if (f.op === 'in') {
            params.push((f.val as unknown[]).map(String));
            return `${col}::text = any($${params.length}::text[])`;
          }
          if (f.op === 'is') return `${col} is ${f.val === null ? 'null' : f.val ? 'true' : 'false'}`;
          if (f.val === null) return f.op === 'eq' ? `${col} is null` : `${col} is not null`;
          params.push(f.val);
          const op = { eq: '=', neq: '<>', gte: '>=', lte: '<=' }[f.op];
          return `${col} ${op} $${params.length}`;
        });
        const whereSql = where.length ? ` where ${where.join(' and ')}` : '';

        let sql: string;
        if (this.update) {
          sql = `update ${table} set ${setSql}${whereSql} returning *`;
        } else {
          const cols = this.columns.trim() === '*' ? '*' : this.columns.split(',').map((c) => ident(c.trim())).join(', ');
          const order = this.orders.length ? ` order by ${this.orders.map((o) => `${ident(o.col)} ${o.asc ? 'asc' : 'desc'}`).join(', ')}` : '';
          const lim = this.max !== null ? ` limit ${Number(this.max)}` : '';
          sql = `select ${cols} from ${table}${whereSql}${order}${lim}`;
        }

        const { rows } = await runAsUser(() => db.query(sql, params));
        if (this.update) notify();
        const data = rows.map((r) => normalizeRow(r as Record<string, unknown>));
        if (this.mode === 'single') {
          return data.length === 1
            ? { data: data[0], error: null }
            : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
        }
        if (this.mode === 'maybe') return { data: data[0] ?? null, error: null };
        return { data, error: null };
      } catch (err) {
        return { data: null, error: toError(err) };
      }
    }
  }

  // the phone number (and sign-up details) a code was last requested for
  let pendingSignIn: { phone: string; data: Record<string, unknown> } | null = null;

  // ---- the client ----
  return {
    from(table: string) {
      return {
        select: (columns = '*') => new Query(table, columns),
        update: (values: Record<string, unknown>) => new Query(table, '*', values),
      };
    },

    // Stands in for supabase.functions.invoke('route'): runs the real edge-function code in the browser
    functions: {
      async invoke(name: string, init: { body?: unknown } = {}): Promise<Result> {
        if (name !== 'route') return { data: null, error: { message: `Unknown function: ${name}` } };
        if (!session) return { data: null, error: { message: 'not_signed_in' } };
        const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
        const jwt = `${b64({ alg: 'none' })}.${b64({ sub: session.user.id, role: 'authenticated' })}.local`;
        const router = await (opts.loadRouter
          ? opts.loadRouter()
          : loadRoadRouter(new URL(`${import.meta.env.BASE_URL}tiles/windhoek-roads.json`, window.location.href).href));
        const res = await handleRoute(
          new Request('http://local/route', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(init.body ?? {}) }),
          { secret: LOCAL_ROUTE_SECRET, router, now: () => Math.floor(Date.now() / 1000) }
        );
        const body = await res.json();
        return res.ok ? { data: body, error: null } : { data: null, error: { message: String(body.error ?? res.status) } };
      },
    },

    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
      try {
        if (fn === 'dev_complete_topup') {
          // Stands in for the payment gateway webhook: pretend the money arrived (the real function is service-role only)
          const topup = await exclusive(async () => {
            await db.exec('set role service_role');
            try {
              return (await db.query('select * from public.complete_topup($1, $2)', [args.p_topup_id, `dev-${String(args.p_topup_id)}`])).rows[0];
            } finally {
              await db.exec('reset role');
            }
          });
          notify();
          return { data: normalizeRow(topup as Record<string, unknown>), error: null };
        }
        const keys = Object.keys(args).filter((k) => args[k] !== undefined);
        const params = keys.map((k) => args[k]);
        const call = `select * from public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
        const { rows } = await runAsUser(() => db.query(call, params));
        notify();
        const data = rows.map((r) => normalizeRow(r as Record<string, unknown>));
        if (SET_RETURNING.has(fn)) return { data, error: null };
        const first = data[0];
        // functions returning void come back as a single row with one null column
        if (!first || (Object.keys(first).length === 1 && first[fn] === null)) return { data: null, error: null };
        return { data: first, error: null };
      } catch (err) {
        return { data: null, error: toError(err) };
      }
    },

    channel(_name: string) {
      const handlers: ((payload: unknown) => void)[] = [];
      const fire = () => handlers.forEach((h) => h({ eventType: 'UPDATE' }));
      const ch = {
        on(_type: string, _filter: unknown, cb: (payload: unknown) => void) {
          handlers.push(cb);
          return ch;
        },
        subscribe(cb?: (status: string) => void) {
          subscribers.add(fire);
          cb?.('SUBSCRIBED');
          return ch;
        },
        _fire: fire,
      };
      return ch;
    },
    removeChannel(ch: { _fire: () => void }) {
      subscribers.delete(ch._fire);
      return Promise.resolve('ok');
    },

    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
      onAuthStateChange(cb: AuthListener) {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      async signInWithOtp(args: { phone: string; options?: { data?: Record<string, unknown> } }) {
        pendingSignIn = { phone: args.phone, data: args.options?.data ?? {} };
        return { data: {}, error: null };
      },
      async verifyOtp(args: { phone: string; token: string; type: string }) {
        if (!pendingSignIn || pendingSignIn.phone !== args.phone || args.token !== LOCAL_DEV_CODE) {
          return { data: { session: null }, error: { message: 'Token has expired or is invalid' } };
        }
        const { phone, data } = pendingSignIn;
        pendingSignIn = null;
        const existing = await exclusive(() => db.query('select id from auth.users where phone = $1', [phone]));
        let id = (existing.rows[0] as { id: string } | undefined)?.id;
        if (!id) {
          const created = await exclusive(() =>
            db.query('insert into auth.users (phone, raw_user_meta_data) values ($1, $2) returning id', [phone, JSON.stringify(data)])
          );
          id = (created.rows[0] as { id: string }).id;
        }
        const next = { access_token: 'local', user: { id, phone } };
        setSession(next, 'SIGNED_IN');
        return { data: { session: next }, error: null };
      },
      async signOut() {
        setSession(null, 'SIGNED_OUT');
        return { error: null };
      },
    },
  };
}

export type LocalClient = Awaited<ReturnType<typeof createLocalClient>>;
