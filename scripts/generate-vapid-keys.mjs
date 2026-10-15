// Makes a VAPID key pair for browser push notifications (Web Push).
//
//   npm run vapid
//
// Put the PUBLIC key in the web build as VITE_VAPID_PUBLIC_KEY, and the PRIVATE key (secret!) in the send-push
// function as VAPID_PRIVATE_KEY (docs/push-notifications.md). Make a new pair per environment (staging, production).
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const b64url = (b) => b.toString('base64url');
const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);

console.log('VAPID_PUBLIC_KEY  (and VITE_VAPID_PUBLIC_KEY for the web build):');
console.log(b64url(publicRaw));
console.log('\nVAPID_PRIVATE_KEY (keep secret, only for the send-push function):');
console.log(priv.d);
