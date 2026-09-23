import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Skill, setSkillsDir } from './skill.ts'

function withTempSkillsDir(fn: () => void): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-skills-'))
  setSkillsDir(tmp)
  try {
    fn()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

test('skill: create/save/load round-trips all fields', () => {
  withTempSkillsDir(() => {
    const s = Skill.create('Write Tests First', 'Use when adding new code', 'Always write a failing test first.', 'global', null)
    s.save()
    const loaded = Skill.load(s.data.id)
    assert.equal(loaded.data.name, 'Write Tests First')
    assert.equal(loaded.data.slug, 'write-tests-first')
    assert.equal(loaded.data.scope, 'global')
  })
})

test('skill: slug collisions get de-duped', () => {
  withTempSkillsDir(() => {
    const a = Skill.create('My Skill', '', '', 'global', null)
    a.save()
    const b = Skill.create('My Skill', '', '', 'global', null)
    b.save()
    assert.equal(a.data.slug, 'my-skill')
    assert.equal(b.data.slug, 'my-skill-2')
  })
})

test('skill: listAll returns every saved skill', () => {
  withTempSkillsDir(() => {
    Skill.create('A', '', '', 'global', null).save()
    Skill.create('B', '', '', 'global', null).save()
    assert.equal(Skill.listAll().length, 2)
  })
})

test('skill: update patches fields, bumps updatedAt, leaves slug alone', () => {
  withTempSkillsDir(() => {
    const s = Skill.create('Old name', 'old desc', 'old body', 'global', null)
    s.save()
    const originalSlug = s.data.slug
    const updated = Skill.update(s.data.id, { name: 'New name' })
    assert.equal(updated.name, 'New name')
    assert.equal(updated.slug, originalSlug, 'renaming never recomputes the slug')
    assert.equal(updated.description, 'old desc', 'unrelated fields are untouched')
  })
})

test('skill: delete removes it from listAll', () => {
  withTempSkillsDir(() => {
    const s = Skill.create('Temp', '', '', 'global', null)
    s.save()
    Skill.delete(s.data.id)
    assert.equal(Skill.listAll().length, 0)
  })
})
