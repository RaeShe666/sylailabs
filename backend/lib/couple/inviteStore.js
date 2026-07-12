// couple 邀请钥匙：生成/查询走注入的 db（生产=supabaseAdmin），redeem 走 SQL RPC 保原子。
import crypto from 'node:crypto'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 去易混 0O1IL
const CODE_LENGTH = 10
const KNOWN_REDEEM_ERRORS = new Set([
  'INVITE_NOT_FOUND', 'INVITE_EXPIRED', 'INVITE_REVOKED',
  'INVITE_ALREADY_REDEEMED', 'INVITE_SELF_REDEEM'
])

/**
 * 邀请操作错误
 * @extends Error
 * @property {string} code - 错误代码（如 INVITE_NOT_FOUND, INVITE_EXPIRED 等）
 */
export class InviteError extends Error {
  /**
   * @param {string} code - 错误代码
   * @param {string} [message] - 错误信息，默认为 code
   */
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

/**
 * 生成邀请码（10位随机字符，不含易混字符）
 * @returns {string} 10位邀请码
 */
export function generateInviteCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

/**
 * 判断邀请是否可用（存在且未过期）
 * @param {Object} invite - 邀请对象
 * @param {string} invite.expires_at - 过期时间（ISO8601 格式）
 * @returns {boolean} 是否可用
 * @private
 */
function isUsablePending(invite) {
  return Boolean(invite) && new Date(invite.expires_at) > new Date()
}

/**
 * 为指定 planet 创建邀请钥匙。该 planet 已有 pending 邀请则复用（幂等）；否则新建。
 * @param {Object} params - 参数对象
 * @param {Object} params.db - 数据库客户端（注入，生产=supabaseAdmin）
 * @param {string} params.planetId - planet ID
 * @param {string} params.inviterId - 邀请者用户 ID
 * @param {number} [params.ttlDays=7] - 邀请码有效期（天数）
 * @returns {Promise<{code: string, planetId: string, expiresAt: string, reused: boolean}>} 邀请信息（code: 邀请码，reused: 是否复用）
 * @throws {InviteError} 创建失败时抛出 INVITE_CREATE_FAILED
 */
export async function createInvite({ db, planetId, inviterId, ttlDays = 7 }) {
  const { data: existing, error: findError } = await db
    .from('chirp_invites')
    .select('code, planet_id, expires_at, status')
    .eq('planet_id', planetId)
    .eq('status', 'pending')
    .maybeSingle()
  if (findError) throw new InviteError('INVITE_CREATE_FAILED', findError.message)
  if (existing) {
    if (isUsablePending(existing)) {
      return { code: existing.code, planetId: existing.planet_id, expiresAt: existing.expires_at, reused: true }
    }
    // 过期的 pending：先落库标记 expired（redeem RPC 的 raise 路径不落库过期态），
    // 否则 partial unique index 会挡住新邀请，该 planet 的邀请功能死锁
    const { error: expireError } = await db
      .from('chirp_invites')
      .update({ status: 'expired' })
      .eq('code', existing.code)
      .eq('status', 'pending')
    if (expireError) throw new InviteError('INVITE_CREATE_FAILED', expireError.message)
  }

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
  const payload = {
    code: generateInviteCode(),
    planet_id: planetId,
    inviter_id: inviterId,
    status: 'pending',
    expires_at: expiresAt
  }
  const { data, error } = await db.from('chirp_invites').insert(payload).select().single()
  if (error) {
    // > REVIEW 增补：并发双请求同时新建时，后者撞 pending 唯一索引(23505)——重读复用前者
    if (error.code === '23505') {
      const { data: winner } = await db
        .from('chirp_invites')
        .select('code, planet_id, expires_at, status')
        .eq('planet_id', planetId)
        .eq('status', 'pending')
        .maybeSingle()
      if (isUsablePending(winner)) {
        return { code: winner.code, planetId: winner.planet_id, expiresAt: winner.expires_at, reused: true }
      }
    }
    throw new InviteError('INVITE_CREATE_FAILED', error.message)
  }
  return { code: data.code, planetId: data.planet_id, expiresAt: data.expires_at, reused: false }
}

/**
 * 按邀请码查询邀请信息
 * @param {Object} params - 参数对象
 * @param {Object} params.db - 数据库客户端
 * @param {string} params.code - 邀请码
 * @returns {Promise<{code: string, status: string, planetId: string, inviterId: string, expiresAt: string} | null>} 邀请信息或 null（邀请不存在）
 * @throws {InviteError} 查询失败时抛出 INVITE_LOOKUP_FAILED
 */
export async function getInviteByCode({ db, code }) {
  const { data, error } = await db
    .from('chirp_invites')
    .select('code, status, planet_id, inviter_id, expires_at')
    .eq('code', code)
    .maybeSingle()
  if (error) throw new InviteError('INVITE_LOOKUP_FAILED', error.message)
  if (!data) return null
  return {
    code: data.code, status: data.status, planetId: data.planet_id,
    inviterId: data.inviter_id, expiresAt: data.expires_at
  }
}

/**
 * 兑现邀请，将用户加入 planet。走 SQL RPC 保原子性。
 * @param {Object} params - 参数对象
 * @param {Object} params.db - 数据库客户端
 * @param {string} params.code - 邀请码
 * @param {string} params.userId - 兑现用户 ID
 * @returns {Promise<{planetId: string, conversationId: string, alreadyRedeemed: boolean}>} 兑现结果（planetId: 所属 planet，alreadyRedeemed: 是否已兑现过）
 * @throws {InviteError} 兑现失败时抛出相应错误（INVITE_NOT_FOUND、INVITE_EXPIRED、INVITE_REVOKED、INVITE_ALREADY_REDEEMED、INVITE_SELF_REDEEM 或 INVITE_REDEEM_FAILED）
 */
export async function redeemInvite({ db, code, userId }) {
  const { data, error } = await db.rpc('redeem_chirp_invite', { p_code: code, p_user: userId })
  if (error) {
    const known = [...KNOWN_REDEEM_ERRORS].find(c => (error.message || '').includes(c))
    throw new InviteError(known || 'INVITE_REDEEM_FAILED', error.message)
  }
  return {
    planetId: data.planet_id,
    conversationId: data.conversation_id,
    alreadyRedeemed: Boolean(data.already_redeemed)
  }
}
