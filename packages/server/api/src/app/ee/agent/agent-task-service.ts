import { ActivepiecesError, apId, ErrorCode, isNil, sanitizeObjectForPostgresql } from '@activepieces/core-utils'
import { MAX_AGENT_TURN_WALL_CLOCK_MS, SubagentTask, SubagentTaskArtifact, SubagentTaskStatus } from '@activepieces/shared'
import dayjs from 'dayjs'
import { repoFactory } from '../../core/db/repo-factory'
import { agentHelpers } from './agent-helpers'
import { AgentTaskEntity } from './agent-task-entity'

const agentTaskRepo = repoFactory(AgentTaskEntity)

async function begin({ platformId, conversationId, title, taskId }: {
    platformId: string
    conversationId: string
    title: string
    taskId?: string
}): Promise<{ taskId: string, messages: Record<string, unknown>[] }> {
    const conversation = await agentHelpers.conversationRepo().findOneBy({ id: conversationId, platformId })
    if (isNil(conversation)) {
        throw new ActivepiecesError({ code: ErrorCode.ENTITY_NOT_FOUND, params: { entityType: 'agent_conversation', entityId: conversationId } })
    }
    if (isNil(taskId)) {
        const id = apId()
        await agentTaskRepo().insert({
            id,
            platformId,
            projectId: conversation.projectId ?? null,
            conversationId,
            title,
            status: SubagentTaskStatus.RUNNING,
            messages: [],
            summary: null,
            artifacts: [],
        })
        return { taskId: id, messages: [] }
    }
    const staleBefore = dayjs().subtract(MAX_AGENT_TURN_WALL_CLOCK_MS, 'millisecond').toISOString()
    const claimed = await agentTaskRepo().createQueryBuilder()
        .update()
        .set({ status: SubagentTaskStatus.RUNNING, title })
        .where('id = :taskId AND "platformId" = :platformId AND "conversationId" = :conversationId', { taskId, platformId, conversationId })
        .andWhere('(status != :running OR updated < :staleBefore)', { running: SubagentTaskStatus.RUNNING, staleBefore })
        .returning('id')
        .execute()
    const claimedRows: unknown = claimed.raw
    if (!Array.isArray(claimedRows) || claimedRows.length !== 1) {
        throw new ActivepiecesError({ code: ErrorCode.VALIDATION, params: { message: `Task ${taskId} does not exist in this conversation or is still running` } })
    }
    const task = await agentTaskRepo().findOneByOrFail({ id: taskId, platformId, conversationId })
    return { taskId, messages: task.messages }
}

async function finish({ platformId, conversationId, taskId, status, messages, summary, artifacts }: {
    platformId: string
    conversationId: string
    taskId: string
    status: SubagentTaskStatus
    messages: Record<string, unknown>[]
    summary: string | null
    artifacts: SubagentTaskArtifact[]
}): Promise<void> {
    const updates: Record<string, unknown> = {
        status,
        messages: sanitizeObjectForPostgresql(messages),
        summary,
        artifacts: sanitizeObjectForPostgresql(artifacts),
    }
    await agentTaskRepo().createQueryBuilder()
        .update()
        .set(updates)
        .where('id = :taskId AND "platformId" = :platformId AND "conversationId" = :conversationId', { taskId, platformId, conversationId })
        .execute()
}

async function list({ platformId, conversationId }: { platformId: string, conversationId: string }): Promise<Omit<SubagentTask, 'messages'>[]> {
    return agentTaskRepo().find({
        where: { platformId, conversationId },
        select: ['id', 'created', 'updated', 'platformId', 'projectId', 'conversationId', 'title', 'status', 'summary', 'artifacts'],
        order: { created: 'ASC' },
    })
}

export const agentTaskService = {
    begin,
    finish,
    list,
}
