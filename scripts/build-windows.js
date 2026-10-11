const { spawnSync } = require('child_process');
const env = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--openssl-legacy-provider'].filter(Boolean).join(' ') };
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status || 1);
}
run('scripts/prepare-dependencies.js');
run('node_modules/typescript/bin/tsc', ['--noEmit', '--skipLibCheck']);
run('node_modules/typescript/bin/tsc', ['src/prebuild.ts', '--target', 'es2019', '--module', 'commonjs', '--esModuleInterop', '--skipLibCheck']);
run('src/prebuild.js');
run('clean.js');
// On Windows the configured targets produce an installer and a ZIP. A Mac can
// cross-package the ZIP, which still needs a Windows runtime smoke test.
run('node_modules/@vue/cli-service/bin/vue-cli-service.js', ['electron:build', '--win', ...(process.platform === 'win32' ? [] : ['zip']), '--x64', '--publish', 'never']);
