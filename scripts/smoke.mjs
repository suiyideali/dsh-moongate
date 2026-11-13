// Smoke tests for the dsh-approval-gate fork.
// Runs without DSH: uses a temporary DSH_HOME so the plugin's top-level
// config initialization cannot touch the real profile.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-approval-gate-test-'))

const mod = await import('../src/index.mjs')
const plugin = mod.default

assert.equal(plugin.name, 'dsh-approval-gate', 'plugin name')
assert.equal(typeof plugin.apply, 'function', 'plugin apply function')
assert.ok(Array.isArray(plugin.inject), 'plugin inject list')
for (const service of ['llm', 'approval', 'permissionPresets', 'agentDefaultModel', 'timer', 'webServer']) {
  assert.ok(plugin.inject.includes(service), `inject includes ${service}`)
}

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
for (const marker of ['记住这次操作', '取消记住', '⑦ 规则库', '拒绝计数', '参数：', '自学习']) {
  assert.ok(client.includes(marker), `client bundle contains ${marker}`)
}

const patchPath = new URL('../patches/dsh-approval-gate@0.5.0.patch', import.meta.url)
assert.ok(existsSync(patchPath), 'fork patch present')
const patch = readFileSync(patchPath, 'utf8')
assert.ok(patch.includes('--- a/src/index.mjs'), 'patch targets host source')
assert.ok(patch.includes('--- a/client.js'), 'patch targets client bundle')

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(pkg.name, 'dsh-approval-gate', 'package name')
assert.equal(pkg.license, 'MIT', 'license stays MIT')

console.log('smoke: ok')
