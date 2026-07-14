import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMemoryScope, canReadConversation, canReadMessage, resolveMemoryScope } from '../lib/chirp/memoryScope.js'

test('persona scope is tied to membership and planet, not global history', () => {
  const scope = buildMemoryScope({
    conversationId: 'group-1',
    planetId: 'planet-love',
    target: { agentRole: 'persona', agentId: 'barry' }
  })

  assert.equal(scope.type, 'persona_membership_planet')
  assert.equal(scope.agent_id, 'barry')
  assert.equal(scope.planet_id, 'planet-love')
  assert.equal(scope.raw_bird_dm_visible, false)
  assert.equal(scope.includes_planet_insights, true)
})

test('bird scope can include raw bird dm while persona scope cannot', () => {
  const birdScope = buildMemoryScope({
    conversationId: 'bird-dm-1',
    planetId: null,
    conversationType: 'bird_dm',
    target: { agentRole: 'bird', agentId: 'bird' }
  })

  const personaScope = buildMemoryScope({
    conversationId: 'group-1',
    planetId: 'planet-love',
    target: { agentRole: 'persona', agentId: 'duck' }
  })

  assert.equal(birdScope.type, 'global_bird')
  assert.equal(birdScope.raw_bird_dm_visible, true)
  assert.equal(canReadMessage(birdScope, { conversation_type: 'bird_dm', conversation_id: 'bird-dm-1' }), true)
  assert.equal(canReadMessage(personaScope, { conversation_type: 'bird_dm', conversation_id: 'bird-dm-1' }), false)
})

test('persona can only read allowed conversation ids after scope resolution', () => {
  const scope = {
    ...buildMemoryScope({
      conversationId: 'group-1',
      planetId: 'planet-love',
      target: { agentRole: 'persona', agentId: 'danzong' }
    }),
    allowed_conversation_ids: ['group-1', 'dm-danzong']
  }

  assert.equal(canReadMessage(scope, { conversation_id: 'group-1', conversation_type: 'group' }), true)
  assert.equal(canReadMessage(scope, { conversation_id: 'dm-danzong', conversation_type: 'persona_dm' }), true)
  assert.equal(canReadMessage(scope, { conversation_id: 'dm-barry', conversation_type: 'persona_dm' }), false)
  assert.equal(canReadMessage(scope, { conversation_id: 'group-work', conversation_type: 'group' }), false)
})

test('couple group bird scope is narrowed to that single conversation, never any DM', () => {
  const scope = buildMemoryScope({
    conversationId: 'couple-group-1',
    planetId: 'planet-couple',
    conversationType: 'group',
    planetType: 'couple',
    target: { agentRole: 'bird', agentId: 'bird' }
  })

  assert.equal(scope.type, 'couple_group_bird')
  assert.equal(scope.raw_bird_dm_visible, false)
  assert.equal(scope.raw_persona_dm_visible, false)

  // only the couple group conversation itself is readable
  assert.equal(canReadConversation(scope, { id: 'couple-group-1', type: 'group', planet_id: 'planet-couple' }), true)
  assert.equal(canReadConversation(scope, { id: 'bird-dm-a', type: 'bird_dm', planet_id: null }), false)
  assert.equal(canReadConversation(scope, { id: 'dm-danzong', type: 'persona_dm', planet_id: null }), false)
  assert.equal(canReadConversation(scope, { id: 'group-love', type: 'group', planet_id: 'planet-love' }), false)

  assert.equal(canReadMessage(scope, { conversation_id: 'couple-group-1', conversation_type: 'group' }), true)
  assert.equal(canReadMessage(scope, { conversation_id: 'bird-dm-a', conversation_type: 'bird_dm' }), false)
  assert.equal(canReadMessage(scope, { conversation_id: 'dm-danzong', conversation_type: 'persona_dm' }), false)
})

test('resolveMemoryScope for couple group bird queries ONLY that conversation id (no owner-wide bird read)', async () => {
  const queries = []
  const fakeSupabase = {
    from(table) {
      return {
        select() { return this },
        eq(column, value) {
          queries.push({ table, column, value })
          return Promise.resolve({
            data: [{ id: 'couple-group-1', type: 'group', planet_id: 'planet-couple' }],
            error: null
          })
        }
      }
    }
  }

  const scope = buildMemoryScope({
    conversationId: 'couple-group-1',
    planetId: 'planet-couple',
    conversationType: 'group',
    planetType: 'couple',
    target: { agentRole: 'bird', agentId: 'bird' }
  })

  const resolved = await resolveMemoryScope({ supabase: fakeSupabase, ownerId: 'user-a', scope })

  assert.deepEqual(resolved.allowed_conversation_ids, ['couple-group-1'])
  // exactly one lookup, by conversation id — NOT bird's owner_id-wide read
  // (which would sweep in every conversation including DMs)
  assert.deepEqual(queries, [{ table: 'chirp_conversations', column: 'id', value: 'couple-group-1' }])
})

test('persona conversation filtering rejects bird dm and other planets', () => {
  const scope = buildMemoryScope({
    conversationId: 'group-love',
    planetId: 'planet-love',
    target: { agentRole: 'persona', agentId: 'barry' }
  })

  assert.equal(canReadConversation(scope, { id: 'bird-dm', type: 'bird_dm', planet_id: null }), false)
  assert.equal(canReadConversation(scope, { id: 'group-work', type: 'group', planet_id: 'planet-work' }), false)
  assert.equal(canReadConversation(scope, { id: 'group-love', type: 'group', planet_id: 'planet-love' }), true)
})

