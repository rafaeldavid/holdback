// `node apps/hosted-sellers/scripts/secrets.ts --seller <private folder> --credentials-out <private directory> [--replace]`
// (T-436): sets one hosted seller's secrets on its Worker in one `wrangler secret bulk`. The company's API key comes
// on standard input; the signing key and the credentials are generated here. Only the signing address and the paths
// of the credential files are printed. Secrets wait for Rafa. The steps are in src/deploy-plan.ts (setSecrets).
import { setSecrets } from '../src/deploy-plan.ts';
import { fileExists, newCredential, newSigningKey, privateDir, probe, readSeller, shell, stdin, writeSecretFile } from './effects.ts';

process.exit(
  await setSecrets({
    args: process.argv.slice(2),
    readSeller,
    probe,
    fileExists,
    stdin,
    privateDir,
    writeSecretFile,
    newSigningKey,
    newCredential,
    sh: shell,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  }),
);
