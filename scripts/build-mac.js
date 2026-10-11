const { spawnSync } = require('child_process');
if (process.platform !== 'darwin') throw new Error('Build macOS packages on a Mac with Xcode Command Line Tools.');
const arch = process.argv[2] || process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error('Usage: npm run build:mac -- [arm64|x64]');
const env = { ...process.env, BUILD_ARCH: arch, CSC_IDENTITY_AUTO_DISCOVERY: 'false', NODE_OPTIONS: [process.env.NODE_OPTIONS, '--openssl-legacy-provider'].filter(Boolean).join(' ') };
function run(command, args) { const result = spawnSync(command, args, { stdio: 'inherit', env }); if (result.status !== 0) process.exit(result.status || 1); }
run(process.execPath, ['scripts/prepare-dependencies.js']);
run('/usr/bin/swift', ['scripts/build-mac-icon.swift', 'icon.png', 'icon-mac.png']);
run(process.execPath, ['scripts/build-native.js', arch]);
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'prebuild']);
run(process.execPath, ['node_modules/@vue/cli-service/bin/vue-cli-service.js', 'electron:build', '--mac', '--' + arch, '--publish', 'never']);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', `dist_electron/mac${arch === 'arm64' ? '-arm64' : ''}/copytranslator.app`]);
