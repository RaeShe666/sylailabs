// backend/scripts/verifyCoupleInvite.mjs
//
// Couple 邀请端到端验收：真实建 3 个一次性测试账号（A/B/C）→ 走真实 HTTP 打
// backend /api/chirp/couple/invite* + /api/chirp/turn → 用 anon client 验证
// RLS → finally 里清理本次创建的全部数据 + 3 个账号。
//
// 用法（从 backend/ 目录跑，这样 `dotenv/config` 能按现有约定读到 backend/.env）:
//   cd backend
//   node server.js                       # 另一个窗口，先起后端
//   node scripts/verifyCoupleInvite.mjs
//   node scripts/verifyCoupleInvite.mjs --keep   # 跳过 cleanup，便于排查失败原因
//
// 环境变量（不需要手工传测试账号凭据，脚本自己建自己清）：
//   SUPABASE_URL / SUPABASE_SERVICE_KEY   — 读自 backend/.env（跟 backend/lib/supabaseAdmin.js 同一份）
//   SUPABASE_ANON_KEY                      — 可选覆盖；缺省从仓库根目录 .env 的 VITE_SUPABASE_ANON_KEY 读
//   API_BASE                               — 可选覆盖；缺省 http://localhost:<backend/.env 的 PORT，默认 8080>/api
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEEP = process.argv.includes('--keep')

function fail(message) {
    console.error(`FATAL: ${message}`)
    process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    fail('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — expected in backend/.env (same vars backend/lib/supabaseAdmin.js uses).')
}

// The anon key is deliberately NOT in backend/.env (its own comment there says
// "千万不要用 anon key" for the backend's own client). It lives in the
// repo-root .env as the frontend's VITE_SUPABASE_ANON_KEY — read it directly
// off disk (dotenv/config above only loaded backend/.env from cwd).
const rootEnvPath = path.resolve(__dirname, '..', '..', '.env')
const rootEnv = fs.existsSync(rootEnvPath) ? dotenv.parse(fs.readFileSync(rootEnvPath)) : {}
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || rootEnv.VITE_SUPABASE_ANON_KEY
if (!SUPABASE_ANON_KEY) {
    fail(`Missing anon key — expected VITE_SUPABASE_ANON_KEY in repo-root .env (looked at ${rootEnvPath}), or set SUPABASE_ANON_KEY.`)
}

const API_BASE = process.env.API_BASE || `http://localhost:${process.env.PORT || 8080}/api`

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
})

let anyFailed = false
function assert(name, cond, detail) {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ← ' + safeJson(detail)}`)
    if (!cond) {
        anyFailed = true
        process.exitCode = 1
    }
}
function safeJson(value) {
    try { return JSON.stringify(value) } catch { return String(value) }
}

async function createTestUser(tag) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `couple-e2e-${tag}-${stamp}@test.local`
    const password = `Couple-E2E-${Math.random().toString(36).slice(2, 10)}!Aa1`
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw new Error(`createUser(${tag}) failed: ${error.message}`)
    return { id: data.user.id, email, password }
}

async function login(email, password) {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw new Error(`login ${email}: ${error.message}`)
    return { client, token: data.session.access_token, userId: data.user.id }
}

async function api(token, method, apiPath, body) {
    const res = await fetch(`${API_BASE}${apiPath}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined
    })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, json }
}

// Tracks what this run actually created, so cleanup only ever touches rows it
// made — never a blind sweep of the tables.
const created = { userIds: [], planetId: null, conversationId: null, inviteCode: null }

async function cleanup() {
    if (KEEP) {
        console.log('--keep set: skipping cleanup. Created this run:', created)
        return
    }
    console.log('Cleaning up test data...')
    try {
        if (created.conversationId) {
            await admin.from('chirp_messages').delete().eq('conversation_id', created.conversationId)
            await admin.from('chirp_conversation_members').delete().eq('conversation_id', created.conversationId)
            await admin.from('chirp_conversations').delete().eq('id', created.conversationId)
        }
        if (created.inviteCode) {
            await admin.from('chirp_invites').delete().eq('code', created.inviteCode)
        }
        if (created.planetId) {
            await admin.from('chirp_planets').delete().eq('id', created.planetId)
        }
    } catch (err) {
        console.error('Cleanup (data rows) hit an error:', err.message || err)
    }
    for (const id of created.userIds) {
        try {
            await admin.auth.admin.deleteUser(id)
        } catch (err) {
            console.error(`Cleanup (deleteUser ${id}) hit an error:`, err.message || err)
        }
    }
    console.log('Cleanup done.')
}

async function main() {
    console.log(`API_BASE=${API_BASE}`)

    const userA = await createTestUser('a')
    created.userIds.push(userA.id)
    const userB = await createTestUser('b')
    created.userIds.push(userB.id)
    const userC = await createTestUser('c')
    created.userIds.push(userC.id)

    const A = await login(userA.email, userA.password)
    const B = await login(userB.email, userB.password)
    const C = await login(userC.email, userC.password)

    // 1. A creates an invite (repeat create should reuse the pending one, not
    //    mint a second — createInvite() is idempotent per planet).
    const inv1 = await api(A.token, 'POST', '/chirp/couple/invite')
    assert('A 创建邀请', inv1.status === 200 && Boolean(inv1.json.code), inv1)
    created.inviteCode = inv1.json.code || created.inviteCode
    created.planetId = inv1.json.planetId || created.planetId

    const inv2 = await api(A.token, 'POST', '/chirp/couple/invite')
    assert('重复创建复用 pending', inv2.status === 200 && inv2.json.code === inv1.json.code && inv2.json.reused === true, inv2)

    // 2. B previews then redeems (repeat redeem is idempotent: alreadyRedeemed).
    const peek = await api(B.token, 'GET', `/chirp/couple/invite/${inv1.json.code}`)
    assert('B peek 邀请', peek.status === 200 && peek.json.status === 'pending', peek)

    const redeem1 = await api(B.token, 'POST', `/chirp/couple/invite/${inv1.json.code}/redeem`)
    assert('B redeem 成功', redeem1.status === 200 && Boolean(redeem1.json.conversationId), redeem1)
    created.conversationId = redeem1.json.conversationId || created.conversationId
    const conversationId = redeem1.json.conversationId

    const redeem2 = await api(B.token, 'POST', `/chirp/couple/invite/${inv1.json.code}/redeem`)
    assert('重复 redeem 幂等', redeem2.status === 200 && redeem2.json.alreadyRedeemed === true, redeem2)

    // 3. A redeeming the now-already-redeemed invite is rejected. (This hits the
    //    ALREADY_REDEEMED branch, not SELF_REDEEM — SELF_REDEEM only fires while
    //    the invite is still pending; exercising that branch needs a second,
    //    still-pending code, which is out of scope for this pass.)
    const selfRedeemOnUsed = await api(A.token, 'POST', `/chirp/couple/invite/${inv1.json.code}/redeem`)
    assert('A redeem 已用邀请被拒', selfRedeemOnUsed.status === 409 || selfRedeemOnUsed.status === 400, selfRedeemOnUsed)

    // 4. B sends a message into the couple group via /chirp/turn. Real request
    //    shape per backend/routes/chirp.js prepareTurn(): { conversation: { id }, text }.
    //    Couple groups short-circuit before any persona/Bird activation runs, so
    //    the response is the same shape as an "everyone stayed silent" turn:
    //    { success, activation, messages: [...] } with only user-type messages.
    const turnText = `hello from B ${Date.now()}`
    const turn = await api(B.token, 'POST', '/chirp/turn', {
        conversation: { id: conversationId },
        text: turnText
    })
    assert('B turn 发消息', turn.status === 200 && turn.json.success === true, turn)
    const turnMessages = Array.isArray(turn.json.messages) ? turn.json.messages : []
    assert(
        'couple 群无 agent 响应',
        turnMessages.length > 0 && turnMessages.every(message => message.type !== 'agent'),
        turn.json
    )

    // 5. RLS via anon clients: A and B (owner + member) can read the group's
    //    messages; C (neither) reads zero rows. Column is `text`, not `content`
    //    (see chirp_messages schema — docs/superpowers/research/2026-07-13-live-schema-audit.md §3).
    const readAs = (who) => who.client
        .from('chirp_messages')
        .select('id, sender_id, text')
        .eq('conversation_id', conversationId)
        .limit(50)

    const aRead = await readAs(A)
    assert('A 可读群消息(RLS)', !aRead.error && (aRead.data || []).length > 0, aRead.error)

    const bRead = await readAs(B)
    assert('B 可读群消息(RLS)', !bRead.error && (bRead.data || []).length > 0, bRead.error)

    // couple 群的用户消息 sender_id 是发送者真实 uuid（非 'user' 字面量，见
    // backend/routes/chirp.js insertMessage 的 planetType==='couple' 分支）。
    const bMsg = (bRead.data || []).find(message => message.sender_id === B.userId)
    assert('B 的消息 sender_id=其uuid(归属)', Boolean(bMsg), (bRead.data || []).slice(0, 3))

    const cRead = await readAs(C)
    assert('C 读不到群消息(RLS负例)', !cRead.error && (cRead.data || []).length === 0, cRead)

    console.log(anyFailed ? 'DONE — some checks FAILED (see above).' : 'done.')
}

main()
    .catch(err => {
        console.error('Fatal error during run:', err)
        process.exitCode = 1
    })
    .finally(cleanup)
