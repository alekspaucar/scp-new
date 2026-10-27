import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const backend = join(root, 'backend'), environment = join(backend, '.venv')
const python = join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: backend, stdio: 'inherit', env: { ...process.env, PYTHONPATH: '', PYTHONDONTWRITEBYTECODE: '1' } })
  if (result.error) { console.error(result.error.message); process.exit(1) }
  if (result.status) process.exit(result.status)
}
if (!existsSync(python)) run(process.env.SGP_NUEVA_PYTHON || 'python3', ['-m', 'venv', environment])
run(python, ['-m', 'pip', 'install', '-r', join(backend, 'requirements.txt')])
console.log('\nInstalación preparada. Ejecuta npm run dev y abre http://localhost:3000 para elegir tu usuario y contraseña.')
