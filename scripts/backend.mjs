import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(dirname(fileURLToPath(import.meta.url))), backend = join(root, 'backend')
const child = spawn(join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ['run.py'], { cwd: backend, stdio: 'inherit', env: { ...process.env, PYTHONPATH: '', PYTHONDONTWRITEBYTECODE: '1' } })
child.on('error', error => { console.error(`${error.message}. Ejecuta npm run setup primero.`); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code || 0 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'))
