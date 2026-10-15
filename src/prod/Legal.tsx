import React from 'react';
import { LEGAL, legalHref, type LegalPage } from './legalConfig';

// Template legal text for a ride-hailing marketplace. It describes what this app actually does, but it is NOT legal advice:
// have a Namibian lawyer review and adapt it before launch (and set VITE_LEGAL_REVIEWED=true to remove the draft banner).

type Section = { title: string; body: React.ReactNode };

const TERMS: Section[] = [
  { title: '1. About these terms', body: <>These terms apply when you use the {LEGAL.company} ("we", "us") apps and website to request or provide rides. By creating an account you agree to them and to our Privacy Policy.</> },
  { title: '2. What we do', body: <>We run a platform that connects passengers with independent drivers. We do not own the vehicles and drivers are not our employees. The ride itself is an agreement between the passenger and the driver; we provide the technology, set fares using the published rates, and collect a service fee from the driver.</> },
  { title: '3. Accounts', body: <>You need a mobile phone number to sign up and must give your real name. You must be 18 or older. Keep your phone secure: you are responsible for what happens under your account. Drivers must be approved by us before going online, and must hold a valid driving licence, vehicle registration, insurance and any permit the law requires for carrying passengers for payment.</> },
  { title: '4. Fares and payment', body: <>The app shows the fare before you request. Passengers may adjust their offer within the allowed range. Payment is in cash to the driver at the end of the trip or, where available, from your in-app wallet. Prices are in Namibian dollars (N$). Wallet top-ups and payouts are handled as described in the Refunds and Cancellations page.</> },
  { title: '5. Behaviour', body: <>Be respectful and follow the law. Do not use the service for anything illegal, to harass anyone, or to damage a vehicle. Drivers must drive safely, carry no more passengers than seat belts, and never drive after drinking alcohol or taking drugs. We may suspend or close accounts that break these rules or put people at risk.</> },
  { title: '6. Safety', body: <>In an emergency, call the police (10111) or ambulance (211111) first. Share your trip with someone you trust if you feel unsure. Report problems to {LEGAL.email}.</> },
  { title: '7. Our responsibility', body: <>We work to keep the service available but cannot promise it will always work or that a driver will always be available. To the extent the law allows, we are not liable for the conduct of drivers or passengers, or for indirect losses. Nothing here limits any right you have that cannot lawfully be limited.</> },
  { title: '8. Changes and ending', body: <>We may update these terms and will tell you in the app when we do. You can delete your account at any time from the app. We may suspend or close accounts as described above.</> },
  { title: '9. Law and contact', body: <>These terms are governed by the laws of Namibia. Contact: {LEGAL.company}, {LEGAL.address}, {LEGAL.email}, {LEGAL.phone}.</> },
];

const PRIVACY: Section[] = [
  { title: 'Who we are', body: <>{LEGAL.company}, {LEGAL.address}. Questions about your data: {LEGAL.email}.</> },
  { title: 'What we collect', body: (
    <ul className="list-disc pl-5 flex flex-col gap-1">
      <li><b>Account details:</b> your mobile number and the name you give us. Drivers also give vehicle and number plate details.</li>
      <li><b>Location:</b> passengers' pickup and dropoff points and, while requesting, the area around them to show nearby drivers; drivers' location while they are online, including when the app is closed or not in use, so passengers can see them arrive and drivers can be offered nearby rides. The driver app shows a notification while this is on, and it stops when the driver goes offline. Passengers' location is used only while the app is open.</li>
      <li><b>Ride and payment records:</b> trips, fares, fees, ratings, wallet top-ups, balances and payouts.</li>
      <li><b>Technical information:</b> error reports from the app (what went wrong and on which screen), used to fix problems.</li>
    </ul>
  ) },
  { title: 'Why we use it', body: <>To create your account and verify your number, match passengers with drivers, show trips in progress, calculate fares and fees, keep financial records, prevent fraud and abuse, keep the service safe and working, and answer your requests.</> },
  { title: 'Who sees it', body: <>During a ride the passenger and driver see each other's name, vehicle details (for the driver), rating and live position. Administrators of the service see accounts, rides and financial records to run and protect it. We use service providers to run the platform: cloud hosting and database, a text-message provider to send sign-in codes, and map and payment services. They may only use your data to provide their service to us. We do not sell your personal data.</> },
  { title: 'How long we keep it', body: <>We keep account details while your account is open. When you delete your account we erase your name, phone number and photo straight away. Ride and payment records are kept without your personal details because we must keep financial records. Error reports are deleted after 30 days.</> },
  { title: 'Your choices', body: <>You can see and correct your name in the app, switch location permission off in your phone settings (the app then cannot show nearby drivers or share a driver's position), and delete your account from the app at any time. You can also email {LEGAL.email} to ask for a copy of your data or for it to be corrected.</> },
  { title: 'Security', body: <>Data is sent over encrypted connections and protected by per-user access rules, so people can only see records that belong to them. No system is perfectly secure; tell us at once if you think your account has been misused.</> },
  { title: 'Changes', body: <>If this policy changes we will update the date below and tell you in the app if the change is important.</> },
];

const REFUNDS: Section[] = [
  { title: 'Cancelling a ride', body: <>Passengers can cancel free of charge until the trip starts. If you pay from your wallet, the money reserved for the ride is released straight away. Once a trip is in progress it cannot be cancelled in the app; speak to the driver.</> },
  { title: 'If a driver cancels or does not arrive', body: <>The ride returns to the pool so another driver can take it, or you can cancel. You are never charged for a ride that did not take place.</> },
  { title: 'Paying', body: <>Cash rides are paid to the driver directly at the end of the trip. Wallet rides are charged when the trip is completed.</> },
  { title: 'Wallet top-ups', body: <>Money you add to your wallet stays yours and can be used for rides. Contact {LEGAL.email} if you want an unused balance returned to you; we will return it to the account or number you paid from, subject to checks to prevent fraud.</> },
  { title: 'Driver payouts and fees', body: <>Drivers keep the fare minus our service fee. On cash rides the fee is deducted from the driver's wallet, so the wallet can go negative. Drivers pay what they owe to continue; if the amount owed passes the limit shown in the app, the driver cannot go online until it is paid. Drivers can request a payout of a positive balance, which we pay by bank transfer.</> },
  { title: 'Problems with a fare or a trip', body: <>Contact {LEGAL.email} or {LEGAL.phone} within 7 days with the trip details. We will look into it and, if we agree the charge was wrong, correct it.</> },
];

const PAGES: Record<LegalPage, { title: string; sections: Section[] }> = {
  terms: { title: 'Terms of Service', sections: TERMS },
  privacy: { title: 'Privacy Policy', sections: PRIVACY },
  refunds: { title: 'Refunds and Cancellations', sections: REFUNDS },
};

export default function Legal({ page }: { page: LegalPage }) {
  const { title, sections } = PAGES[page];
  return (
    <div className="min-h-screen bg-bg-deep text-white">
      <main className="max-w-2xl mx-auto p-5 flex flex-col gap-4">
        <nav className="flex gap-4 text-xs text-cyan-400" aria-label="Legal pages">
          {(Object.keys(PAGES) as LegalPage[]).map(p => (
            <a key={p} href={legalHref(p)} className={p === page ? 'font-bold underline' : ''}>{PAGES[p].title}</a>
          ))}
        </nav>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {!LEGAL.reviewed && (
          <p role="note" className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Draft. This text is a template and has not been reviewed by a lawyer. It must be checked and adapted before launch.
          </p>
        )}
        <p className="text-xs text-text-muted">Last updated: {LEGAL.updated}</p>
        {sections.map(s => (
          <section key={s.title} className="flex flex-col gap-1.5">
            <h2 className="text-sm font-bold">{s.title}</h2>
            <div className="text-sm text-white/80 leading-relaxed">{s.body}</div>
          </section>
        ))}
      </main>
    </div>
  );
}
