import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Project, setProjectsDir } from './project.ts'

function withTempProjectsDir(fn: () => void): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-projects-'))
  setProjectsDir(tmp)
  try {
    fn()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

test('project: create/save/load round-trips all fields', () => {
  withTempProjectsDir(() => {
    const p = Project.create('My API', 'Always write tests first.', 'D:/code/my-api')
    p.save()
    const loaded = Project.load(p.data.id)
    assert.equal(loaded.data.name, 'My API')
    assert.equal(loaded.data.instructions, 'Always write tests first.')
    assert.equal(loaded.data.cwd, 'D:/code/my-api')
  })
})

test('project: listAll returns every saved project', () => {
  withTempProjectsDir(() => {
    Project.create('A', '', '.').save()
    Project.create('B', '', '.').save()
    assert.equal(Project.listAll().length, 2)
  })
})

test('project: update patches fields and persists', () => {
  withTempProjectsDir(() => {
    const p = Project.create('Old name', 'old instructions', '.')
    p.save()
    const updated = Project.update(p.data.id, { name: 'New name' })
    assert.equal(updated.name, 'New name')
    assert.equal(updated.instructions, 'old instructions', 'unrelated fields are untouched')
    assert.equal(Project.load(p.data.id).data.name, 'New name')
  })
})

test('project: delete removes it from listAll', () => {
  withTempProjectsDir(() => {
    const p = Project.create('Temp', '', '.')
    p.save()
    Project.delete(p.data.id)
    assert.equal(Project.listAll().length, 0)
  })
})
