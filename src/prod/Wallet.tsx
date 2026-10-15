import React, { useState } from 'react';
import { Wallet as WalletIcon } from 'lucide-react';
import { api } from './api';
import { BACKEND_KIND } from './backend';
import { errorMessage } from './errors';
import { ErrorNote, InfoNote, money, num } from './ui';
import { useLive } from './useLive';
import type { LedgerEntry, Topup, WalletInfo, Withdrawal } from './types';

interface WalletSettings {
  wallet_enabled: boolean;
  driver_debt_limit: number;
}

interface WalletData {
  wallet: WalletInfo;
  settings: WalletSettings;
  entries: LedgerEntry[];
  pendingTopup: Topup | null;
  pendingWithdrawal: Withdrawal | null;
}

const KIND_LABEL: Record<LedgerEntry['kind'], string> = {
  topup: 'Top-up',
  ride_payment: 'Ride payment',
  commission: 'Platform fee',
  withdrawal: 'Payout',
  adjustment: 'Adjustment',
};

const TOPUP_AMOUNTS = [50, 100, 200, 500];

/** Balance, top-up, payout request and recent activity. Shared by the passenger and driver apps. */
export default function Wallet({ role }: { role: 'passenger' | 'driver' }) {
  const { data, error, reload } = useLive<WalletData>(async (client) => {
    const [wallet, settings, entries, topups, withdrawals] = await Promise.all([
      api.myWallet(),
      client.from('platform_settings').select('wallet_enabled, driver_debt_limit').maybeSingle(),
      client.from('ledger_entries').select('id, amount, balance_after, kind, ride_id, note, created_at').order('id', { ascending: false }).limit(8),
      client.from('topups').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(1),
      client.from('withdrawals').select('*').eq('status', 'requested').limit(1),
    ]);
    const s = settings.data as { wallet_enabled: boolean; driver_debt_limit: number | string } | null;
    return {
      wallet,
      settings: { wallet_enabled: !!s?.wallet_enabled, driver_debt_limit: num(s?.driver_debt_limit) },
      entries: ((entries.data as LedgerEntry[] | null) ?? []).map(e => ({ ...e, amount: num(e.amount), balance_after: num(e.balance_after) })),
      pendingTopup: ((topups.data as Topup[] | null) ?? [])[0] ?? null,
      pendingWithdrawal: ((withdrawals.data as Withdrawal[] | null) ?? [])[0] ?? null,
    };
  }, [], ['ledger_accounts', 'rides', 'withdrawals']);

  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (!data) return error ? <ErrorNote message={error} /> : null;
  const { wallet, settings, entries, pendingTopup, pendingWithdrawal } = data;
  const owes = wallet.balance < 0;
  const enabled = settings.wallet_enabled;
  // Passengers have nothing to see until the wallet is switched on
  if (role === 'passenger' && !enabled && wallet.balance === 0 && entries.length === 0) return null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setProblem(null);
    setNote(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const topUp = (amount: number) => run(`topup-${amount}`, async () => {
    const t = await api.createTopup(amount);
    if (BACKEND_KIND === 'local') {
      await api.devCompleteTopup(t.id); // there is no real gateway in the local test backend
      setNote(`${money(amount)} added (test payment).`);
    } else {
      setNote('Top-up started. It is added to your balance as soon as the payment is confirmed.');
    }
  });

  return (
    <section className="glass-panel p-4 flex flex-col gap-3" aria-label="Wallet">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] text-text-muted uppercase font-bold tracking-wider flex items-center gap-1.5"><WalletIcon size={13} /> Wallet</h2>
        <span className={`text-lg font-black font-mono ${owes ? 'text-amber-400' : 'text-white'}`}>
          {owes ? `Owe ${money(-wallet.balance)}` : money(wallet.available)}
        </span>
      </div>

      {wallet.held > 0 && <p className="text-[11px] text-text-muted">{money(wallet.held)} is reserved for a ride or payout in progress.</p>}

      {role === 'driver' && owes && (
        <InfoNote tone="warn">
          Platform fees on cash rides are taken from your wallet, so it goes negative. You can keep driving until you owe {money(settings.driver_debt_limit)}.
          {enabled ? ' Top up below to pay what you owe.' : ' Pay what you owe to OrbitRide and an admin will record it here.'}
        </InfoNote>
      )}

      {enabled && (
        <div>
          <span className="text-[11px] text-text-muted">{role === 'driver' && owes ? 'Pay what you owe' : 'Add money'}</span>
          <div className="grid grid-cols-4 gap-2 mt-1.5">
            {TOPUP_AMOUNTS.map(a => (
              <button key={a} type="button" className="btn-secondary py-2 text-xs justify-center" disabled={busy !== null} onClick={() => void topUp(a)}>
                {busy === `topup-${a}` ? '...' : money(a).replace('.00', '')}
              </button>
            ))}
          </div>
        </div>
      )}
      {pendingTopup && <InfoNote>Waiting for payment of {money(pendingTopup.amount)} to be confirmed.</InfoNote>}

      {role === 'driver' && wallet.available > 0 && !pendingWithdrawal && (
        <button className="btn-secondary w-full py-2 text-xs justify-center" disabled={busy !== null}
          onClick={() => void run('withdraw', async () => { await api.requestWithdrawal(wallet.available); setNote('Payout requested. An admin will pay it by bank transfer.'); })}>
          {busy === 'withdraw' ? '...' : `Request payout of ${money(wallet.available)}`}
        </button>
      )}
      {pendingWithdrawal && <InfoNote>Payout of {money(pendingWithdrawal.amount)} requested. We will pay it by bank transfer.</InfoNote>}

      <ErrorNote message={problem} />
      {note && <InfoNote tone="good">{note}</InfoNote>}

      <div className="flex flex-col gap-1.5">
        <h3 className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Recent activity</h3>
        {entries.length === 0 ? (
          <p className="text-[11px] text-text-muted">No transactions yet.</p>
        ) : entries.map(e => (
          <div key={e.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate">
              {KIND_LABEL[e.kind]} <span className="text-text-muted">· {new Date(e.created_at).toLocaleDateString()}</span>
            </span>
            <span className={`font-mono font-bold shrink-0 ${e.amount < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {e.amount < 0 ? '-' : '+'}{money(Math.abs(e.amount))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
