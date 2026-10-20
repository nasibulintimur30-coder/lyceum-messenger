/**
 * Сборка статики для хостинга: иконки, клиент socket.io и версия.
 *
 * Версия записывается в web/version.txt — service worker использует её как
 * имя кэша. После каждой сборки имя меняется, поэтому браузер выкидывает
 * старый кэш и грузит свежую версию приложения.
 *
 * Запуск: npm run build
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function run(script) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\n  Сборка статики\n');
run('make-icons.mjs');
run('sync-client.mjs');

// Версия: время сборки в секундах — меняется при каждой сборке
const version = String(Date.now());
mkdirSync(path.join(ROOT, 'web'), { recursive: true });
writeFileSync(path.join(ROOT, 'web', 'version.txt'), version, 'utf8');

console.log(`  ✓ web/version.txt (${version})\n`);
