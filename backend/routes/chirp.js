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

const router = Router()

const toClientMessage = (row) => ({
    id: row.id,
    type: row.sender_type,
    agentId: row.sender_type === 'agent' ? row.sender_id : undefined,
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
    if (planet.dbId) return planet.dbId

    const type = planet.type || planet.id || 'love'
    const { data: existing, error: selectError } = await supabaseAdmin
        .from('chirp_planets')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('type', type)
        .limit(1)
        .maybeSingle()

    if (selectError) throw selectError
    if (existing?.id) return existing.id

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

    if (error) throw error
    return data.id
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
            .eq('owner_id', ownerId)
            .eq('type', type)
            .order('created_at', { ascending: true })
            .limit(1)
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

async function insertMessage({ planetId, conversationId, message, activation, runId = null, replyTo = null }) {
    // A user message is always sender_type 'user'. Whether it was a no-@
    // "personal record" lives only in is_personal_record — we no longer overload
    // sender_type with a 'memo' value (that conflated "who sent it" with "was it
    // directed", and made every "is this the user?" check silently skip no-@).
    const senderType = message.type
    const payload = {
        planet_id: planetId || null,
        conversation_id: conversationId || null,
        run_id: runId,
        sender_type: senderType,
        sender_id: message.agentId || (senderType === 'user' ? 'user' : null),
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

async function createRun({ ownerId, conversationId, planetId, conversationType, target, triggerType }) {
    const payload = {
        owner_id: ownerId,
        conversation_id: conversationId || null,
        planet_id: planetId || null,
        agent_id: target.agentId,
        agent_role: target.agentRole,
        trigger_type: triggerType,
        memory_scope: buildMemoryScope({ conversationId, planetId, conversationType, target }),
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

async function executeTargetRun({ ownerId, conversationId, planetId, conversationType, target, triggerType, planet, user, members, onText = null, onReset = null, mode = 'mentioned', perception = null, quotedContext = null }) {
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
        createRun({ ownerId, conversationId, planetId, conversationType, target, triggerType }),
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
                summary: formatRecallForPrompt(result)
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
                quotedContext
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
                quotedContext
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
            reply
        }
    } catch (error) {
        finishRun(run.id, 'failed', { error: error.message }).catch(() => {})
        throw error
    }
}

async function prepareTurn({ ownerId, body }) {
    const { planet, conversation, user, text, texts, agents = [], members = [], replyTo = null } = body || {}
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

    const conversationType = conversation?.type || 'group'
    const conversationAgentId = conversation?.agentId || conversation?.personaId || null
    const planetId = (conversationType === 'bird_dm' || conversationType === 'persona_dm')
        ? null
        : await ensurePlanet({ ownerId, planet })
    const conversationId = await ensureConversation({
        ownerId,
        planetId,
        conversation: {
            ...conversation,
            id: conversation?.id || planet?.conversationId || null
        },
        planet
    })
    await ensureConversationMembers({
        conversationId,
        ownerId,
        conversationType,
        agents,
        targetAgentId: conversationAgentId
    })

    const activation = routeActivation({
        conversation: {
            type: conversationType,
            agentId: conversation?.agentId,
            personaId: conversation?.personaId
        },
        message: { type: 'user', text: batch.join('\n'), read: true },
        agents,
        replyTo
    })

    const quotedContext = await loadQuotedContext({ conversationId, replyTo })

    const visibleRunLock = activation.targets.length
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
                replyTo: (quotedSnapshot && i === quotedIndex) ? quotedSnapshot : null
            }))
        }
    } catch (error) {
        await releaseVisibleRunLock({ supabase: supabaseAdmin, lock: visibleRunLock })
        throw error
    }

    return {
        planet,
        user,
        members,
        agents,
        planetId,
        conversationId,
        conversationType,
        activation,
        visibleRunLock,
        savedUserMessages,
        quotedContext
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

// The emotion/insight read is split off the reply critical path (persona-v2
// §5.3): a turn's reply uses the PREVIOUS turn's stored emotion (readPriorEmotion
// — a cheap DB read, no model wait); this turn's emotion+insight is computed and
// stored in the BACKGROUND for the next turn + the trajectory. Group turns still
// compute this turn's structural signals up front because the participation gate
// needs them to decide who speaks.

// Latest stored emotion slice — shapes THIS turn's reply tone (it is the
// previous turn's read). Cheap DB read; never waits on a model. Carries its
// absolute capture time (capturedAt) so the reply can date it for the model.
async function readPriorEmotion({ ownerId, conversationId }) {
    const row = await readEmotionStateRow({ supabase: supabaseAdmin, userId: ownerId, conversationId })
    if (!row?.state) return null
    return { ...row.state, capturedAt: row.updatedAt }
}

// Compute this turn's perception with the cheap model. Group turns include the
// structural signals (addressed_to / continues_thread_of / is_question /
// emotional_bid) for the gate; DM turns read emotion + insight only.
async function computeTurnPerception({ ownerId, conversationId, members, latestText, includeStructural = true }) {
    const [priorState, recentMessages] = await Promise.all([
        readEmotionState({ supabase: supabaseAdmin, userId: ownerId, conversationId }),
        readConversationRecent({ conversationId })
    ])
    return perceiveTurn({ members, recentMessages, latestText, priorState, includeStructural })
}

// Persist this turn's perception: the latest slice (fast prior read next turn) +
// the trajectory log (history for emotion-memory analysis). Best-effort; meant to
// run in the background so it never blocks the reply.
function persistTurnPerception({ ownerId, conversationId, perception }) {
    if (!perception) return
    writeEmotionState({ supabase: supabaseAdmin, userId: ownerId, conversationId, state: perception }).catch(() => {})
    appendEmotionLog({ supabase: supabaseAdmin, userId: ownerId, conversationId, state: perception }).catch(() => {})
}

// Kick off this turn's perception compute+store in the background. For groups the
// up-front structural read is reused (no second model call); for DMs it computes
// emotion-only here. Never awaited on the reply path.
function schedulePerceptionStore({ ownerId, conversationId, members, latestText, precomputed = null }) {
    ;(async () => {
        const perception = precomputed ?? await computeTurnPerception({
            ownerId, conversationId, members, latestText, includeStructural: false
        })
        persistTurnPerception({ ownerId, conversationId, perception })
    })().catch(() => {})
}

// Unified participation funnel (group turns). EVERY in-room persona is evaluated
// every turn through participation.js:
//   - A persona explicitly addressed this turn (@'d, @all, or quoted) has a hard
//     obligation → replies, no gate call.
//   - Everyone else runs their own obligation/motivation gate (shared perception
//     + their own card) and chimes in only if genuinely moved.
// So @诞总 still gets 诞总 for sure, but others may add a line if they truly have
// something (the gate's ownerNote keeps them deferential). Bird is special: it
// replies only when addressed (@bird / quoted), never via motivation.
// `addressed` is false on pure ambient turns, where activation.targets are just
// candidates, not real addressees.
async function resolveGroupSpeakers({ agents = [], activation, perception, members, latestText }) {
    const addressed = !['ambient', 'group_personal_record'].includes(activation?.triggerType)
    const addressedIds = new Set(
        addressed ? (activation?.targets || []).filter(t => t.agentRole === 'persona').map(t => t.agentId) : []
    )
    const birdAddressed = addressed && (activation?.targets || []).some(t => t.agentRole === 'bird')

    const personaSpeakers = await Promise.all(agents.map(async (agent) => {
        const template = await loadTemplateByKey({ supabase: supabaseAdmin, key: agent.id })
        if (!template) return null
        if (addressedIds.has(agent.id) || addressedIds.has(template.id)) {
            return { agentRole: 'persona', agentId: template.id }   // hard obligation: addressed
        }
        const decision = await decideParticipation({ template, perception, members, latestText })
        return decision.speak ? { agentRole: 'persona', agentId: template.id } : null
    }))

    const speakers = personaSpeakers.filter(Boolean)
    if (birdAddressed) speakers.push({ agentRole: 'bird', agentId: 'bird' })
    return speakers
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
        const isDM = turn.conversationType === 'persona_dm' || turn.conversationType === 'bird_dm'
        const latestText = turn.savedUserMessages.map(message => message.text).join('\n')

        // Reply tone uses the PREVIOUS turn's stored emotion (cheap read); groups
        // also compute THIS turn's structural signals up front for the gate. This
        // turn's emotion+insight is stored in the background for next turn + log.
        const priorEmotion = await readPriorEmotion({ ownerId: req.user.id, conversationId: turn.conversationId })
        const gatePerception = isDM ? null : await computeTurnPerception({
            ownerId: req.user.id,
            conversationId: turn.conversationId,
            members: turn.members,
            latestText,
            includeStructural: true
        })
        schedulePerceptionStore({
            ownerId: req.user.id,
            conversationId: turn.conversationId,
            members: turn.members,
            latestText,
            precomputed: gatePerception
        })

        // DM: the one persona/bird always replies. Group: everyone goes through
        // the unified participation funnel (addressed = obligation, else gated).
        const targets = isDM
            ? turn.activation.targets
            : await resolveGroupSpeakers({ agents: turn.agents, activation: turn.activation, perception: gatePerception, members: turn.members, latestText })

        const runResults = await Promise.all(targets.map(target => executeTargetRun({
            ownerId: req.user.id,
            conversationId: turn.conversationId,
            planetId: turn.planetId,
            conversationType: turn.conversationType,
            target,
            triggerType: turn.activation.triggerType,
            planet: turn.planet,
            user: turn.user,
            members: turn.members,
            mode: 'mentioned',   // gated speakers reply directly; no in-reply silence
            perception: priorEmotion,
            quotedContext: turn.quotedContext
        })))
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
        const latestText = turn.savedUserMessages.map(message => message.text).join('\n')

        // Reply tone uses the PREVIOUS turn's stored emotion (cheap read, no model
        // wait). Groups also compute THIS turn's structural signals up front for the
        // gate; DM skips that. This turn's emotion+insight is stored in the
        // background (reused for groups, computed for DM) for next turn + trajectory.
        const priorEmotion = await readPriorEmotion({ ownerId: req.user.id, conversationId: turn.conversationId })
        const gatePerception = isDM ? null : await computeTurnPerception({
            ownerId: req.user.id,
            conversationId: turn.conversationId,
            members: turn.members,
            latestText,
            includeStructural: true
        })
        schedulePerceptionStore({
            ownerId: req.user.id,
            conversationId: turn.conversationId,
            members: turn.members,
            latestText,
            precomputed: gatePerception
        })
        // Parallel fan-out — first done, first shown.
        const agentMessageIds = []

        const streamTarget = async (target, index) => {
            sendSse(res, 'agent_started', { target, index })
            try {
                const forward = (delta) => sendSse(res, 'agent_delta', { target, index, delta })
                const result = await executeTargetRun({
                    ownerId: req.user.id,
                    conversationId: turn.conversationId,
                    planetId: turn.planetId,
                    conversationType: turn.conversationType,
                    target,
                    triggerType: turn.activation.triggerType,
                    planet: turn.planet,
                    user: turn.user,
                    members: turn.members,
                    mode: 'mentioned',   // gated speakers reply directly
                    perception: priorEmotion,
                    quotedContext: turn.quotedContext,
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

        // Unified funnel (group): every persona is evaluated and starts replying
        // the instant it passes — addressed (@/quote) = hard obligation (no gate
        // call, replies immediately), everyone else runs its own gate in parallel
        // and chimes in only if moved. Bird replies only if addressed. DM skips
        // the funnel (the one persona/bird always replies). First decided, first
        // speaking — no barrier on the slowest gate.
        let runners
        if (isDM) {
            runners = turn.activation.targets.map((target, index) => () => streamTarget(target, index))
        } else {
            const addressed = !['ambient', 'group_personal_record'].includes(turn.activation.triggerType)
            const addressedIds = new Set(
                addressed ? turn.activation.targets.filter(t => t.agentRole === 'persona').map(t => t.agentId) : []
            )
            const birdAddressed = addressed && turn.activation.targets.some(t => t.agentRole === 'bird')
            runners = turn.agents.map((agent, index) => async () => {
                const template = await loadTemplateByKey({ supabase: supabaseAdmin, key: agent.id })
                if (!template) return null
                if (!addressedIds.has(agent.id) && !addressedIds.has(template.id)) {
                    const decision = await decideParticipation({ template, perception: gatePerception, members: turn.members, latestText })
                    if (!decision.speak) return null
                }
                return streamTarget({ agentRole: 'persona', agentId: template.id }, index)
            })
            if (birdAddressed) runners.push(() => streamTarget({ agentRole: 'bird', agentId: 'bird' }, turn.agents.length))
        }

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
        const type = conversation.type
        if (type !== 'persona_dm' && type !== 'bird_dm') {
            return res.status(400).json({ success: false, error: 'unsupported_type' })
        }
        const conversationId = await ensureConversation({ ownerId, planetId: null, conversation, planet: {} })
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
