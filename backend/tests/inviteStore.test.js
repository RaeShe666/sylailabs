import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateInviteCode, createInvite, getInviteByCode, redeemInvite, InviteError
} from '../lib/couple/inviteStore.js'

const CODE_ALPHABET = /^[A-HJ-NP-Z2-9]{10}$/

test('generateInviteCode: 10位、无易混字符、可多次生成不同值', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const code = generateInviteCode()
    assert.match(code, CODE_ALPHABET)
    seen.add(code)
  }
  assert.ok(seen.size > 190)
})

// 最小假 client：只实现被 store 用到的链式方法
function fakeDb({ pendingInvite = null, maybeSingleQueue = null, insertResult = null, insertError = null, rpcResult = null, rpcError = null } = {}) {
  const calls = { inserts: [], updates: [], rpcs: [] }
  return {
    calls,
    from(table) {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => ({
          data: maybeSingleQueue ? (maybeSingleQueue.length ? maybeSingleQueue.shift() : null) : pendingInvite,
          error: null
        }),
        insert(payload) {
          calls.inserts.push({ table, payload })
          return {
            select() { return this },
            single: async () =>
              insertError
                ? { data: null, error: insertError }
                : { data: insertResult ?? { ...payload, id: 'inv-1' }, error: null }
          }
        },
        update(payload) {
          calls.updates.push({ table, payload })
          const chain = {
            eq() { return chain },
            then(resolve) { resolve({ error: null }) }
          }
          return chain
        }
      }
    },
    rpc: async (fn, args) => {
      calls.rpcs.push({ fn, args })
      if (rpcError) return { data: null, error: rpcError }
      return { data: rpcResult, error: null }
    }
  }
}

test('createInvite: 已有未过期 pending 时复用（幂等）', async () => {
  const db = fakeDb({ pendingInvite: { code: 'ABCDEFGH23', planet_id: 'p1', expires_at: '2099-01-01T00:00:00Z', status: 'pending' } })
  const result = await createInvite({ db, planetId: 'p1', inviterId: 'u-a' })
  assert.equal(result.code, 'ABCDEFGH23')
  assert.equal(result.reused, true)
  assert.equal(db.calls.inserts.length, 0)
})

test('createInvite: 过期的 pending 标记 expired 后新建', async () => {
  const db = fakeDb({ pendingInvite: { code: 'OLDCODE234', planet_id: 'p1', expires_at: '2000-01-01T00:00:00Z', status: 'pending' } })
  const result = await createInvite({ db, planetId: 'p1', inviterId: 'u-a' })
  assert.equal(result.reused, false)
  assert.notEqual(result.code, 'OLDCODE234')
  assert.equal(db.calls.updates.length, 1)
  assert.deepEqual(db.calls.updates[0].payload, { status: 'expired' })
  assert.equal(db.calls.inserts.length, 1)
})

test('createInvite: 并发撞唯一索引(23505)时重读复用', async () => {
  const winner = { code: 'WINNER2345', planet_id: 'p1', expires_at: '2099-01-01T00:00:00Z', status: 'pending' }
  const db = fakeDb({ maybeSingleQueue: [null, winner], insertError: { code: '23505', message: 'duplicate key' } })
  const result = await createInvite({ db, planetId: 'p1', inviterId: 'u-a' })
  assert.equal(result.code, 'WINNER2345')
  assert.equal(result.reused, true)
})

test('createInvite: 无 pending 时新建并带过期时间', async () => {
  const db = fakeDb({ pendingInvite: null })
  const result = await createInvite({ db, planetId: 'p1', inviterId: 'u-a', ttlDays: 7 })
  assert.match(result.code, CODE_ALPHABET)
  assert.equal(result.reused, false)
  assert.equal(db.calls.inserts.length, 1)
  const payload = db.calls.inserts[0].payload
  assert.equal(payload.planet_id, 'p1')
  assert.equal(payload.inviter_id, 'u-a')
  assert.equal(payload.status, 'pending')
  assert.ok(new Date(payload.expires_at) > new Date())
})

test('redeemInvite: RPC 成功返回归属', async () => {
  const db = fakeDb({ rpcResult: { planet_id: 'p1', conversation_id: 'c1', already_redeemed: false } })
  const result = await redeemInvite({ db, code: 'ABCDEFGH23', userId: 'u-b' })
  assert.deepEqual(result, { planetId: 'p1', conversationId: 'c1', alreadyRedeemed: false })
  assert.deepEqual(db.calls.rpcs[0], { fn: 'redeem_chirp_invite', args: { p_code: 'ABCDEFGH23', p_user: 'u-b' } })
})

test('redeemInvite: RPC 异常映射为 InviteError', async () => {
  const db = fakeDb({ rpcError: { message: 'INVITE_EXPIRED' } })
  await assert.rejects(
    () => redeemInvite({ db, code: 'X', userId: 'u-b' }),
    (err) => err instanceof InviteError && err.code === 'INVITE_EXPIRED'
  )
})

test('redeemInvite: 未知 RPC 错误归为 INVITE_NOT_FOUND 之外的透传', async () => {
  const db = fakeDb({ rpcError: { message: 'connection reset' } })
  await assert.rejects(
    () => redeemInvite({ db, code: 'X', userId: 'u-b' }),
    (err) => err instanceof InviteError && err.code === 'INVITE_REDEEM_FAILED'
  )
})
