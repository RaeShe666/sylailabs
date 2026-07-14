import { Router } from 'express'
import { authenticateUser } from '../middleware/auth.js'
import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { routeActivation } from '../lib/chirp/activationRouter.js'
import { runBird } from '../lib/chirp/birdRuntime.js'
import { CONTEXT_TURNS, classifyReply, runPersona, splitBubbles, takeLastTurns } from '../lib/chirp/personaRuntime.js'
import { buildMemoryScope, resolveMemoryScope } from '../lib/chirp/memoryScope.js'
import { loadOfficialTemplates, loadTemplateByKey } from '../lib/chirp/templateStore.js'
import { ensureInstance, recordInteractionEvent } from '../lib/chirp/instanceStore.js'
import { noteDistillTurn } from '../lib/chirp/distiller.js'
import { formatRecallForPrompt, recall } from '../lib/chirp/recall.js'
import { acquireVisibleRunLock, releaseVisibleRunLock } from '../lib/chirp/visibleRunLock.js'
import { perceiveTurn } from '../lib/chirp/perceptionLayer.js'
import { decideParticipation } from '../lib/chirp/participation.js'
import { readEmotionState, readEmotionStateRow, writeEmotionState, appendEmotionLog } from '../lib/chirp/emotionStore.js'
import { AMBIENT_TRIGGER_TYPES, buildSpeakerPlans } from '../lib/chirp/turnPlanner.js'
import { assessTurnTargeting } from '../lib/chirp/turnTargeting.js'
import { createInvite, getInviteByCode, redeemInvite, InviteError } from '../lib/couple/inviteStore.js'

const router = Router()

const toClientMessage = (row) => ({
    id: row.id,
    type: row.sender_type,
    agentId: row.sender_type === 'agent' ? row.sender_id : undefined,
    // Raw sender id for every sender type — in a couple group a user row
    // carries WHICH partner sent it (their uuid; legacy rows carry 'user').
    // Old clients simply ignore the extra field.
    senderId: row.sender_id ?? undefined,
    senderRole: row.sender_role,
    conversationId: row.conversation_id,
    planetId: row.planet_id,
    text: row.text || '',
    tapbacks: Array.isArray(row.tapbacks) ? row.tapbacks : [],
    quoted: row.reply_to && row.reply_to.text ? { author: row.reply_to.author || '', text: row.reply_to.text } : undefined,
    read: row.sender_type === 'user',
    isPersonalRecord: Boolean(row.is_personal_record || row.sender_type === 'memo'),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
})

const isUuid = (value = '') =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

async function ensurePlanet({ ownerId, planet = {} }) {
    // dbId is only trusted after an ownership check: a bare "select this row"
    // with no owner_id filter let any logged-in caller replay someone else's
    // planet id (leaked e.g. via GET /chirp/couple/invite/:code) and have their
    // turn routed into that planet's group conversation. A dbId that doesn't
    // resolve to a row owned by ownerId is silently ignored (not an error) — for
    // legitimate callers their dbId is always their own row, so this is a no-op.
    if (planet.dbId) {
        const { data: owned, error: ownedError } = await supabaseAdmin
            .from('chirp_planets')
            .select('id, type')
            .eq('id', planet.dbId)
            .eq('owner_id', ownerId)
            .maybeSingle()
        if (ownedError) throw ownedError
        if (owned?.id) return { planetId: owned.id, planetType: owned.type }
    }

    const type = planet.type || planet.id || 'love'
    const { data: existing, error: selectError } = await supabaseAdmin
        .from('chirp_planets')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('type', type)
        .limit(1)
        .maybeSingle()

    if (selectError) throw selectError
    if (existing?.id) return { planetId: existing.id, planetType: type }

    const { data, error } = await supabaseAdmin
        .from('chirp_planets')
        .insert({
            owner_id: ownerId,
            name: planet.roomName || planet.name || 'my crush...',
            type,
            tone: planet.tone || 'relationship, romantic uncertainty, attachment, emotional reading',
            background: planet.background || '#FAFAF7',
            avatar_key: planet.avatarKey || type
        })
        .select('id')
        .single()

    // Lost the create race — chirp_planets_one_couple_per_owner (couple-only,
    // partial unique index) rejected our insert; re-find under the same
    // owner_id+type condition we selected on above, same pattern as
    // ensureConversation's 23505 handling.
    if (error?.code === '23505') {
        const { data: raced, error: racedError } = await supabaseAdmin
            .from('chirp_planets')
            .select('id')
            .eq('owner_id', ownerId)
            .eq('type', type)
            .limit(1)
            .maybeSingle()
        if (racedError) throw racedError
        if (raced?.id) return { planetId: raced.id, planetType: type }
    }

    if (error) throw error
    return { planetId: data.id, planetType: type }
}

async function ensureConversation({ ownerId, planetId, conversation = {}, planet = {} }) {
    if (conversation.id) return conversation.id

    const type = conversation.type || 'group'
    const agentId = conversation.agentId || conversation.personaId || null
    // persona_dm is planet-independent for now (one conversation per
    // user×persona, planet_id null) — matched by the agent_id in metadata, like
    // bird_dm. See memory note chirp-memory-planet-scope-gap.
    const planetless = type === 'bird_dm' || type === 'persona_dm'

    // Always pick the EARLIEST matching conversation so concurrent creates that
    // raced still resolve to one stable row (no split history). A unique index
    // backs this; if we lose a create race the insert hits 23505 and we re-find.
    const findExisting = async () => {
        let query = supabaseAdmin
            .from('chirp_conversations')
            .select('id')
            .eq('type', type)
            .order('created_at', { ascending: true })
            .limit(1)
        // group conversations are located by PLANET, not owner (one group per
        // planet — couple partners share the same row; the unique index is
        // planet-scoped). DM types keep the owner + null-planet lookup as-is.
        if (type !== 'group') query = query.eq('owner_id', ownerId)
        query = planetless ? query.is('planet_id', null) : query.eq('planet_id', planetId)
        if (type === 'persona_dm' && agentId) query = query.contains('metadata', { agent_id: agentId })
        const { data, error } = await query.maybeSingle()
        if (error) throw error
        return data?.id || null
    }

    const existingId = await findExisting()
    if (existingId) return existingId

    const { data, error } = await supabaseAdmin
        .from('chirp_conversations')
        .insert({
            owner_id: ownerId,
            planet_id: planetless ? null : planetId,
            type,
            title: type === 'bird_dm'
                ? 'Bird'
                : (type === 'persona_dm' ? (conversation.title || agentId || 'Persona') : (planet.roomName || planet.name || 'my crush...')),
            metadata: type === 'persona_dm' && agentId ? { agent_id: agentId } : {}
        })
        .select('id')
        .single()

    // Lost the create race — the unique index rejected our insert; re-find it.
    if (error?.code === '23505') {
        const raced = await findExisting()
        if (raced) return raced
    }

    if (error) throw error
    return data.id
}

async function ensureConversationMembers({ conversationId, ownerId, conversationType = 'group', agents = [], targetAgentId = null }) {
    if (!conversationId) return

    const rows = [
        {
            conversation_id: conversationId,
            member_type: 'user',
            member_id: ownerId,
            agent_role: 'user',
            listen_mode: 'active',
            position: 0
        }
    ]

    if (conversationType === 'bird_dm') {
        rows.push({
            conversation_id: conversationId,
            member_type: 'bird',
            member_id: 'bird',
            agent_role: 'bird',
            listen_mode: 'mention_only',
            position: 1
        })
    } else {
        const personaAgents = conversationType === 'persona_dm'
            ? agents.filter(agent => agent.id === targetAgentId || agent.personaKey === targetAgentId || agent.persona_key === targetAgentId).slice(0, 1)
            : agents

        // Bird is DM-only now — it is not added as a member of group conversations.

        rows.push(...personaAgents.map((agent, index) => ({
            conversation_id: conversationId,
            member_type: 'persona',
            member_id: agent.id,
            template_id: isUuid(agent.dbId) ? agent.dbId : null,
            agent_role: 'persona',
            listen_mode: 'passive',
            position: index + 2
        })))
    }

    const { error } = await supabaseAdmin
        .from('chirp_conversation_members')
        .upsert(rows, { onConflict: 'conversation_id,member_type,member_id' })

    if (error) throw error
}

/**
 * 会话访问检查：owner 或 user 成员可访问，join 一并取回 planet type（couple 判定用）。
 * DB 读错误会向上抛（不再吞成 403），只有行不存在或非成员才返回 null。
 * @param {string} conversationId - 会话 ID
 * @param {string} userId - 请求用户 ID
 * @returns {Promise<{id: string, owner_id: string, planet_id: string|null, type: string, title: string, metadata: object, planetType: string|null} | null>} 会话行（挂 planetType），否则 null（403 语义）
 * @throws {Error} DB 读失败时抛出，error.status = 500
 */
async function loadConversationForUser(conversationId, userId) {
    const { data: conversation, error } = await supabaseAdmin
        .from('chirp_conversations')
        .select('id, owner_id, planet_id, type, title, metadata, chirp_planets(type)')
        .eq('id', conversationId)
        .maybeSingle()
    if (error) {
        const dbError = new Error(`load conversation failed: ${error.message || error}`)
        dbError.status = 500
        throw dbError
    }
    if (!conversation) return null
    const withPlanetType = { ...conversation, planetType: conversation.chirp_planets?.type ?? null }
    if (conversation.owner_id === userId) return withPlanetType
    const { data: member, error: memberError } = await supabaseAdmin
        .from('chirp_conversation_members')
        .select('member_id')
        .eq('conversation_id', conversationId)
        .eq('member_type', 'user')
        .eq('member_id', userId)
        .maybeSingle()
    if (memberError) {
        const dbError = new Error(`load conversation member failed: ${memberError.message || memberError}`)
        dbError.status = 500
        throw dbError
    }
    return member ? withPlanetType : null
}

async function insertMessage({ planetId, conversationId, message, activation, runId = null, replyTo = null, planetType = null, senderUserId = null }) {
    // A user message is always sender_type 'user'. Whether it was a no-@
    // "personal record" lives only in is_personal_record — we no longer overload
    // sender_type with a 'memo' value (that conflated "who sent it" with "was it
    // directed", and made every "is this the user?" check silently skip no-@).
    const senderType = message.type
    // couple groups have TWO humans, so a user message records WHO sent it
    // (the requester's uuid). Every other path keeps the legacy 'user' literal
    // so existing readers are untouched.
    const userSenderId = planetType === 'couple' && senderUserId ? senderUserId : 'user'
    const payload = {
        planet_id: planetId || null,
        conversation_id: conversationId || null,
        run_id: runId,
        sender_type: senderType,
        sender_id: message.agentId || (senderType === 'user' ? userSenderId : null),
        sender_role: senderType === 'agent'
            ? (message.agentId === 'bird' ? 'bird' : 'persona')
            : (senderType === 'user' ? 'user' : 'system'),
        is_personal_record: Boolean(activation?.isPersonalRecord || message.isPersonalRecord),
        text: message.text || '',
        tapbacks: message.tapbacks || [],
        reply_to: replyTo || null
    }

    const { data, error } = await supabaseAdmin
        .from('chirp_messages')
        .insert(payload)
        .select()
        .single()

    if (error) throw error
    return data
}

async function createRun({ ownerId, conversationId, planetId, conversationType, planetType = null, target, triggerType }) {
    const payload = {
        owner_id: ownerId,
        conversation_id: conversationId || null,
        planet_id: planetId || null,
        agent_id: target.agentId,
        agent_role: target.agentRole,
        trigger_type: triggerType,
        memory_scope: buildMemoryScope({ conversationId, planetId, conversationType, planetType, target }),
        status: 'running'
    }

    const { data, error } = await supabaseAdmin
        .from('chirp_runs')
        .insert(payload)
        .select()
        .single()

    if (error) throw error
    return data
}

async function finishRun(runId, status, metadata = {}) {
    if (!runId) return
    const { error } = await supabaseAdmin
        .from('chirp_runs')
        .update({
            status,
            metadata,
            completed_at: new Date().toISOString()
        })
        .eq('id', runId)

    if (error) console.warn('Failed to update Chirp run:', error)
}

async function executeTargetRun({ ownerId, conversationId, planetId, conversationType, planetType = null, target, triggerType, planet, user, members, onText = null, onReset = null, mode = 'mentioned', perception = null, quotedContext = null, currentUserText = null, currentMessageIds = [] }) {
    let template = null

    if (target.agentRole !== 'bird') {
        // Cached after the first hit, so this is normally free.
        template = await loadTemplateByKey({ supabase: supabaseAdmin, key: target.agentId })
        if (!template) {
            console.warn(`Chirp persona template not found for "${target.agentId}"; skipping run`)
            return null
        }
    }

    const memoryScope = buildMemoryScope({
        conversationId,
        planetId,
        conversationType,
        // planetType='couple' narrows bird from owner-wide to THIS conversation
        // (couple_group_bird) — the couple-group memory boundary.
        planetType,
        target
    })

    // Independent DB work runs in parallel: instance (托管引用, persona-v2
    // §6.2), the run row, and scope resolution + recent window.
    // The immediate context is THIS conversation only (current 场域) — never the
    // persona's other conversations, so a DM is not polluted by group chatter and
    // vice versa. Cross-conversation knowledge is reached deliberately via recall
    // (which keeps the full allowed-conversation scope below).
    const [instance, run, resolvedScope, recentMessages] = await Promise.all([
        template
            ? ensureInstance({ supabase: supabaseAdmin, userId: ownerId, templateId: template.dbId })
            : Promise.resolve(null),
        createRun({ ownerId, conversationId, planetId, conversationType, planetType, target, triggerType }),
        resolveMemoryScope({ supabase: supabaseAdmin, ownerId, scope: memoryScope }),
        readConversationRecent({ conversationId })
    ])

    try {
        const recallTool = async (queries) => {
            const result = await recall({
                supabase: supabaseAdmin,
                ownerId,
                queries,
                scope: resolvedScope,
                limit: 5
            })
            return {
                queries: result.queries,
                result,
                summary: formatRecallForPrompt(result, user?.tzOffset)
            }
        }
        const reply = target.agentRole === 'bird'
            ? await runBird({
                planet,
                user,
                members,
                messages: recentMessages,
                memoryScope,
                recallTool,
                onText,
                onReset,
                quotedContext,
                currentUserText,
                currentMessageIds
            })
            : await runPersona({
                template,
                instance,
                planet,
                user,
                members,
                messages: recentMessages,
                memoryScope,
                recallTool,
                onText,
                onReset,
                mode,
                perception,
                quotedContext,
                currentUserText,
                currentMessageIds
            })

        // Bookkeeping must not delay the reply.
        finishRun(run.id, 'completed', {
            recall_queries: reply?.recall?.queries || null,
            recall_items: reply?.recall?.result?.items?.length || 0
        }).catch(() => {})

        // L1 distillation ledger: counts persona turns; distills on idle/cap.
        if (instance) {
            noteDistillTurn({ supabase: supabaseAdmin, userId: ownerId, template, instance })
        }

        return {
            runId: run.id,
            agent: template || { id: 'bird', name: 'Bird', role: 'Observer' },
            reply,
            mode
        }
    } catch (error) {
        finishRun(run.id, 'failed', { error: error.message }).catch(() => {})
        throw error
    }
}

async function prepareTurn({ ownerId, body }) {
    const { planet, conversation, user, text, texts, agents = [], members = [], replyTo = null, tzOffset = null } = body || {}
    // User's local timezone (minutes east of UTC) rides on the user object so every
    // downstream prompt formats timestamps in the user's clock, not the server's UTC.
    const userWithTz = { ...(user || {}), tzOffset: Number.isFinite(tzOffset) ? tzOffset : null }
    // A burst of quick messages arrives as `texts[]`; each becomes its own
    // bubble/row, but they are routed and answered as one expression.
    const batch = (Array.isArray(texts) ? texts : [text])
        .map(item => String(item || '').trim())
        .filter(Boolean)

    if (!batch.length) {
        const error = new Error('text is required')
        error.status = 400
        throw error
    }

    const conversationAgentId = conversation?.agentId || conversation?.personaId || null

    // A request that carries a conversationId is authorized by MEMBERSHIP
    // (owner OR user member — couple partner B is a member, not the owner) and
    // the planet comes from the conversation row. Never ensurePlanet here: for
    // B that would insert a planet of their own.
    const requestedConversationId = conversation?.id || planet?.conversationId || null
    let conversationType = conversation?.type || 'group'
    let planetId
    let conversationId
    let planetType
    if (requestedConversationId) {
        // loadConversationForUser now joins chirp_planets in the same query, so
        // planetType comes straight off the row — no second read, no soft-fail
        // path that could silently mask a couple planet as a plain group.
        const conversationRow = await loadConversationForUser(requestedConversationId, ownerId)
        if (!conversationRow) {
            const error = new Error('conversation not found or not accessible')
            error.status = 403
            error.code = 'CONVERSATION_FORBIDDEN'
            throw error
        }
        conversationId = conversationRow.id
        conversationType = conversationRow.type || conversationType
        planetId = conversationRow.planet_id || null
        planetType = conversationRow.planetType
    } else {
        const isPlanetless = conversationType === 'bird_dm' || conversationType === 'persona_dm'
        if (isPlanetless) {
            planetId = null
            planetType = null
        } else {
            // planetType comes back from ensurePlanet itself (the type it actually
            // ensured/selected in the DB), never from the request body directly —
            // a caller could otherwise send planet.type: 'love' alongside someone
            // else's planet.dbId to spoof past the couple-group short-circuit
            // below. ensurePlanet ignores an unowned dbId and falls through to its
            // own type-based ensure, so the type this returns is always the one
            // that was actually used to select/insert/re-select the row.
            const ensured = await ensurePlanet({ ownerId, planet })
            planetId = ensured.planetId
            planetType = ensured.planetType
        }
        conversationId = await ensureConversation({ ownerId, planetId, conversation: conversation || {}, planet })
    }
    await ensureConversationMembers({
        conversationId,
        ownerId,
        conversationType,
        // A couple group is a two-human chat — no persona agents should ever be
        // seeded as members of it (the M-1 fix: agents param is otherwise
        // whatever the client sent, and a couple group must never carry one).
        agents: planetType === 'couple' ? [] : agents,
        targetAgentId: conversationAgentId
    })

    let activation = routeActivation({
        conversation: {
            type: conversationType,
            agentId: conversation?.agentId,
            personaId: conversation?.personaId
        },
        message: { type: 'user', text: batch.join('\n'), read: true },
        agents,
        replyTo
    })
    // A couple group is a two-human chat: a no-@ message there is said TO the
    // partner, never a single-user "personal record". Router untouched — the
    // flag is corrected on the couple path only.
    if (planetType === 'couple') {
        activation = { ...activation, isPersonalRecord: false }
    }

    const quotedContext = await loadQuotedContext({ conversationId, replyTo })

    // couple v0: Bird replies to every user turn (no @ needed), so a couple
    // turn always runs a visible agent even though the router leaves targets
    // empty (router untouched — the handlers' couple branch runs Bird).
    const visibleRunLock = (activation.targets.length || planetType === 'couple')
        ? await acquireVisibleRunLock({
            supabase: supabaseAdmin,
            ownerId,
            conversationId
        })
        : null

    // The quote snapshot the user saw (display author + text), stored on the one
    // batched message that carried the quote so the chip survives reload.
    const quotedSnapshot = replyTo?.snapshot?.text
        ? { id: replyTo.id || null, author: replyTo.snapshot.author || '', text: replyTo.snapshot.text }
        : null
    const quotedIndex = Number.isInteger(replyTo?.index) ? replyTo.index : 0
    const savedUserMessages = []
    try {
        for (let i = 0; i < batch.length; i++) {
            savedUserMessages.push(await insertMessage({
                planetId,
                conversationId,
                message: { type: 'user', text: batch[i], read: true },
                activation,
                replyTo: (quotedSnapshot && i === quotedIndex) ? quotedSnapshot : null,
                planetType,
                senderUserId: ownerId
            }))
        }
    } catch (error) {
        await releaseVisibleRunLock({ supabase: supabaseAdmin, lock: visibleRunLock })
        throw error
    }

    return {
        planet,
        user: userWithTz,
        members,
        agents,
        planetId,
        planetType,
        conversationId,
        conversationType,
        activation,
        visibleRunLock,
        savedUserMessages,
        currentUserText: batch.join('\n'),
        currentMessageIds: savedUserMessages.map(message => message.id),
        quotedContext,
        tzOffset: userWithTz.tzOffset
    }
}

// One reply may span several bubbles (||| separated); each bubble is its own
// message row so history renders exactly like it streamed.
async function saveAgentReply({ planetId, conversationId, result }) {
    if (!result) return []
    const { runId, agent, reply } = result
    if (!reply?.text) return []

    const saved = []
    for (const part of splitBubbles(reply.text)) {
        const savedAgentMessage = await insertMessage({
            planetId,
            conversationId,
            message: {
                type: 'agent',
                agentId: agent.id,
                text: part,
                tapbacks: []
            },
            activation: { isPersonalRecord: false },
            runId
        })
        saved.push(toClientMessage(savedAgentMessage))
    }

    return saved
}

// A quoted/replied-to bubble, resolved server-side by id (never trust client
// text). Verified to belong to this conversation, then surfaced to the model so
// it knows exactly what the user is pointing at — even if it is older than the
// recent window.
async function loadQuotedContext({ conversationId, replyTo }) {
    if (!replyTo?.id || !conversationId) return null
    const { data, error } = await supabaseAdmin
        .from('chirp_messages')
        .select('id,conversation_id,sender_type,sender_id,text')
        .eq('id', replyTo.id)
        .maybeSingle()
    if (error || !data || data.conversation_id !== conversationId || !data.text) return null
    const author = data.sender_type === 'agent'
        ? (data.sender_id === 'bird' ? 'Bird' : `persona ${data.sender_id}`)
        : 'the user (their own earlier message)'
    return { author, text: data.text }
}

// Recent conversation context for the shared perception read, scoped by TURN,
// not by raw bubble count: a burst of quick messages is one turn, so it can't
// crowd out earlier rounds. Fetch a generous tail, then trim to the last
// CONTEXT_TURNS rounds (this round + the previous 2 full exchanges).
async function readConversationRecent({ conversationId, fetchLimit = 50 }) {
    if (!conversationId) return []
    const { data, error } = await supabaseAdmin
        .from('chirp_messages')
        .select('id,sender_type,sender_id,text,created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(fetchLimit)
    if (error) {
        console.warn('Chirp recent read for perception failed:', error.message || error)
        return []
    }
    const chronological = (data || []).reverse().map(toClientMessage)
    return takeLastTurns(chronological, CONTEXT_TURNS)
}

// The emotion/insight read is split off the reply critical path: a turn's reply
// uses the PREVIOUS turn's stored emotion (readPriorEmotion — a cheap DB read,
// no model wait); this turn's emotion+insight is computed and stored in the
// BACKGROUND for the next turn + the trajectory.

// Latest stored emotion slice — shapes THIS turn's reply tone (it is the
// previous turn's read). Cheap DB read; never waits on a model. Carries its
// absolute capture time (capturedAt) so the reply can date it for the model.
async function readPriorEmotion({ ownerId, conversationId }) {
    const row = await readEmotionStateRow({ supabase: supabaseAdmin, userId: ownerId, conversationId })
    if (!row?.state) return null
    return { ...row.state, capturedAt: row.updatedAt }
}

// Compute this turn's emotion read with the cheap model. This is background
// perception for the next turn / memory path, not participation routing.
async function computeTurnPerception({ ownerId, conversationId, latestText, tzOffset = null }) {
    const [priorState, recentMessages] = await Promise.all([
        readEmotionState({ supabase: supabaseAdmin, userId: ownerId, conversationId }),
        readConversationRecent({ conversationId })
    ])
    return perceiveTurn({ recentMessages, latestText, priorState, tzOffset })
}

// Persist this turn's perception: the latest slice (fast prior read next turn) +
// the trajectory log (history for emotion-memory analysis). Best-effort; meant to
// run in the background so it never blocks the reply.
function persistTurnPerception({ ownerId, conversationId, perception }) {
    if (!perception) return
    writeEmotionState({ supabase: supabaseAdmin, userId: ownerId, conversationId, state: perception }).catch(() => {})
    appendEmotionLog({ supabase: supabaseAdmin, userId: ownerId, conversationId, state: perception }).catch(() => {})
}

// Kick off this turn's emotion compute+store in the background. Never awaited
// on the reply path.
function schedulePerceptionStore({ ownerId, conversationId, latestText, tzOffset = null }) {
    ;(async () => {
        const perception = await computeTurnPerception({
            ownerId, conversationId, latestText, tzOffset
        })
        persistTurnPerception({ ownerId, conversationId, perception })
    })().catch(() => {})
}

// Recent context for the gates. `recentMessages` (this conversation, minus the
// just-sent turn) feeds the SECOND gate. `targeting` (the FIRST gate) is run only
// for ambient turns (no @, no quote); quote turns send their non-quoted personas
// straight to the second gate without a first gate.
async function computeTurnContext({ conversationId, members, latestText, currentMessageIds = [], runTargeting = false }) {
    const currentIds = new Set((currentMessageIds || []).filter(Boolean))
    const recentMessages = (await readConversationRecent({ conversationId }))
        .filter(message => !currentIds.has(message.id))
    const targeting = runTargeting ? await assessTurnTargeting({ members, recentMessages, latestText }) : null
    return { recentMessages, targeting }
}

function sendSse(res, event, data) {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
}

router.post('/chirp/turn', authenticateUser, async (req, res) => {
    let visibleRunLock = null
    try {
        const turn = await prepareTurn({ ownerId: req.user.id, body: req.body })
        visibleRunLock = turn.visibleRunLock

        // couple group v0: Bird replies to every turn directly (single or both
        // partners present — no @ needed). One bird run per turn; personas never
        // activate here. Perception is skipped on this path: runBird has no
        // perception input today (it only shapes persona replies), so computing
        // it would be a dead model call. Memory boundary: planetType='couple'
        // narrows bird's scope to THIS conversation (couple_group_bird).
        if (turn.planetType === 'couple') {
            const result = await executeTargetRun({
                ownerId: req.user.id,
                conversationId: turn.conversationId,
                planetId: turn.planetId,
                conversationType: turn.conversationType,
                planetType: turn.planetType,
                target: { agentRole: 'bird', agentId: 'bird' },
                triggerType: 'couple_group_bird',
                planet: turn.planet,
                user: turn.user,
                members: turn.members,
                quotedContext: turn.quotedContext,
                currentUserText: turn.currentUserText,
                currentMessageIds: turn.currentMessageIds
            })
            const agentMessages = (result && classifyReply(result.reply) !== 'silence')
                ? await saveAgentReply({
                    planetId: turn.planetId,
                    conversationId: turn.conversationId,
                    result
                })
                : []

            const eventMessageIds = [...turn.savedUserMessages.map(message => message.id), ...agentMessages.map(message => message.id)].filter(Boolean)
            if (eventMessageIds.length) {
                recordInteractionEvent({
                    supabase: supabaseAdmin,
                    userId: req.user.id,
                    planetId: turn.planetId,
                    conversationId: turn.conversationId,
                    conversationType: turn.conversationType,
                    speakerId: 'user',
                    messageIds: eventMessageIds
                }).catch(() => {})
            }

            return res.json({
                success: true,
                activation: turn.activation,
                messages: [...turn.savedUserMessages.map(toClientMessage), ...agentMessages]
            })
        }

        const isDM = turn.conversationType === 'persona_dm' || turn.conversationType === 'bird_dm'
        const latestText = turn.savedUserMessages.map(message => message.text).join('\n')

        // Reply tone uses the PREVIOUS turn's stored emotion (cheap read). This
        // turn's emotion+insight is stored in the background for next turn + log.
        const priorEmotion = await readPriorEmotion({ ownerId: req.user.id, conversationId: turn.conversationId })
        schedulePerceptionStore({
            ownerId: req.user.id,
            conversationId: turn.conversationId,
            latestText,
            tzOffset: turn.tzOffset
        })

        const triggerType = turn.activation.triggerType
        const isAmbient = !isDM && AMBIENT_TRIGGER_TYPES.has(triggerType)
        const isQuote = triggerType === 'reply_persona'
        const { recentMessages, targeting } = (isAmbient || isQuote)
            ? await computeTurnContext({
                conversationId: turn.conversationId,
                members: turn.members,
                latestText,
                currentMessageIds: turn.currentMessageIds,
                runTargeting: isAmbient
            })
            : { recentMessages: [], targeting: null }
        const speakerPlans = buildSpeakerPlans({ isDM, activation: turn.activation, agents: turn.agents, targeting })
        const runResults = await Promise.all(speakerPlans.map(async (plan) => {
            if (plan.gate) {
                const template = await loadTemplateByKey({ supabase: supabaseAdmin, key: plan.target.agentId })
                if (!template) return null
                const decision = await decideParticipation({
                    template,
                    members: turn.members,
                    latestText,
                    recentMessages,
                    targeting,
                    quotedContext: turn.quotedContext
                })
                if (!decision.speak) return null
            }
            return executeTargetRun({
                ownerId: req.user.id,
                conversationId: turn.conversationId,
                planetId: turn.planetId,
                conversationType: turn.conversationType,
                planetType: turn.planetType,
                target: plan.target,
                triggerType: turn.activation.triggerType,
                planet: turn.planet,
                user: turn.user,
                members: turn.members,
                mode: plan.mode,
                perception: priorEmotion,
                quotedContext: turn.quotedContext,
                currentUserText: turn.currentUserText,
                currentMessageIds: turn.currentMessageIds
            })
        }))
        const agentMessages = []

        for (const result of runResults.filter(Boolean)) {
            if (classifyReply(result.reply) === 'silence') continue
            agentMessages.push(...await saveAgentReply({
                planetId: turn.planetId,
                conversationId: turn.conversationId,
                result
            }))
        }

        const eventMessageIds = [...turn.savedUserMessages.map(message => message.id), ...agentMessages.map(message => message.id)].filter(Boolean)
        if (eventMessageIds.length) {
            recordInteractionEvent({
                supabase: supabaseAdmin,
                userId: req.user.id,
                planetId: turn.planetId,
                conversationId: turn.conversationId,
                conversationType: turn.conversationType,
                speakerId: 'user',
                messageIds: eventMessageIds
            }).catch(() => {})
        }

        res.json({
            success: true,
            activation: turn.activation,
            messages: [...turn.savedUserMessages.map(toClientMessage), ...agentMessages]
        })
    } catch (error) {
        console.error('Chirp turn failed:', error)
        if (error.code === 'CONVERSATION_FORBIDDEN') {
            return res.status(403).json({ error: { code: error.code, message: error.message } })
        }
        res.status(error.status || 500).json({
            success: false,
            error: error.code || error.message
        })
    } finally {
        await releaseVisibleRunLock({ supabase: supabaseAdmin, lock: visibleRunLock })
    }
})

router.post('/chirp/turn/stream', authenticateUser, async (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    })
    res.flushHeaders?.()

    let visibleRunLock = null
    try {
        const turn = await prepareTurn({ ownerId: req.user.id, body: req.body })
        visibleRunLock = turn.visibleRunLock
        sendSse(res, 'user_messages', turn.savedUserMessages.map(toClientMessage))
        sendSse(res, 'activation', turn.activation)

        const isDM = turn.conversationType === 'persona_dm' || turn.conversationType === 'bird_dm'
        const isCoupleGroup = turn.planetType === 'couple'
        const latestText = turn.savedUserMessages.map(message => message.text).join('\n')

        // Reply tone uses the PREVIOUS turn's stored emotion (cheap read, no model
        // wait). This turn's emotion+insight is stored in the background for next
        // turn + trajectory. couple v0 skips both: runBird has no perception input
        // today (it only shapes persona replies), so computing/storing it would be
        // a dead model call per turn.
        const priorEmotion = isCoupleGroup
            ? null
            : await readPriorEmotion({ ownerId: req.user.id, conversationId: turn.conversationId })
        if (!isCoupleGroup) {
            schedulePerceptionStore({
                ownerId: req.user.id,
                conversationId: turn.conversationId,
                latestText,
                tzOffset: turn.tzOffset
            })
        }
        // Parallel fan-out — first done, first shown.
        const agentMessageIds = []

        const streamTarget = async (plan, index) => {
            const { target } = plan
            sendSse(res, 'agent_started', { target, index })
            try {
                const forward = (delta) => sendSse(res, 'agent_delta', { target, index, delta })
                const result = await executeTargetRun({
                    ownerId: req.user.id,
                    conversationId: turn.conversationId,
                    planetId: turn.planetId,
                    conversationType: turn.conversationType,
                    planetType: turn.planetType,
                    target,
                    triggerType: isCoupleGroup ? 'couple_group_bird' : turn.activation.triggerType,
                    planet: turn.planet,
                    user: turn.user,
                    members: turn.members,
                    mode: plan.mode,
                    perception: priorEmotion,
                    quotedContext: turn.quotedContext,
                    currentUserText: turn.currentUserText,
                    currentMessageIds: turn.currentMessageIds,
                    onText: forward,
                    onReset: () => sendSse(res, 'agent_reset', { target, index })
                })
                sendSse(res, 'agent_finished', { target, index })
                if (!result || classifyReply(result.reply) === 'silence') return null
                const savedParts = await saveAgentReply({
                    planetId: turn.planetId,
                    conversationId: turn.conversationId,
                    result
                })
                for (const savedMessage of savedParts) {
                    agentMessageIds.push(savedMessage.id)
                    sendSse(res, 'agent_message', { message: savedMessage, target, index })
                }
                return savedParts.length ? savedParts : null
            } catch (error) {
                console.error('Chirp stream target failed:', error)
                sendSse(res, 'agent_error', { target, index, error: error.message })
                return null
            }
        }

        // couple group v0: Bird replies to every turn directly (single or both
        // partners — no @ needed); personas never activate here. Exactly one
        // bird run, streamed with the SAME event sequence any agent uses
        // (agent_started / agent_delta / agent_finished / agent_message,
        // agent_error on failure) — no new event types.
        if (isCoupleGroup) {
            await streamTarget({ target: { agentRole: 'bird', agentId: 'bird' }, mode: 'mentioned' }, 0)

            const coupleEventMessageIds = [...turn.savedUserMessages.map(message => message.id), ...agentMessageIds].filter(Boolean)
            if (coupleEventMessageIds.length) {
                recordInteractionEvent({
                    supabase: supabaseAdmin,
                    userId: req.user.id,
                    planetId: turn.planetId,
                    conversationId: turn.conversationId,
                    conversationType: turn.conversationType,
                    speakerId: 'user',
                    messageIds: coupleEventMessageIds
                }).catch(() => {})
            }

            sendSse(res, 'done', { success: true })
            return
        }

        // Unified funnel: hard targets start immediately; gated personas decide
        // independently with compact context and speak only if moved. Bird replies
        // only if addressed. DM skips the funnel.
        const triggerType = turn.activation.triggerType
        const isAmbient = !isDM && AMBIENT_TRIGGER_TYPES.has(triggerType)
        const isQuote = triggerType === 'reply_persona'
        const { recentMessages, targeting } = (isAmbient || isQuote)
            ? await computeTurnContext({
                conversationId: turn.conversationId,
                members: turn.members,
                latestText,
                currentMessageIds: turn.currentMessageIds,
                runTargeting: isAmbient
            })
            : { recentMessages: [], targeting: null }
        const speakerPlans = buildSpeakerPlans({ isDM, activation: turn.activation, agents: turn.agents, targeting })
        const runners = speakerPlans.map((plan, index) => async () => {
            if (plan.gate) {
                const template = await loadTemplateByKey({ supabase: supabaseAdmin, key: plan.target.agentId })
                if (!template) return null
                const decision = await decideParticipation({
                    template,
                    members: turn.members,
                    latestText,
                    recentMessages,
                    targeting,
                    quotedContext: turn.quotedContext
                })
                if (!decision.speak) return null
            }
            return streamTarget(plan, index)
        })

        await Promise.all(runners.map(run => run()))

        const eventMessageIds = [...turn.savedUserMessages.map(message => message.id), ...agentMessageIds].filter(Boolean)
        if (eventMessageIds.length) {
            recordInteractionEvent({
                supabase: supabaseAdmin,
                userId: req.user.id,
                planetId: turn.planetId,
                conversationId: turn.conversationId,
                conversationType: turn.conversationType,
                speakerId: 'user',
                messageIds: eventMessageIds
            }).catch(() => {})
        }

        sendSse(res, 'done', { success: true })
    } catch (error) {
        console.error('Chirp turn stream failed:', error)
        sendSse(res, 'error', { success: false, error: error.code || error.message })
    } finally {
        await releaseVisibleRunLock({ supabase: supabaseAdmin, lock: visibleRunLock })
        res.end()
    }
})

// Ensure a DM conversation exists the moment the user opens it (before any
// message), so it shows up in the conversation list right away. Idempotent.
router.post('/chirp/conversations/ensure', authenticateUser, async (req, res) => {
    try {
        const ownerId = req.user.id
        const { conversation = {}, agents = [] } = req.body || {}
        // This route only serves "pre-build my own DM the moment I open it" —
        // the client never has (or needs) a legitimate conversation id to pass.
        // Refuse to trust a client-supplied id: ensureConversation() short-circuits
        // on conversation.id with no ownership check, and the membership upsert
        // right after would then mint the caller into ANY known conversation id
        // (persona_dm/bird_dm/group alike) once membership RLS is enforced.
        const { id: _ignoredConversationId, ...safeConversation } = conversation
        const type = safeConversation.type
        if (type !== 'persona_dm' && type !== 'bird_dm') {
            return res.status(400).json({ success: false, error: 'unsupported_type' })
        }
        const conversationId = await ensureConversation({ ownerId, planetId: null, conversation: safeConversation, planet: {} })
        await ensureConversationMembers({
            conversationId,
            ownerId,
            conversationType: type,
            agents,
            targetAgentId: conversation.agentId || conversation.personaId || null
        })
        res.json({ success: true, conversationId })
    } catch (error) {
        console.error('Ensure conversation failed:', error)
        res.status(500).json({ success: false, error: error.message })
    }
})

// —— couple invites ——————————————————————————————————————————————————————
// Error envelope for this feature is uniformly { error: { code, message } }.

const inviteErrorStatus = {
    INVITE_NOT_FOUND: 404,
    INVITE_EXPIRED: 410,
    INVITE_REVOKED: 410,
    INVITE_ALREADY_REDEEMED: 409,
    INVITE_SELF_REDEEM: 400
}

// A creates (or reuses — idempotent per planet) an invite key. The requester's
// couple planet is ensured on the way.
router.post('/chirp/couple/invite', authenticateUser, async (req, res) => {
    try {
        const { planetId } = await ensurePlanet({ ownerId: req.user.id, planet: { type: 'couple', name: 'us' } })
        const invite = await createInvite({ db: supabaseAdmin, planetId, inviterId: req.user.id })
        res.json(invite)
    } catch (err) {
        console.error('Chirp couple invite create failed:', err)
        const code = err instanceof InviteError ? err.code : 'INVITE_CREATE_FAILED'
        res.status(inviteErrorStatus[code] || 500).json({ error: { code, message: err.message } })
    }
})

// B previews an invite by code (status included so the accept page can render
// expired/revoked states).
router.get('/chirp/couple/invite/:code', authenticateUser, async (req, res) => {
    try {
        const invite = await getInviteByCode({ db: supabaseAdmin, code: req.params.code })
        if (!invite) return res.status(404).json({ error: { code: 'INVITE_NOT_FOUND', message: 'invite not found' } })
        res.json(invite)
    } catch (err) {
        console.error('Chirp couple invite lookup failed:', err)
        res.status(500).json({ error: { code: 'INVITE_LOOKUP_FAILED', message: err.message } })
    }
})

// B redeems: the SQL RPC atomically creates the planet's group conversation
// and inserts B's membership (idempotent for the same redeemer).
router.post('/chirp/couple/invite/:code/redeem', authenticateUser, async (req, res) => {
    try {
        const result = await redeemInvite({ db: supabaseAdmin, code: req.params.code, userId: req.user.id })
        res.json(result)
    } catch (err) {
        if (err instanceof InviteError) {
            const status = inviteErrorStatus[err.code] || 500
            return res.status(status).json({ error: { code: err.code, message: err.message } })
        }
        console.error('Chirp couple invite redeem failed:', err)
        res.status(500).json({ error: { code: 'INVITE_REDEEM_FAILED', message: err.message } })
    }
})

// Official public persona templates (persona-v2 §6.2: any user can use them
// via a hosted instance; templates are global, no longer per-user copies).
router.get('/chirp/personas', authenticateUser, async (req, res) => {
    try {
        const personas = await loadOfficialTemplates({ supabase: supabaseAdmin })
        res.json({ success: true, personas })
    } catch (error) {
        console.error('Load Chirp persona templates failed:', error)
        res.status(500).json({ success: false, error: error.message })
    }
})

// Deprecated alias kept for older clients: officials are seeded by migration,
// nothing is written per user anymore.
router.post('/chirp/personas/seed-defaults', authenticateUser, async (req, res) => {
    try {
        const personas = await loadOfficialTemplates({ supabase: supabaseAdmin })
        res.json({ success: true, personas })
    } catch (error) {
        console.error('Load Chirp persona templates failed:', error)
        res.status(500).json({ success: false, error: error.message })
    }
})

export default router
