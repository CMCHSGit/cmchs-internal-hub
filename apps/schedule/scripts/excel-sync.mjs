#!/usr/bin/env node
/**
 * The scheduled task's one entry point: the Excel → app import, then (if the config says "writeBack": true)
 * the app → Excel copy. In that order, one after the other, so the import has already taken in anything
 * changed in the Excel before the copy decides what the app should write back. Extra arguments (--apply,
 * --config <file>, --force ...) go to both. See EXCEL-IMPORT.md.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const run = (script, args) => spawnSync(process.execPath, [path.join(here, script), ...args], { stdio: 'inherit' }).status ?? 1

const args = process.argv.slice(2)
const imported = run('excel-import.mjs', args)
// A failed or refused import means the Excel side isn't known to be in step: don't write back on top of it.
const exported = imported === 0 ? run('excel-export.mjs', args.filter(a => a !== '--force')) : 0
process.exit(imported || exported)
