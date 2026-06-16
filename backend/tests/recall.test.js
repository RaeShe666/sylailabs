import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeRankedLists, normalizeQueries } from '../lib/chirp/recall.js'

test('normalizeQueries trims, dedupes, and caps at three', () => {
  assert.deepEqual(normalizeQueries('  上次 嗯嗯  '), ['上次 嗯嗯'])
  assert.deepEqual(
    normalizeQueries(['a', 'a', ' b ', '', 'c', 'd']),
    ['a', 'b', 'c']
  )
  assert.deepEqual(normalizeQueries(undefined), [])
})

test('mergeRankedLists fuses ranks across queries and dedupes by id', () => {
  const listA = [{ id: 'm1', text: 'one' }, { id: 'm2', text: 'two' }]
  const listB = [{ id: 'm2', text: 'two' }, { id: 'm3', text: 'three' }]

  const merged = mergeRankedLists([listA, listB], 5)

  // m2 appears in both lists, so it must outrank the single-list items.
  assert.equal(merged[0].id, 'm2')
  assert.equal(merged.length, 3)
  assert.ok(merged[0].score > merged[1].score)
})

test('mergeRankedLists respects the limit', () => {
  const list = [1, 2, 3, 4, 5, 6].map(n => ({ id: `m${n}` }))
  assert.equal(mergeRankedLists([list], 3).length, 3)
})
