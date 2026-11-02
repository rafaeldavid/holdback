// `pnpm prividium:login`: logs Docker in to quay.io for Matter Labs' local-prividium images (T-208).
// Reads PRIVIDIUM_DOCKER_USERNAME and PRIVIDIUM_DOCKER_PASSWORD from the environment (the script is run with
// --env-file-if-exists=.env) and pipes the password to `docker login --password-stdin`; it never prints it.
import { spawnSync } from 'node:child_process';

const user = process.env.PRIVIDIUM_DOCKER_USERNAME;
const password = process.env.PRIVIDIUM_DOCKER_PASSWORD;
if (!user || !password) {
  console.error('Set PRIVIDIUM_DOCKER_USERNAME and PRIVIDIUM_DOCKER_PASSWORD in .env (see config/keys.template).');
  process.exit(1);
}
const r = spawnSync('docker', ['login', 'quay.io', '-u', user, '--password-stdin'], { input: password, stdio: ['pipe', 'inherit', 'inherit'] });
process.exit(r.status ?? 1);
